import os
from dotenv import dotenv_values
from werkzeug.security import generate_password_hash
import psycopg2

project_root = "c:/Users/atcha/Desktop/campus-copilot-final"
env_path = os.path.join(project_root, ".env")
values = dotenv_values(env_path)
if values:
    for key, value in values.items():
        if value is not None:
            os.environ[key] = value

email = os.environ.get("ADMIN_EMAIL", "").strip()
password = os.environ.get("ADMIN_PASSWORD", "")
if not email or not password:
    raise SystemExit("ADMIN_EMAIL and ADMIN_PASSWORD must both be set in the .env file.")

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
cur.execute("SELECT id, email, role FROM admins ORDER BY id")
print("BEFORE:", cur.fetchall())
cur.execute(
    "UPDATE admins SET email = %s, password_hash = %s WHERE role = 'admin'",
    (email, generate_password_hash(password)),
)
conn.commit()
cur.execute("SELECT id, email, role FROM admins WHERE role = 'admin' ORDER BY id")
print("AFTER:", cur.fetchall())
conn.close()
