"""
Campus Copilot - Backend
------------------------------------------
A single-file Flask app that powers:
  - Real student authentication (registration + hashed-password login)
  - AI-assisted complaint classification (Gemini if configured, keyword
    fallback otherwise - see classify_text() below)
  - Complaints (submit + list)
  - Lost & Found (submit + list)
  - Events & Announcements (list + admin add)
  - Rate-limited admin + student login

Database: PostgreSQL (configured with the DATABASE_URL environment variable)

Environment variables (set these in a local .env file, or in your host's
environment settings when deploying):
  SECRET_KEY      Required in production. Signs session cookies - if this
                   leaks or is guessable, sessions (including admin ones)
                   can be forged. Generate one with:
                     python -c "import secrets; print(secrets.token_hex(32))"
  ADMIN_PASSWORD  Required in production. Shared password for the admin
                   dashboard.
  FLASK_DEBUG     Set to "1" only for local development. Must be unset (or
                   "0") in production - debug mode exposes an interactive
                   debugger that can run arbitrary code.
  GOOGLE_API_KEY  Optional. Enables Gemini-based complaint classification.
"""

from flask import Flask, request, jsonify, render_template, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
import psycopg2
import psycopg2.extras
import os
import re
import json
import time
import secrets
import requests
import hashlib
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()  # reads a local .env file, if present, into environment variables

DEBUG = os.environ.get("FLASK_DEBUG", "0") == "1"

# Keep the current flat project layout working: the HTML templates and static
# assets are all stored beside this file.
app = Flask(__name__, template_folder=".", static_folder=".", static_url_path="/static")

# --- SECRET_KEY -------------------------------------------------------------
# In production this MUST come from the environment. If it isn't set, anyone
# who can guess/read the fallback value could forge session cookies -
# including one that claims {"is_admin": True}.
_env_secret = os.getenv("SECRET_KEY")
if _env_secret:
    app.secret_key = _env_secret
elif DEBUG:
    # Local dev convenience only: generate a per-run key so the app still
    # boots without a .env file. Sessions won't survive a restart, and this
    # path is never used when FLASK_DEBUG isn't set.
    app.secret_key = secrets.token_hex(32)
    print("[Campus Copilot] WARNING: no SECRET_KEY set - using a temporary "
          "development key. Set SECRET_KEY in .env before deploying.")
else:
    raise RuntimeError(
        "SECRET_KEY environment variable is required. Generate one with:\n"
        '  python -c "import secrets; print(secrets.token_hex(32))"\n'
        "and add it to your .env file (locally) or host's environment settings (in production)."
    )

# Cookies should never be sent over plain HTTP once this is live on a real
# domain. Only relax this for local http://localhost development.
# Override with SESSION_COOKIE_SECURE=0|1 in .env if needed.
_cookie_secure_env = os.environ.get("SESSION_COOKIE_SECURE", "").strip().lower()
if _cookie_secure_env in ("1", "true", "yes"):
    app.config["SESSION_COOKIE_SECURE"] = True
elif _cookie_secure_env in ("0", "false", "no"):
    app.config["SESSION_COOKIE_SECURE"] = False
else:
    app.config["SESSION_COOKIE_SECURE"] = not DEBUG
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required for PostgreSQL.")

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
GEMINI_LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models"
_cached_gemini_model = None  # discovered once, then reused

# --- ADMIN_PASSWORD ----------------------------------------------------------
_env_admin_password = os.environ.get("ADMIN_PASSWORD")
if _env_admin_password:
    ADMIN_PASSWORD = _env_admin_password
elif DEBUG:
    ADMIN_PASSWORD = "admin123"
    print("[Campus Copilot] WARNING: no ADMIN_PASSWORD set - using the "
          "default 'admin123' for local development only. Set ADMIN_PASSWORD "
          "in .env before deploying.")
else:
    raise RuntimeError(
        "ADMIN_PASSWORD environment variable is required in production. "
        "Set it in your host's environment settings before deploying."
    )

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@campus.local" if DEBUG else "").strip().lower()
if not ADMIN_EMAIL and not DEBUG:
    raise RuntimeError("ADMIN_EMAIL environment variable is required in production.")

VALID_STATUSES = ["Open", "In Progress", "Resolved"]
VALID_LOST_FOUND_STATUSES = ["Active", "Claimed", "Returned"]
ROLL_NUMBER_RE = re.compile(r"^[A-Za-z0-9\-/]{2,20}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
COLLEGE_EMAIL_DOMAIN = os.environ.get("COLLEGE_EMAIL_DOMAIN", "").strip().lower().lstrip("@")
OTP_EXPIRY_SECONDS = 10 * 60
RESET_TOKEN_EXPIRY_SECONDS = 30 * 60

# --- Simple in-memory login rate limiting ------------------------------------
# Good enough for a single-process hackathon deployment: after 5 failed
# attempts from the same IP within 10 minutes, that IP is locked out for the
# rest of the window. Resets on process restart and won't share state across
# multiple worker processes - fine for this project's scale, but worth
# knowing if you later run this behind a multi-worker production server.
LOGIN_ATTEMPT_LIMIT = 5
LOGIN_ATTEMPT_WINDOW_SECONDS = 10 * 60
_login_attempts = {}  # key -> list[timestamps of recent failed attempts]


def _rate_limit_key(bucket: str) -> str:
    ip = request.headers.get("X-Forwarded-For", request.remote_addr) or "unknown"
    return f"{bucket}:{ip.split(',')[0].strip()}"


def is_rate_limited(bucket: str) -> bool:
    key = _rate_limit_key(bucket)
    now = time.time()
    attempts = [t for t in _login_attempts.get(key, []) if now - t < LOGIN_ATTEMPT_WINDOW_SECONDS]
    _login_attempts[key] = attempts
    return len(attempts) >= LOGIN_ATTEMPT_LIMIT


def record_failed_attempt(bucket: str):
    key = _rate_limit_key(bucket)
    _login_attempts.setdefault(key, []).append(time.time())


def clear_attempts(bucket: str):
    _login_attempts.pop(_rate_limit_key(bucket), None)


# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------
def get_db():
    return psycopg2.connect(
        DATABASE_URL,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def init_db():
    required_tables = {
        "students",
        "email_verification_tokens",
        "password_reset_tokens",
        "admins",
        "complaints",
        "lost_found",
        "events",
    }
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = ANY(%s)",
                (list(required_tables),),
            )
            existing_tables = {row["table_name"] for row in cur.fetchall()}
            missing_tables = required_tables - existing_tables
            if missing_tables:
                raise RuntimeError(
                    "PostgreSQL is missing required tables: "
                    + ", ".join(sorted(missing_tables))
                )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS login_attempts (
                    id BIGSERIAL PRIMARY KEY,
                    email TEXT NOT NULL,
                    user_type TEXT NOT NULL CHECK (user_type IN ('student', 'admin')),
                    success BOOLEAN NOT NULL,
                    ip_address TEXT,
                    browser TEXT,
                    attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_login_attempts_time "
                "ON login_attempts (attempted_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_login_attempts_user "
                "ON login_attempts (user_type, email)"
            )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS login_history (
                    id BIGSERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    user_type TEXT NOT NULL CHECK (user_type IN ('student', 'admin')),
                    login_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    ip_address TEXT,
                    browser TEXT,
                    operating_system TEXT
                )
                """
            )
            # Keep upgrades non-destructive for databases created by the
            # earlier login-history implementation.
            cur.execute("ALTER TABLE login_history ADD COLUMN IF NOT EXISTS browser TEXT")
            cur.execute(
                "ALTER TABLE login_history ADD COLUMN IF NOT EXISTS operating_system TEXT"
            )
            cur.execute("ALTER TABLE login_history DROP COLUMN IF EXISTS user_agent")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_login_history_time "
                "ON login_history (login_time DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_login_history_user "
                "ON login_history (user_type, user_id)"
            )

            # Migrations for Admin Dashboard
            cur.execute("ALTER TABLE admins ADD COLUMN IF NOT EXISTS admin_id TEXT UNIQUE")
            cur.execute("UPDATE admins SET admin_id = 'ADMIN-001' WHERE admin_id IS NULL AND id = 1")

            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS event_id TEXT UNIQUE")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS start_time TEXT")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time TEXT")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS venue TEXT")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer TEXT")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS department TEXT")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS category TEXT")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS image_url TEXT")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_url TEXT")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS max_participants INTEGER")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'published'")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by INTEGER")
            cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ")

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS announcements (
                    id BIGSERIAL PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    status TEXT DEFAULT 'draft',
                    created_by INTEGER NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ
                )
                """
            )

            cur.execute("SELECT id, email, password_hash FROM admins ORDER BY id LIMIT 1")
            existing_admin = cur.fetchone()
            if not existing_admin:
                cur.execute(
                    "INSERT INTO admins (name, email, password_hash, role, created_at) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (
                        "Campus Administrator",
                        ADMIN_EMAIL,
                        generate_password_hash(ADMIN_PASSWORD),
                        "admin",
                        datetime.now(),
                    ),
                )
            else:
                # Keep the bootstrap admin's credentials in sync with the
                # current ADMIN_EMAIL / ADMIN_PASSWORD environment variables.
                # Without this, changing .env after the admin row was first
                # seeded would leave stale credentials in the database,
                # causing correct .env credentials to be rejected at login.
                credentials_changed = (
                    existing_admin["email"] != ADMIN_EMAIL
                    or not check_password_hash(existing_admin["password_hash"], ADMIN_PASSWORD)
                )
                if credentials_changed:
                    cur.execute(
                        "UPDATE admins SET email = %s, password_hash = %s WHERE id = %s",
                        (ADMIN_EMAIL, generate_password_hash(ADMIN_PASSWORD), existing_admin["id"]),
                    )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def parse_user_agent():
    raw_user_agent = request.headers.get("User-Agent", "")
    browser_patterns = [
        ("Edge", r"(?:Edg|Edge)/([\d.]+)"),
        ("Opera", r"(?:OPR|Opera)/([\d.]+)"),
        ("Chrome", r"Chrome/([\d.]+)"),
        ("Firefox", r"Firefox/([\d.]+)"),
        ("Safari", r"Version/([\d.]+).*Safari/"),
        ("Internet Explorer", r"(?:MSIE |rv:)([\d.]+)"),
    ]
    browser = "Unknown"
    for name, pattern in browser_patterns:
        match = re.search(pattern, raw_user_agent, re.IGNORECASE)
        if match:
            browser = f"{name} {match.group(1).split('.')[0]}"
            break

    if re.search(r"Windows", raw_user_agent, re.IGNORECASE):
        operating_system = "Windows"
    elif re.search(r"iPhone|iPad|iPod", raw_user_agent, re.IGNORECASE):
        operating_system = "iOS"
    elif re.search(r"Android", raw_user_agent, re.IGNORECASE):
        operating_system = "Android"
    elif re.search(r"Macintosh|Mac OS X", raw_user_agent, re.IGNORECASE):
        operating_system = "macOS"
    elif re.search(r"Linux", raw_user_agent, re.IGNORECASE):
        operating_system = "Linux"
    else:
        operating_system = "Unknown"
    return browser, operating_system


def record_login_attempt(email: str, user_type: str, success: bool):
    """Record a login attempt without making authentication depend on logging."""
    conn = None
    try:
        ip_address = request.access_route[0] if request.access_route else request.remote_addr
        browser, _ = parse_user_agent()
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO login_attempts "
                "(email, user_type, success, ip_address, browser) "
                "VALUES (%s, %s, %s, %s, %s)",
                (email, user_type, success, ip_address, browser),
            )
        conn.commit()
    except Exception as error:
        if conn:
            conn.rollback()
        app.logger.warning("Could not record login attempt: %s", error)
    finally:
        if conn:
            conn.close()


def record_login_history(user_type: str, user_id: int):
    """Record a verified login without making authentication depend on logging."""
    conn = get_db()
    try:
        ip_address = request.access_route[0] if request.access_route else request.remote_addr
        browser, operating_system = parse_user_agent()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO login_history "
                "(user_id, user_type, ip_address, browser, operating_system) "
                "VALUES (%s, %s, %s, %s, %s)",
                (user_id, user_type, ip_address, browser, operating_system),
            )
        conn.commit()
    except Exception as error:
        conn.rollback()
        app.logger.warning("Could not record login history: %s", error)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# "AI" classification
# ---------------------------------------------------------------------------
# If a GOOGLE_API_KEY is set, classify_text() uses real Gemini AI to
# understand the complaint. If no key is set, or the API call fails for any
# reason (no internet, bad key, etc.), it automatically falls back to the
# keyword-based classifier below, so the app never breaks.
VALID_CATEGORIES = [
    "Classroom Equipment", "Hostel / Facilities", "IT / Network",
    "Library", "Canteen / Food", "Administrative", "General Enquiry",
]
VALID_PRIORITIES = ["Low", "Medium", "High"]
VALID_INTENTS = ["complaint", "lost_found", "event_search", "campus_service", "navigation", "general"]
DEPARTMENT_BY_CATEGORY = {
    "Classroom Equipment": "Maintenance",
    "Hostel / Facilities": "Facilities",
    "IT / Network": "IT Support",
    "Library": "Library Services",
    "Canteen / Food": "Canteen Management",
    "Administrative": "Administrative Office",
    "General Enquiry": "Helpdesk",
}

CATEGORY_RULES = {
    "Classroom Equipment": ["projector", "mic", "microphone", "speaker", "ac", "fan", "board", "light", "bulb"],
    "Hostel / Facilities": ["hostel", "water", "leak", "plumbing", "electricity", "room", "washroom", "toilet"],
    "IT / Network": ["wifi", "internet", "network", "login", "portal", "password", "website", "laptop"],
    "Library": ["library", "book", "librarian"],
    "Canteen / Food": ["canteen", "food", "mess", "cafeteria"],
    "Administrative": ["fee", "certificate", "form", "document", "admission", "registration"],
}

URGENT_WORDS = ["not working", "broken", "urgent", "emergency", "leak", "fire", "safety", "danger"]


def get_working_gemini_model():
    """Ask Google which models are currently available for this API key and
    pick a cheap, fast one that supports generateContent. This avoids
    hardcoding a model name that Google might rename or retire later -
    the app just asks fresh each time it's needed (and caches the answer
    for the rest of this run)."""
    global _cached_gemini_model
    if _cached_gemini_model:
        return _cached_gemini_model

    resp = requests.get(GEMINI_LIST_URL, params={"key": GOOGLE_API_KEY}, timeout=10)
    resp.raise_for_status()
    models = resp.json().get("models", [])

    def supports_generate(m):
        return "generateContent" in m.get("supportedGenerationMethods", [])

    # Prefer a cheap "flash-lite" model, then any "flash" model, then
    # anything at all that supports generateContent.
    flash_lite = [m["name"] for m in models if supports_generate(m) and "flash-lite" in m["name"]]
    flash = [m["name"] for m in models if supports_generate(m) and "flash" in m["name"]]
    any_model = [m["name"] for m in models if supports_generate(m)]

    chosen = (flash_lite or flash or any_model)
    if not chosen:
        raise RuntimeError("No usable Gemini model found for this API key")

    _cached_gemini_model = chosen[0]  # e.g. "models/gemini-2.5-flash-lite"
    print(f"[Campus Copilot] Using Gemini model: {_cached_gemini_model}")
    return _cached_gemini_model


def classify_with_ai(text: str):
    """Ask Gemini to classify the complaint via a direct REST call (no SDK,
    so we're not at the mercy of an SDK version falling behind Google's
    model API). Raises an exception on any failure so the caller can fall
    back to the keyword classifier."""
    model_name = get_working_gemini_model()  # e.g. "models/gemini-2.5-flash-lite"
    url = f"https://generativelanguage.googleapis.com/v1beta/{model_name}:generateContent"

    prompt = f"""You are classifying a student query for a campus helpdesk AI assistant.

Intents (pick exactly one): complaint, lost_found, event_search, campus_service, navigation, general
Categories (pick exactly one): {", ".join(VALID_CATEGORIES)}
Priorities (pick exactly one): {", ".join(VALID_PRIORITIES)}

Query: "{text}"

Guidelines:
- If the query is a greeting or asks about the AI itself (e.g., "hello", "who are you", "what are you"), classify as "general"
- If the query is about a specific campus problem/issue, classify as "complaint"
- If the query is about lost/found items, classify as "lost_found"
- If the query is about campus events, classify as "event_search"
- If the query is about campus services, classify as "campus_service"
- If the query is about directions/location, classify as "navigation"

Reply with ONLY a JSON object, no other text, in this exact format:
{{"intent": "complaint", "category": "...", "priority": "...", "suggested_department": "...", "next_action": "..."}}"""

    response = requests.post(
        url,
        params={"key": GOOGLE_API_KEY},
        json={"contents": [{"parts": [{"text": prompt}]}]},
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()

    raw = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    result = json.loads(raw)

    category = result.get("category")
    priority = result.get("priority")
    intent = result.get("intent")
    if category not in VALID_CATEGORIES or priority not in VALID_PRIORITIES or intent not in VALID_INTENTS:
        raise ValueError(f"Unexpected AI response: {result}")

    result["suggested_department"] = result.get("suggested_department") or DEPARTMENT_BY_CATEGORY[category]
    result["next_action"] = result.get("next_action") or ("submit_complaint" if intent == "complaint" else "open_service")
    return result


def classify_with_keywords(text: str):
    lower = text.lower()

    if any(word in lower for word in ["lost", "missing", "found", "wallet", "phone"]):
        return {"intent": "lost_found", "category": "General Enquiry", "priority": "Medium", "suggested_department": "Lost & Found Desk", "next_action": "open_lost_found"}
    if any(word in lower for word in ["event", "announcement", "schedule", "program"]):
        return {"intent": "event_search", "category": "General Enquiry", "priority": "Low", "suggested_department": "Student Affairs", "next_action": "view_events"}
    if any(word in lower for word in ["where", "directions", "navigate", "location"]):
        return {"intent": "navigation", "category": "General Enquiry", "priority": "Low", "suggested_department": "Campus Helpdesk", "next_action": "open_map"}
    if any(word in lower for word in ["hello", "hi ", "hey", "who are you", "what are you", "help", "support", "assistant"]):
        return {"intent": "general", "category": "General Enquiry", "priority": "Low", "suggested_department": "Campus Helpdesk", "next_action": "general_inquiry"}

    category = "General Enquiry"
    for cat, keywords in CATEGORY_RULES.items():
        if any(k in lower for k in keywords):
            category = cat
            break

    priority = "Medium"
    if any(w in lower for w in URGENT_WORDS):
        priority = "High"
    elif len(lower.split()) < 5:
        priority = "Low"

    return {"intent": "complaint", "category": category, "priority": priority, "suggested_department": DEPARTMENT_BY_CATEGORY[category], "next_action": "submit_complaint"}


def classify_text(text: str):
    if GOOGLE_API_KEY:
        try:
            return classify_with_ai(text)
        except Exception as e:
            print(f"[Campus Copilot] AI classification failed, falling back to keywords: {e}")

    return classify_with_keywords(text)


# ---------------------------------------------------------------------------
# Routes - pages
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    if require_admin():
        return redirect(url_for("admin_dashboard"))
    if current_student_record():
        return render_template("index.html")
    return render_template("index.html")


@app.route("/student/login")
def student_login_page():
    return render_template("index.html")


@app.route("/admin")
def admin_page():
    return redirect(url_for("admin_dashboard" if require_admin() else "admin_login_page"))


@app.route("/admin/login")
def admin_login_page():
    if require_admin():
        return redirect(url_for("admin_dashboard"))
    return render_template("admin_login.html")


@app.route("/admin/dashboard")
def admin_dashboard():
    if not require_admin():
        return redirect(url_for("admin_login_page"))
    return render_template("admin.html")


# ---------------------------------------------------------------------------
# Routes - student authentication (registration + hashed-password login)
# ---------------------------------------------------------------------------
def normalize_roll_number(raw: str) -> str:
    return raw.strip().upper()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def send_verification_code(email: str, code: str, purpose: str):
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_user = os.environ.get("SMTP_USERNAME")
    smtp_password = os.environ.get("SMTP_PASSWORD")
    sender = os.environ.get("SMTP_FROM", smtp_user or "no-reply@campuscopilot.local")
    if not all([smtp_host, smtp_user, smtp_password]):
        if DEBUG:
            print(f"[Campus Copilot] Development {purpose} code for {email}: {code}")
            return
        raise RuntimeError("Email delivery is not configured")

    message = EmailMessage()
    message["Subject"] = f"Campus Copilot {purpose} code"
    message["From"] = sender
    message["To"] = email
    message.set_content(f"Your Campus Copilot {purpose.lower()} code is {code}. It expires in 10 minutes.")
    with smtplib.SMTP(smtp_host, int(os.environ.get("SMTP_PORT", "587")), timeout=10) as smtp:
        smtp.starttls()
        smtp.login(smtp_user, smtp_password)
        smtp.send_message(message)


def create_one_time_code():
    return f"{secrets.randbelow(1000000):06d}"


@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    roll_number = normalize_roll_number(data.get("roll_number", ""))
    college_email = data.get("college_email", "").strip().lower()
    password = data.get("password", "")

    if not name or not roll_number or not college_email or not password:
        return jsonify({"error": "name, roll_number, college_email and password are required"}), 400
    if not ROLL_NUMBER_RE.match(roll_number):
        return jsonify({"error": "roll_number looks invalid"}), 400
    if not EMAIL_RE.match(college_email):
        return jsonify({"error": "Enter a valid college email address"}), 400
    if COLLEGE_EMAIL_DOMAIN and college_email.split("@", 1)[1] != COLLEGE_EMAIL_DOMAIN:
        return jsonify({"error": f"Use your college email ending in @{COLLEGE_EMAIL_DOMAIN}"}), 400
    if len(password) < 8:
        return jsonify({"error": "password must be at least 8 characters"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT id FROM students WHERE roll_number = %s OR college_email = %s", (roll_number, college_email)
    )
    existing = cur.fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "An account with this roll number or email already exists."}), 409

    password_hash = generate_password_hash(password)
    cur.execute(
        "INSERT INTO students (name, roll_number, college_email, password_hash, is_verified, created_at) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (name, roll_number, college_email, password_hash, True, datetime.now()),
    )
    student_id = cur.fetchone()["id"]
    conn.commit()
    conn.close()
    session.pop("admin_id", None)
    session.pop("admin_role", None)
    session["student_id"] = student_id
    session["student_name"] = name
    session["roll_number"] = roll_number
    return jsonify({"message": "Account created. You can now log in.", "name": name, "roll_number": roll_number}), 201


@app.route("/api/verify-email", methods=["POST"])
def verify_email():
    data = request.get_json(force=True)
    college_email = data.get("college_email", "").strip().lower()
    code = data.get("code", "").strip()
    if not EMAIL_RE.match(college_email) or not re.fullmatch(r"\d{6}", code):
        return jsonify({"error": "A valid email and 6-digit code are required"}), 400

    now = int(time.time())
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM students WHERE college_email = %s", (college_email,))
    student = cur.fetchone()
    token = None
    if student:
        cur.execute(
            "SELECT * FROM email_verification_tokens WHERE student_id = %s AND used_at IS NULL ORDER BY id DESC LIMIT 1",
            (student["id"],),
        )
        token = cur.fetchone()
    if not student or not token or token["expires_at"] < datetime.now() or not secrets.compare_digest(token["token_hash"], hash_token(code)):
        conn.close()
        return jsonify({"error": "Invalid or expired verification code"}), 400

    cur.execute("UPDATE students SET is_verified = TRUE WHERE id = %s", (student["id"],))
    cur.execute("UPDATE email_verification_tokens SET used_at = %s WHERE id = %s", (datetime.now(), token["id"]))
    conn.commit()
    conn.close()
    return jsonify({"message": "Email verified. You can now log in."})


@app.route("/api/resend-verification", methods=["POST"])
def resend_verification():
    college_email = request.get_json(force=True).get("college_email", "").strip().lower()
    if not EMAIL_RE.match(college_email):
        return jsonify({"error": "Enter a valid college email address"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM students WHERE college_email = %s", (college_email,))
    student = cur.fetchone()
    if not student or student["is_verified"]:
        conn.close()
        return jsonify({"message": "If the account is eligible, a new verification code has been sent."})

    now = int(time.time())
    code = create_one_time_code()
    cur.execute(
        "INSERT INTO email_verification_tokens (student_id, token_hash, expires_at, created_at) VALUES (%s, %s, %s, %s)",
        (student["id"], hash_token(code), datetime.now() + timedelta(seconds=OTP_EXPIRY_SECONDS), datetime.now()),
    )
    conn.commit()
    conn.close()
    try:
        send_verification_code(college_email, code, "email verification")
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 503
    return jsonify({"message": "A new verification code has been sent."})


@app.route("/api/forgot-password", methods=["POST"])
def forgot_password():
    college_email = request.get_json(force=True).get("college_email", "").strip().lower()
    if not EMAIL_RE.match(college_email):
        return jsonify({"error": "Enter a valid college email address"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM students WHERE college_email = %s AND is_active = TRUE", (college_email,)
    )
    student = cur.fetchone()
    if not student:
        conn.close()
        return jsonify({"message": "If that account exists, a reset code has been sent."})

    now = int(time.time())
    code = create_one_time_code()
    cur.execute(
        "INSERT INTO password_reset_tokens (student_id, token_hash, expires_at, created_at) VALUES (%s, %s, %s, %s)",
        (student["id"], hash_token(code), datetime.now() + timedelta(seconds=RESET_TOKEN_EXPIRY_SECONDS), datetime.now()),
    )
    conn.commit()
    conn.close()
    try:
        send_verification_code(college_email, code, "password reset")
    except RuntimeError:
        pass
    return jsonify({"message": "If that account exists, a reset code has been sent."})


@app.route("/api/reset-password", methods=["POST"])
def reset_password():
    data = request.get_json(force=True)
    college_email = data.get("college_email", "").strip().lower()
    code = data.get("code", "").strip()
    new_password = data.get("new_password", "")
    if not EMAIL_RE.match(college_email) or not re.fullmatch(r"\d{6}", code):
        return jsonify({"error": "A valid email and 6-digit reset code are required"}), 400
    if len(new_password) < 8:
        return jsonify({"error": "new_password must be at least 8 characters"}), 400

    now = int(time.time())
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM students WHERE college_email = %s", (college_email,))
    student = cur.fetchone()
    token = None
    if student:
        cur.execute(
            "SELECT * FROM password_reset_tokens WHERE student_id = %s AND used_at IS NULL ORDER BY id DESC LIMIT 1",
            (student["id"],),
        )
        token = cur.fetchone()
    if not student or not token or token["expires_at"] < datetime.now() or not secrets.compare_digest(token["token_hash"], hash_token(code)):
        conn.close()
        return jsonify({"error": "Invalid or expired reset code"}), 400

    cur.execute("UPDATE students SET password_hash = %s WHERE id = %s", (generate_password_hash(new_password), student["id"]))
    cur.execute("UPDATE password_reset_tokens SET used_at = %s WHERE id = %s", (datetime.now(), token["id"]))
    conn.commit()
    conn.close()
    return jsonify({"message": "Password reset. You can now log in."})


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    password = data.get("password", "")

    if is_rate_limited("student-login"):
        record_login_attempt(name, "student", False)
        return jsonify({"error": "Too many failed attempts. Try again in a few minutes."}), 429

    if not name or not password:
        record_login_attempt(name, "student", False)
        return jsonify({"error": "name and password are required"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM students WHERE name ILIKE %s ORDER BY id LIMIT 1", (name,)
    )
    student = cur.fetchone()
    conn.close()

    if not student or not check_password_hash(student["password_hash"], password):
        record_login_attempt(student["college_email"] if student else name, "student", False)
        record_failed_attempt("student-login")
        return jsonify({"error": "Incorrect roll number or password"}), 401
    if not student["is_verified"]:
        record_login_attempt(student["college_email"], "student", False)
        return jsonify({"error": "Verify your college email before logging in"}), 403
    if not student["is_active"]:
        record_login_attempt(student["college_email"], "student", False)
        return jsonify({"error": "This account is inactive"}), 403

    clear_attempts("student-login")
    session.pop("admin_id", None)
    session.pop("admin_role", None)
    session["student_name"] = student["name"]
    session["roll_number"] = student["roll_number"]
    session["student_id"] = student["id"]
    record_login_attempt(student["college_email"], "student", True)
    record_login_history("student", student["id"])
    return jsonify({"name": student["name"], "roll_number": student["roll_number"]})


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logged out"})


@app.route("/api/me", methods=["GET"])
def me():
    if "roll_number" not in session:
        return jsonify({"error": "Not logged in"}), 401
    return jsonify({"name": session["student_name"], "roll_number": session["roll_number"]})


def current_student():
    """Returns (name, roll_number) for the logged-in student, or (None, None)."""
    return session.get("student_name"), session.get("roll_number")


def current_student_record():
    student_id = session.get("student_id")
    if not student_id:
        return None
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM students WHERE id = %s AND is_active = TRUE AND is_verified = TRUE",
        (student_id,),
    )
    student = cur.fetchone()
    conn.close()
    return student


# ---------------------------------------------------------------------------
# Routes - separate database-backed admin authentication
# ---------------------------------------------------------------------------
@app.route("/api/admin/login", methods=["POST"])
def admin_login():
    data = request.get_json(force=True)
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if is_rate_limited("admin-login"):
        record_login_attempt(email, "admin", False)
        return jsonify({"error": "Too many failed attempts. Try again in a few minutes."}), 429

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM admins WHERE email = %s AND is_active = TRUE", (email,)
    )
    admin = cur.fetchone()
    if not admin or not check_password_hash(admin["password_hash"], password):
        conn.close()
        record_login_attempt(email, "admin", False)
        record_failed_attempt("admin-login")
        return jsonify({"error": "Incorrect email or password"}), 401

    clear_attempts("admin-login")
    cur.execute(
        "UPDATE admins SET last_login_at = %s WHERE id = %s",
        (datetime.now(), admin["id"]),
    )
    conn.commit()
    conn.close()
    session.pop("student_id", None)
    session.pop("student_name", None)
    session.pop("roll_number", None)
    session["admin_id"] = admin["id"]
    session["admin_role"] = admin["role"]
    record_login_attempt(email, "admin", True)
    record_login_history("admin", admin["id"])
    return jsonify({"message": "Logged in as admin", "email": admin["email"], "role": admin["role"]})


@app.route("/api/admin/logout", methods=["POST"])
def admin_logout():
    session.pop("admin_id", None)
    session.pop("admin_role", None)
    return jsonify({"message": "Logged out"})


@app.route("/api/admin/me", methods=["GET"])
def admin_me():
    admin = current_admin()
    if not admin:
        return jsonify({"error": "Not logged in"}), 401
    return jsonify({
        "is_admin": True,
        "admin_id": admin.get("admin_id"),
        "name": admin.get("name"),
        "email": admin["email"],
        "role": admin["role"],
        "status": "Active" if admin.get("is_active") else "Inactive",
        "created_at": admin.get("created_at")
    })


def current_admin():
    admin_id = session.get("admin_id")
    if not admin_id:
        return None
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM admins WHERE id = %s AND is_active = TRUE", (admin_id,)
    )
    admin = cur.fetchone()
    conn.close()
    return admin


def require_admin():
    admin = current_admin()
    return admin is not None and admin["role"] in ("admin", "super_admin")


@app.route("/admin/login-history")
def admin_login_history_page():
    if not require_admin():
        return redirect(url_for("admin_login_page"))
    return render_template("admin_login_history.html")


@app.route("/api/admin/login-history", methods=["GET"])
def admin_login_history():
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401

    email = request.args.get("email", "").strip()
    user_type = request.args.get("user_type", "").strip().lower()
    login_date = request.args.get("date", "").strip()
    if user_type not in {"", "student", "admin"}:
        return jsonify({"error": "Invalid user type"}), 400

    conditions = []
    params = []
    if email:
        conditions.append("(s.college_email ILIKE %s OR a.email ILIKE %s)")
        params.extend([f"%{email}%", f"%{email}%"])
    if user_type:
        conditions.append("lh.user_type = %s")
        params.append(user_type)
    if login_date:
        conditions.append("lh.login_time::date = %s")
        params.append(login_date)

    query = (
        "SELECT lh.id, lh.user_id, lh.user_type, lh.login_time, lh.ip_address, "
        "COALESCE(s.name, a.name) AS user_name, "
        "COALESCE(s.college_email, a.email) AS user_email "
        "FROM login_history lh "
        "LEFT JOIN students s ON lh.user_type = 'student' AND s.id = lh.user_id "
        "LEFT JOIN admins a ON lh.user_type = 'admin' AND a.id = lh.user_id"
    )
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY lh.login_time DESC, lh.id DESC LIMIT 500"

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
        return jsonify([dict(row) for row in rows])
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Routes - admin data (all complaints across every student, status updates)
# ---------------------------------------------------------------------------
@app.route("/api/admin/complaints", methods=["GET"])
def admin_get_complaints():
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT complaints.*, complaints.name AS student_name "
        "FROM complaints ORDER BY complaints.id DESC"
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/admin/complaints/<int:complaint_id>/status", methods=["POST"])
def admin_update_status(complaint_id):
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401

    data = request.get_json(force=True)
    new_status = data.get("status", "")
    if new_status not in VALID_STATUSES:
        return jsonify({"error": f"status must be one of {VALID_STATUSES}"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE complaints SET status = %s WHERE id = %s", (new_status, complaint_id))
    conn.commit()
    conn.close()
    return jsonify({"message": "Status updated", "status": new_status})


@app.route("/api/admin/lost-found", methods=["GET"])
def admin_get_lost_found():
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT lost_found.*, students.name AS student_name, students.roll_number "
        "FROM lost_found JOIN students ON students.id = lost_found.student_id "
        "ORDER BY lost_found.id DESC"
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/admin/lost-found/<int:item_id>/status", methods=["POST"])
def admin_update_lost_found_status(item_id):
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401

    data = request.get_json(force=True)
    new_status = data.get("status", "")
    if new_status not in VALID_LOST_FOUND_STATUSES:
        return jsonify({"error": f"status must be one of {VALID_LOST_FOUND_STATUSES}"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE lost_found SET status = %s WHERE id = %s", (new_status, item_id))
    conn.commit()
    conn.close()
    return jsonify({"message": "Status updated", "status": new_status})


# ---------------------------------------------------------------------------
# Routes - AI assistant
# ---------------------------------------------------------------------------
@app.route("/api/classify", methods=["POST"])
def api_classify():
    if not current_student_record():
        return jsonify({"error": "Not logged in"}), 401
    data = request.get_json(force=True)
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "text is required"}), 400

    return jsonify(classify_text(text))


# ---------------------------------------------------------------------------
# Routes - complaints
# ---------------------------------------------------------------------------
@app.route("/api/complaints", methods=["GET"])
def get_complaints():
    student = current_student_record()
    if not student:
        return jsonify({"error": "Not logged in"}), 401

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM complaints WHERE student_id = %s ORDER BY id DESC", (student["id"],)
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/complaints", methods=["POST"])
def create_complaint():
    student = current_student_record()
    if not student:
        return jsonify({"error": "Not logged in"}), 401

    data = request.get_json(force=True)
    description = data.get("description", "").strip()
    if not description or len(description) > 2000:
        return jsonify({"error": "description is required"}), 400

    classification = classify_text(description)

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO complaints (student_id, name, roll_number, college_email, description, category, priority, status, created_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (student["id"], student["name"], student["roll_number"], student["college_email"], description, classification["category"], classification["priority"], "Open", datetime.now()),
    )
    conn.commit()
    conn.close()
    return jsonify({"message": "Complaint submitted", **classification}), 201


# ---------------------------------------------------------------------------
# Routes - lost & found
# ---------------------------------------------------------------------------
@app.route("/api/lost-found", methods=["GET"])
def get_lost_found():
    # Lost & Found stays a shared list (everyone should see everyone's items),
    # but still requires being logged in to view/use the app at all.
    if not current_student_record():
        return jsonify({"error": "Not logged in"}), 401

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM lost_found ORDER BY id DESC")
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/lost-found", methods=["POST"])
def create_lost_found():
    student = current_student_record()
    if not student:
        return jsonify({"error": "Not logged in"}), 401

    data = request.get_json(force=True)
    item_name = data.get("item_name", "").strip()
    item_type = data.get("item_type", "Lost").strip()
    description = data.get("description", "").strip()
    location = data.get("location", "").strip()
    if not item_name or len(item_name) > 200:
        return jsonify({"error": "item_name is required and must be under 200 characters"}), 400
    if item_type not in ("Lost", "Found"):
        return jsonify({"error": "item_type must be Lost or Found"}), 400
    if len(description) > 2000 or len(location) > 300:
        return jsonify({"error": "description or location is too long"}), 400

    # Default the contact field to the student's own name + roll number if
    # they didn't type anything in the contact field.
    contact = data.get("contact", "").strip() or f"{student['name']} ({student['roll_number']})"
    if len(contact) > 200:
        return jsonify({"error": "contact is too long"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO lost_found (student_id, item_type, item_name, description, location, contact, created_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            student["id"],
            item_type,
            item_name,
            description,
            location,
            contact,
            datetime.now(),
        ),
    )
    conn.commit()
    conn.close()
    return jsonify({"message": "Item reported"}), 201


# ---------------------------------------------------------------------------
# Routes - events & announcements
# ---------------------------------------------------------------------------
@app.route("/api/events", methods=["GET"])
def get_events():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM events WHERE status = 'published' ORDER BY id DESC")
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/admin/events", methods=["GET"])
def admin_get_events():
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM events ORDER BY id DESC")
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/admin/events", methods=["POST"])
def admin_create_event():
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    
    admin = current_admin()
    data = request.get_json(force=True)
    title = data.get("title", "").strip()
    if not title:
        return jsonify({"error": "title is required"}), 400

    event_id = f"EVT-{int(time.time())}"
    
    event_date_value = data.get("event_date", "").strip()
    if not event_date_value:
        event_date = datetime.now()
    else:
        try:
            event_date = datetime.fromisoformat(event_date_value)
        except ValueError:
            try:
                event_date = datetime.strptime(event_date_value, "%d %b %Y")
            except ValueError:
                event_date = datetime.now()

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO events (event_id, title, description, event_date, start_time, end_time, venue, organizer, department, category, image_url, registration_url, max_participants, status, created_by, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            event_id,
            title,
            data.get("description", ""),
            event_date,
            data.get("start_time", ""),
            data.get("end_time", ""),
            data.get("venue", ""),
            data.get("organizer", ""),
            data.get("department", ""),
            data.get("category", ""),
            data.get("image_url", ""),
            data.get("registration_url", ""),
            data.get("max_participants") or None,
            data.get("status", "published"),
            admin["id"],
            datetime.now()
        )
    )
    conn.commit()
    conn.close()
    return jsonify({"message": "Event added"}), 201

@app.route("/api/admin/events/<int:id>", methods=["PUT"])
def admin_update_event(id):
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    data = request.get_json(force=True)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE events SET title=%s, description=%s, status=%s, updated_at=%s WHERE id=%s", (
        data.get("title", ""), data.get("description", ""), data.get("status", "published"), datetime.now(), id
    ))
    conn.commit()
    conn.close()
    return jsonify({"message": "Event updated"})

@app.route("/api/admin/events/<int:id>", methods=["DELETE"])
def admin_delete_event(id):
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM events WHERE id=%s", (id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Event deleted"})

@app.route("/api/admin/announcements", methods=["GET"])
def admin_get_announcements():
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM announcements ORDER BY id DESC")
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/admin/announcements", methods=["POST"])
def admin_create_announcement():
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    admin = current_admin()
    data = request.get_json(force=True)
    title = data.get("title", "").strip()
    if not title:
        return jsonify({"error": "title is required"}), 400
    
    conn = get_db()
    cur = conn.cursor()
    cur.execute("INSERT INTO announcements (title, content, status, created_by, created_at) VALUES (%s, %s, %s, %s, %s)", (
        title, data.get("content", ""), data.get("status", "published"), admin["id"], datetime.now()
    ))
    conn.commit()
    conn.close()
    return jsonify({"message": "Announcement added"}), 201

@app.route("/api/admin/announcements/<int:id>", methods=["PUT"])
def admin_update_announcement(id):
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    data = request.get_json(force=True)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE announcements SET title=%s, content=%s, status=%s, updated_at=%s WHERE id=%s", (
        data.get("title", ""), data.get("content", ""), data.get("status", "published"), datetime.now(), id
    ))
    conn.commit()
    conn.close()
    return jsonify({"message": "Announcement updated"})

@app.route("/api/admin/announcements/<int:id>", methods=["DELETE"])
def admin_delete_announcement(id):
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM announcements WHERE id=%s", (id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Announcement deleted"})

@app.route("/api/admin/users", methods=["GET"])
def admin_get_users():
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id, name, roll_number, college_email, role, is_active, is_verified, created_at FROM students ORDER BY id DESC")
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/admin/users/<int:id>/status", methods=["POST"])
def admin_update_user_status(id):
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    data = request.get_json(force=True)
    is_active = data.get("is_active", True)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE students SET is_active=%s WHERE id=%s", (is_active, id))
    conn.commit()
    conn.close()
    return jsonify({"message": "User status updated"})

@app.route("/api/admin/dashboard/stats", methods=["GET"])
def admin_dashboard_stats():
    if not require_admin():
        return jsonify({"error": "Not logged in as admin"}), 401
    conn = get_db()
    cur = conn.cursor()
    stats = {}
    cur.execute("SELECT COUNT(*) as count FROM students")
    stats["total_students"] = cur.fetchone()["count"]
    cur.execute("SELECT COUNT(*) as count FROM events WHERE status = 'published'")
    stats["active_events"] = cur.fetchone()["count"]
    cur.execute("SELECT COUNT(*) as count FROM complaints WHERE status = 'Open'")
    stats["pending_complaints"] = cur.fetchone()["count"]
    cur.execute("SELECT COUNT(*) as count FROM complaints WHERE status = 'In Progress'")
    stats["in_progress_complaints"] = cur.fetchone()["count"]
    cur.execute("SELECT COUNT(*) as count FROM complaints WHERE status = 'Resolved'")
    stats["resolved_complaints"] = cur.fetchone()["count"]
    cur.execute("SELECT COUNT(*) as count FROM lost_found WHERE status = 'Active'")
    stats["active_lost_found"] = cur.fetchone()["count"]
    cur.execute("SELECT COUNT(*) as count FROM announcements")
    stats["total_announcements"] = cur.fetchone()["count"]
    conn.close()
    return jsonify(stats)


init_db()  # validate the existing PostgreSQL tables and initialize the admin
           # whether this file is run directly or imported by a WSGI server

if __name__ == "__main__":
    # debug=True enables Werkzeug's interactive debugger, which can execute
    # arbitrary code from the browser - it must never be on for a publicly
    # reachable deployment. Controlled by FLASK_DEBUG in .env (see top of file).
    app.run(debug=DEBUG, port=int(os.environ.get("PORT", 5000)), host="0.0.0.0")