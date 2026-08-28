// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
// Escapes user-supplied text before it's placed into innerHTML, so a
// complaint, item name, or event description that happens to contain HTML
// (e.g. "<img src=x onerror=...>") is displayed as plain text instead of
// being executed as markup/script in every viewer's browser.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Authentication views
// ---------------------------------------------------------------------------
const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");
const currentUserLabel = document.getElementById("current-user-label");
const helloHeading = document.getElementById("hello-heading");
const switchUserBtn = document.getElementById("switch-user-btn");
const views = {
  login: document.getElementById("auth-login-view"),
  register: document.getElementById("auth-register-view"),
  verify: document.getElementById("auth-verify-view"),
  reset: document.getElementById("auth-reset-view"),
};
let verificationEmail = "";
let verificationTimer;

function showError(el, message) {
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideError(el) { el.classList.add("hidden"); }

function switchAuthView(name) {
  Object.values(views).forEach((view) => view.classList.toggle("hidden", view !== views[name]));
  document.querySelectorAll(".auth-view .error-text").forEach(hideError);
}

function maskEmail(email) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}${"*".repeat(Math.max(4, name.length - 1))}@${domain}`;
}

function startCountdown(seconds = 300) {
  clearInterval(verificationTimer);
  const countdown = document.getElementById("verify-countdown");
  const tick = () => {
    const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
    const remaining = String(seconds % 60).padStart(2, "0");
    countdown.textContent = seconds > 0 ? `Code expires in ${minutes}:${remaining}` : "Code expired. Request a new one.";
    if (seconds > 0) seconds -= 1;
  };
  tick();
  verificationTimer = setInterval(tick, 1000);
}

function updateStrength(inputId, barsId, labelId) {
  const value = document.getElementById(inputId).value;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (/[A-Z]/.test(value)) score += 1;
  if (/[a-z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  const labels = [
    "Use 8+ characters",
    "Use 8+ characters",
    "Add uppercase letters",
    "Add numbers",
    "Add special characters",
    "Password requirements met",
  ];
  const bar = document.getElementById(barsId);
  bar.style.width = `${score * 20}%`;
  bar.dataset.level = score;
  document.getElementById(labelId).textContent = labels[score];
}

document.querySelectorAll(".password-toggle").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = document.getElementById(toggle.dataset.target);
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    toggle.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
  });
});

document.getElementById("register-password").addEventListener("input", () => updateStrength("register-password", "register-strength-bar", "register-strength-label"));
document.getElementById("reset-password").addEventListener("input", () => updateStrength("reset-password", "reset-strength-bar", "reset-strength-label"));
document.getElementById("show-register-link").addEventListener("click", (e) => { e.preventDefault(); switchAuthView("register"); });
document.getElementById("show-reset-link").addEventListener("click", (e) => { e.preventDefault(); switchAuthView("reset"); });
document.getElementById("show-login-link").addEventListener("click", (e) => { e.preventDefault(); switchAuthView("login"); });
document.getElementById("show-reset-login-link").addEventListener("click", (e) => { e.preventDefault(); switchAuthView("login"); });
document.getElementById("show-verify-login-link").addEventListener("click", (e) => { e.preventDefault(); switchAuthView("login"); });

async function checkLoginStatus() {
  const res = await fetch("/api/me");
  if (res.ok) showLoggedInUI(await res.json());
  else { loginScreen.classList.remove("hidden"); appShell.classList.add("hidden"); }
}

function showLoggedInUI(user) {
  loginScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  currentUserLabel.textContent = `${user.name} (${user.roll_number})`;
  helloHeading.textContent = `Hello, ${user.name.split(" ")[0]} 👋`;
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: document.getElementById("login-name").value.trim(), password: document.getElementById("login-password").value }) });
  const data = await res.json();
  if (res.ok) showLoggedInUI(data); else showError(document.getElementById("login-error"), data.error || "Login failed.");
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = document.getElementById("register-password").value;
  const confirm = document.getElementById("register-confirm-password").value;
  if (password !== confirm) return showError(document.getElementById("register-password-error"), "Passwords do not match.");
  const payload = { name: document.getElementById("register-name").value.trim(), roll_number: document.getElementById("register-roll").value.trim(), college_email: document.getElementById("register-email").value.trim(), password };
  const res = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) return showError(document.getElementById("register-error"), data.error || "Registration failed.");
  showLoggedInUI(data);
});

async function sendCode(endpoint, email, errorElement) {
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ college_email: email }) });
  const data = await res.json();
  if (!res.ok) showError(document.getElementById(errorElement), data.error || "Could not send code.");
  return res.ok;
}

document.getElementById("verify-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await fetch("/api/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ college_email: verificationEmail, code: document.getElementById("verify-code").value.trim() }) });
  const data = await res.json();
  if (!res.ok) return showError(document.getElementById("verify-error"), data.error || "Verification failed.");
  document.getElementById("verify-message").textContent = data.message;
  document.getElementById("verify-message").classList.remove("hidden");
  switchAuthView("login");
});

document.getElementById("resend-verify-link").addEventListener("click", async (e) => { e.preventDefault(); if (await sendCode("/api/resend-verification", verificationEmail, "verify-error")) startCountdown(); });
document.getElementById("reset-request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  verificationEmail = document.getElementById("reset-email").value.trim();
  if (await sendCode("/api/forgot-password", verificationEmail, "reset-error")) { document.getElementById("reset-form").classList.remove("hidden"); e.target.classList.add("hidden"); }
});
document.getElementById("resend-reset-link").addEventListener("click", async (e) => { e.preventDefault(); await sendCode("/api/forgot-password", verificationEmail, "reset-error"); });
document.getElementById("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = document.getElementById("reset-password").value;
  if (password !== document.getElementById("reset-confirm-password").value) return showError(document.getElementById("reset-password-error"), "Passwords do not match.");
  const res = await fetch("/api/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ college_email: verificationEmail, code: document.getElementById("reset-code").value.trim(), new_password: password }) });
  const data = await res.json();
  if (!res.ok) return showError(document.getElementById("reset-error"), data.error || "Password reset failed.");
  document.getElementById("reset-form").reset();
  document.getElementById("reset-request-form").reset();
  document.getElementById("reset-request-form").classList.remove("hidden");
  e.target.classList.add("hidden");
  switchAuthView("login");
});

switchUserBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
});

checkLoginStatus();

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
const menuButtons = document.querySelectorAll(".menu-item");
menuButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    menuButtons.forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));

    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");

    if (btn.dataset.tab === "complaints") loadComplaints();
    if (btn.dataset.tab === "lostfound") loadLostFound();
    if (btn.dataset.tab === "events") loadEvents();
  });
});

// ---------------------------------------------------------------------------
// AI Assistant
// ---------------------------------------------------------------------------
const chatLog = document.getElementById("chat-log");
const assistantForm = document.getElementById("assistant-form");
const assistantInput = document.getElementById("assistant-input");
const suggestionBox = document.getElementById("suggestion-box");
const suggIntent = document.getElementById("sugg-intent");
const suggCategory = document.getElementById("sugg-category");
const suggPriority = document.getElementById("sugg-priority");
const suggDepartment = document.getElementById("sugg-department");
const suggAction = document.getElementById("sugg-action");
const submitComplaintBtn = document.getElementById("submit-complaint-btn");

let lastQuery = "";

function addBubble(text, who) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${who}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
}

assistantForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = assistantInput.value.trim();
  if (!text) return;

  lastQuery = text;
  addBubble(text, "user");
  assistantInput.value = "";

  const res = await fetch("/api/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();

  addBubble(`I identified this as a ${data.intent.replace("_", " ")} request.`, "bot");

  suggIntent.textContent = data.intent.replace("_", " ");
  suggCategory.textContent = data.category;
  suggPriority.textContent = data.priority;
  suggDepartment.textContent = data.suggested_department;
  suggAction.textContent = data.next_action.replaceAll("_", " ");
  submitComplaintBtn.classList.toggle("hidden", data.next_action !== "submit_complaint");
  suggestionBox.classList.remove("hidden");

  const destinationTab = { open_lost_found: "lostfound", view_events: "events", open_map: "map" }[data.next_action];
  if (destinationTab) {
    const targetButton = document.querySelector(`[data-tab="${destinationTab}"]`);
    if (targetButton) targetButton.click();
  }
});

submitComplaintBtn.addEventListener("click", async () => {
  if (!lastQuery) return;
  const res = await fetch("/api/complaints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: lastQuery }),
  });
  if (res.ok) {
    addBubble("✅ Complaint submitted and is now being tracked.", "bot");
    suggestionBox.classList.add("hidden");
    lastQuery = "";
  }
});

// ---------------------------------------------------------------------------
// Complaints list
// ---------------------------------------------------------------------------
async function loadComplaints() {
  const res = await fetch("/api/complaints");
  const items = await res.json();
  const list = document.getElementById("complaints-list");
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = `<p>No complaints yet — ask the assistant something to get started.</p>`;
    return;
  }

  items.forEach((c) => {
    const div = document.createElement("div");
    div.className = "list-item";
    // priority/category/status come from our own fixed enums (server-side),
    // so they're safe to interpolate directly; description is free text
    // typed by a student, so it's escaped before going into innerHTML.
    div.innerHTML = `
      <span class="badge ${c.priority.toLowerCase()}">${c.priority}</span>
      <strong>${c.category}</strong>
      <p>${escapeHtml(c.description)}</p>
      <div class="meta">Status: ${c.status} · ${c.created_at}</div>
    `;
    list.appendChild(div);
  });
}

// ---------------------------------------------------------------------------
// Lost & Found
// ---------------------------------------------------------------------------
const lostFoundForm = document.getElementById("lostfound-form");
lostFoundForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    item_type: document.getElementById("lf-type").value,
    item_name: document.getElementById("lf-name").value,
    location: document.getElementById("lf-location").value,
    contact: document.getElementById("lf-contact").value,
  };
  const res = await fetch("/api/lost-found", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    lostFoundForm.reset();
    loadLostFound();
  }
});

async function loadLostFound() {
  const res = await fetch("/api/lost-found");
  const items = await res.json();
  const list = document.getElementById("lostfound-list");
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = `<p>No items reported yet.</p>`;
    return;
  }

  items.forEach((i) => {
    const div = document.createElement("div");
    div.className = "list-item";
    // item_type/status are fixed enums; item_name/location/contact are
    // free text typed by a student, so they're escaped.
    div.innerHTML = `
      <span class="badge">${i.item_type}</span>
      <span class="badge status-${(i.status || "Active").toLowerCase()}">${i.status || "Active"}</span>
      <strong>${escapeHtml(i.item_name)}</strong>
      <div class="meta">${escapeHtml(i.location) || "No location given"} · Contact: ${escapeHtml(i.contact) || "n/a"} · ${i.created_at}</div>
    `;
    list.appendChild(div);
  });
}

// ---------------------------------------------------------------------------
// Campus Map
// ---------------------------------------------------------------------------
// These pixel positions were computed from real GPS coordinates (not
// guessed) using 2 known reference points (Main Entrance and the running
// track, both clearly visible in the photo) to calibrate GPS <-> image
// pixels. If a pin still looks slightly off once you compare it to the
// real campus, nudge its x/y percentage below.
const MAP_LOCATIONS = [
  { id: "entrance", name: "Main Entrance", x: 8.0, y: 16.0, info: "Main gate and entry road onto campus." },
  { id: "venkatram", name: "Venkatram Learning Center", x: 42.3, y: 23.6, info: "Learning center building." },
  { id: "foodcourt", name: "Food Court", x: 46.8, y: 21.6, info: "Campus food court." },
  { id: "admin", name: "Admin Block", x: 44.0, y: 34.2, info: "Administrative offices." },
  { id: "stadium", name: "SKCET Stadium", x: 54.0, y: 43.4, info: "Running track and sports ground." },
  { id: "carparking", name: "Car Parking", x: 60.0, y: 38.8, info: "Car parking area." },
  { id: "hall", name: "SKCET Hall", x: 67.2, y: 16.3, info: "Main hall / auditorium building." },
  { id: "bikeparking", name: "Bike Parking", x: 30.3, y: 33.9, info: "Bike / two-wheeler parking area." },
];

// GPS -> image-pixel calibration, computed from 2 known reference points
// (Main Entrance and SKCET Stadium). This lets us turn a phone's live GPS
// reading into a position on the map image, the same way the pins above
// were placed.
const GPS_CALIBRATION = {
  scaleX: 75081.97, offsetX: -5777647.22,
  scaleY: -77699.37, offsetY: 850044.08,
  imgW: 880, imgH: 530,
};

function gpsToPercent(lat, lon) {
  const px = GPS_CALIBRATION.offsetX + GPS_CALIBRATION.scaleX * lon;
  const py = GPS_CALIBRATION.offsetY + GPS_CALIBRATION.scaleY * lat;
  return { x: (px / GPS_CALIBRATION.imgW) * 100, y: (py / GPS_CALIBRATION.imgH) * 100 };
}

let myLocationPercent = null; // { x, y } once located

function renderMapPins() {
  const pinsContainer = document.getElementById("map-pins");
  const toSelect = document.getElementById("map-to");
  if (!pinsContainer || pinsContainer.dataset.rendered) return;

  MAP_LOCATIONS.forEach((loc) => {
    const pin = document.createElement("button");
    pin.className = "map-pin";
    pin.style.left = loc.x + "%";
    pin.style.top = loc.y + "%";
    pin.title = loc.name;
    pin.textContent = "📍";
    pin.addEventListener("click", () => showMapInfo(loc));
    pinsContainer.appendChild(pin);

    const opt = document.createElement("option");
    opt.value = loc.id;
    opt.textContent = loc.name;
    toSelect.appendChild(opt);
  });

  pinsContainer.dataset.rendered = "true";
}

function showMapInfo(loc) {
  const box = document.getElementById("map-info-box");
  box.innerHTML = `<strong>${loc.name}</strong><p>${loc.info}</p>`;
  box.classList.remove("hidden");
}

function setStatus(text, isError) {
  const status = document.getElementById("map-locate-status");
  status.textContent = text;
  status.classList.remove("hidden");
  status.style.color = isError ? "#d64545" : "";
}

document.getElementById("map-locate-btn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("Your browser doesn't support location. Try a different browser.", true);
    return;
  }

  setStatus("Finding your location...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      myLocationPercent = gpsToPercent(latitude, longitude);

      const outOfBounds = myLocationPercent.x < -15 || myLocationPercent.x > 115 || myLocationPercent.y < -15 || myLocationPercent.y > 115;
      if (outOfBounds) {
        setStatus("You seem to be off-campus, or GPS accuracy is low right now. Try again once you're on campus.", true);
        myLocationPercent = null;
        return;
      }

      drawMyLocationDot();
      setStatus(`Location found (accuracy: ~${Math.round(accuracy)}m). Now pick where you want to go.`);
    },
    (err) => {
      setStatus("Couldn't get your location - make sure location access is allowed for this site in your browser settings.", true);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

function drawMyLocationDot() {
  const pinsContainer = document.getElementById("map-pins");
  let dot = document.getElementById("my-location-dot");
  if (!dot) {
    dot = document.createElement("div");
    dot.id = "my-location-dot";
    dot.className = "my-location-dot";
    pinsContainer.appendChild(dot);
  }
  dot.style.left = myLocationPercent.x + "%";
  dot.style.top = myLocationPercent.y + "%";
}

document.getElementById("map-show-path").addEventListener("click", () => {
  const toId = document.getElementById("map-to").value;
  const svg = document.getElementById("map-svg");
  svg.innerHTML = "";

  if (!myLocationPercent) {
    setStatus("Tap \"Where Am I?\" first so I know your starting point.", true);
    return;
  }
  if (!toId) {
    setStatus("Pick a destination from the dropdown.", true);
    return;
  }

  const to = MAP_LOCATIONS.find((l) => l.id === toId);

  svg.innerHTML = `
    <defs>
      <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
        <polygon points="0 0, 8 4, 0 8" fill="#f0793c" />
      </marker>
    </defs>
    <line x1="${myLocationPercent.x}%" y1="${myLocationPercent.y}%" x2="${to.x}%" y2="${to.y}%"
          stroke="#f0793c" stroke-width="3" stroke-dasharray="8,6"
          marker-end="url(#arrowhead)" />
  `;

  showMapInfo({ name: `You → ${to.name}`, info: "Approximate direct-line direction shown - follow campus roads/paths heading that way." });
});

document.getElementById("map-clear-path").addEventListener("click", () => {
  document.getElementById("map-svg").innerHTML = "";
  document.getElementById("map-info-box").classList.add("hidden");
  document.getElementById("map-locate-status").classList.add("hidden");
  document.getElementById("map-to").value = "";
});

renderMapPins();
async function loadEvents() {
  const res = await fetch("/api/events");
  const items = await res.json();
  const list = document.getElementById("events-list");
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = `<p>No events posted yet.</p>`;
    return;
  }

  items.forEach((e) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <strong>${escapeHtml(e.title)}</strong>
      <p>${escapeHtml(e.description)}</p>
      <div class="meta">${escapeHtml(e.event_date)}</div>
    `;
    list.appendChild(div);
  });
}