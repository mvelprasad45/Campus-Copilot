(function () {
  const state = {
    verificationEmail: "",
    lastQuery: "",
    verificationTimer: null,
  };

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function showError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function hideError(el) {
    if (!el) return;
    el.classList.add("hidden");
  }

  function updateAuthTabs(name) {
    const selectedView = name === "register" ? "register" : "login";
    document.querySelectorAll(".auth-tab").forEach((tab) => {
      const isActive = tab.dataset.authView === selectedView;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });
  }

  function updateAccessTabs(name) {
    document.querySelectorAll(".auth-access-option").forEach((tab) => {
      const isActive = tab.dataset.authAccess === name;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    document.querySelectorAll(".auth-access-panel").forEach((panel) => {
      const isActive = panel.dataset.authAccessPanel === name;
      panel.classList.toggle("hidden", !isActive);
      panel.classList.toggle("active", isActive);
    });
  }

  function switchAuthView(name) {
    const views = {
      login: document.getElementById("auth-login-view"),
      register: document.getElementById("auth-register-view"),
      verify: document.getElementById("auth-verify-view"),
      reset: document.getElementById("auth-reset-view"),
    };
    const active = views[name];
    if (!active) return;

    Object.values(views).forEach((view) => {
      if (view) view.classList.toggle("hidden", view !== active);
    });
    document.querySelectorAll(".auth-view .error-text").forEach(hideError);
    updateAuthTabs(name);
  }

  function startCountdown(seconds = 300) {
    clearInterval(state.verificationTimer);
    const countdown = document.getElementById("verify-countdown");
    if (!countdown) return;

    const tick = () => {
      const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
      const remaining = String(seconds % 60).padStart(2, "0");
      countdown.textContent = seconds > 0 ? `Code expires in ${minutes}:${remaining}` : "Code expired. Request a new one.";
      if (seconds > 0) seconds -= 1;
    };
    tick();
    state.verificationTimer = setInterval(tick, 1000);
  }

  function updateStrength(inputId, barId, labelId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const value = input.value;
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

    const bar = document.getElementById(barId);
    if (bar) {
      bar.style.width = `${score * 20}%`;
      bar.dataset.level = String(score);
    }
    const label = document.getElementById(labelId);
    if (label) label.textContent = labels[score];
  }

  async function sendCode(endpoint, email, errorTargetId) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ college_email: email }),
    });
    const data = await res.json();
    if (!res.ok) showError(document.getElementById(errorTargetId), data.error || "Could not send code.");
    return res.ok;
  }

  function updateStats({ complaints = 0, lostItems = 0, aiQueries = 0 } = {}) {
    const complaintsEl = document.getElementById("stat-complaints-count");
    const lostEl = document.getElementById("stat-lostfound-count");
    const notificationsEl = document.getElementById("stat-notifications-count");
    const aiEl = document.getElementById("stat-ai-queries-count");

    if (complaintsEl) complaintsEl.textContent = String(complaints);
    if (lostEl) lostEl.textContent = String(lostItems);
    if (notificationsEl) notificationsEl.textContent = String(Math.max(0, complaints + lostItems));
    if (aiEl) aiEl.textContent = String(aiQueries);
  }

  function applyAiCounter() {
    const value = Number(localStorage.getItem("campuscopilot_ai_queries") || "0");
    const complaints = Number(document.getElementById("stat-complaints-count")?.textContent || 0);
    const lostItems = Number(document.getElementById("stat-lostfound-count")?.textContent || 0);
    updateStats({ complaints, lostItems, aiQueries: value });
  }

  function showLoggedInUI(user) {
    const loginScreen = document.getElementById("login-screen");
    const appShell = document.getElementById("app-shell");
    const currentUserLabel = document.getElementById("current-user-label");
    const helloHeading = document.getElementById("hello-heading");
    const profileName = document.getElementById("profile-name");
    const profileRoll = document.getElementById("profile-roll");
    const profileEmail = document.getElementById("profile-email");
    const profileAvatar = document.getElementById("profile-avatar");

    if (loginScreen) loginScreen.classList.add("hidden");
    if (appShell) appShell.classList.remove("hidden");

    const displayName = user.name || "Student";
    const firstName = displayName.split(" ")[0] || "Student";
    if (currentUserLabel) currentUserLabel.textContent = `${displayName} (${user.roll_number || "Student"})`;
    if (helloHeading) helloHeading.textContent = `Good Morning, ${firstName} 👋`;
    if (profileName) profileName.textContent = displayName;
    if (profileRoll) profileRoll.textContent = user.roll_number || "Student";
    if (profileEmail) profileEmail.textContent = user.college_email || "—";
    if (profileAvatar) profileAvatar.textContent = firstName.charAt(0).toUpperCase();

    refreshDashboardData();
    applyAiCounter();
  }

  async function checkLoginStatus() {
    const loginScreen = document.getElementById("login-screen");
    const appShell = document.getElementById("app-shell");
    try {
      const res = await fetch("/api/me");
      if (res.ok) {
        const user = await res.json();
        showLoggedInUI(user);
        return;
      }
    } catch (error) {
      console.error("Could not check login status:", error);
    }

    if (loginScreen) loginScreen.classList.remove("hidden");
    if (appShell) appShell.classList.add("hidden");
  }

  function attachAuthHandlers() {
    document.querySelectorAll(".password-toggle").forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const input = document.getElementById(toggle.dataset.target);
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        toggle.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
      });
    });

    document.getElementById("register-password")?.addEventListener("input", () => updateStrength("register-password", "register-strength-bar", "register-strength-label"));
    document.getElementById("reset-password")?.addEventListener("input", () => updateStrength("reset-password", "reset-strength-bar", "reset-strength-label"));

    document.querySelectorAll(".auth-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const view = tab.dataset.authView;
        if (view === "login" || view === "register") switchAuthView(view);
      });
    });

    document.querySelectorAll(".auth-access-option").forEach((option) => {
      option.addEventListener("click", () => updateAccessTabs(option.dataset.authAccess));
    });

    document.getElementById("show-register-link")?.addEventListener("click", (e) => { e.preventDefault(); switchAuthView("register"); });
    document.getElementById("show-reset-link")?.addEventListener("click", (e) => { e.preventDefault(); switchAuthView("reset"); });
    document.getElementById("show-login-link")?.addEventListener("click", (e) => { e.preventDefault(); switchAuthView("login"); });
    document.getElementById("show-reset-login-link")?.addEventListener("click", (e) => { e.preventDefault(); switchAuthView("login"); });
    document.getElementById("show-verify-login-link")?.addEventListener("click", (e) => { e.preventDefault(); switchAuthView("login"); });
    document.getElementById("show-admin-access-link")?.addEventListener("click", (e) => { e.preventDefault(); updateAccessTabs("admin"); });
    document.getElementById("show-student-access-link")?.addEventListener("click", (e) => { e.preventDefault(); updateAccessTabs("student"); });

    document.getElementById("login-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("login-name")?.value.trim() || "";
      const password = document.getElementById("login-password")?.value || "";
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const data = await res.json();
      if (res.ok) showLoggedInUI(data); else showError(document.getElementById("login-error"), data.error || "Login failed.");
    });

    document.getElementById("admin-inline-login-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError(document.getElementById("admin-inline-login-error"));
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("admin-inline-email")?.value.trim() || "",
          password: document.getElementById("admin-inline-password")?.value || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(document.getElementById("admin-inline-login-error"), data.error || "Invalid credentials.");
        return;
      }
      window.location.href = "/admin/dashboard";
    });

    document.getElementById("register-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = document.getElementById("register-password")?.value || "";
      const confirm = document.getElementById("register-confirm-password")?.value || "";
      if (password !== confirm) return showError(document.getElementById("register-password-error"), "Passwords do not match.");

      const payload = {
        name: document.getElementById("register-name")?.value.trim() || "",
        roll_number: document.getElementById("register-roll")?.value.trim() || "",
        college_email: document.getElementById("register-email")?.value.trim() || "",
        password,
      };

      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) return showError(document.getElementById("register-error"), data.error || "Registration failed.");
      showLoggedInUI(data);
    });

    document.getElementById("verify-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = document.getElementById("verify-code")?.value.trim() || "";
      const res = await fetch("/api/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ college_email: state.verificationEmail, code }),
      });
      const data = await res.json();
      if (!res.ok) return showError(document.getElementById("verify-error"), data.error || "Verification failed.");
      const message = document.getElementById("verify-message");
      if (message) { message.textContent = data.message; message.classList.remove("hidden"); }
      switchAuthView("login");
    });

    document.getElementById("resend-verify-link")?.addEventListener("click", async (e) => {
      e.preventDefault();
      if (state.verificationEmail && await sendCode("/api/resend-verification", state.verificationEmail, "verify-error")) startCountdown();
    });

    document.getElementById("reset-request-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("reset-email")?.value.trim() || "";
      state.verificationEmail = email;
      if (await sendCode("/api/forgot-password", email, "reset-error")) {
        const resetForm = document.getElementById("reset-form");
        if (resetForm) resetForm.classList.remove("hidden");
        e.target.classList.add("hidden");
      }
    });

    document.getElementById("resend-reset-link")?.addEventListener("click", async (e) => {
      e.preventDefault();
      if (state.verificationEmail) await sendCode("/api/forgot-password", state.verificationEmail, "reset-error");
    });

    document.getElementById("reset-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = document.getElementById("reset-password")?.value || "";
      const confirm = document.getElementById("reset-confirm-password")?.value || "";
      if (password !== confirm) return showError(document.getElementById("reset-password-error"), "Passwords do not match.");

      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          college_email: state.verificationEmail,
          code: document.getElementById("reset-code")?.value.trim() || "",
          new_password: password,
        }),
      });
      const data = await res.json();
      if (!res.ok) return showError(document.getElementById("reset-error"), data.error || "Password reset failed.");

      const resetForm = document.getElementById("reset-form");
      const requestForm = document.getElementById("reset-request-form");
      if (resetForm) resetForm.reset();
      if (requestForm) requestForm.reset();
      if (requestForm) requestForm.classList.remove("hidden");
      if (resetForm) resetForm.classList.add("hidden");
      switchAuthView("login");
    });

    const switchUserBtn = document.getElementById("switch-user-btn");
    switchUserBtn?.addEventListener("click", async () => {
      await fetch("/api/logout", { method: "POST" });
      window.location.reload();
    });
  }

  function openPanel(targetId) {
    const normalized = targetId || "dashboard";
    document.querySelectorAll(".nav-item").forEach((button) => {
      const active = (button.dataset.target || button.dataset.tab) === normalized;
      button.classList.toggle("active", active);
    });
    document.querySelectorAll(".panel-section").forEach((section) => {
      const sectionTarget = section.id.replace(/^tab-/, "");
      section.classList.toggle("active", sectionTarget === normalized);
    });
  }

  function attachNavigationHandlers() {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.action === "logout") {
          fetch("/api/logout", { method: "POST" }).finally(() => window.location.reload());
          return;
        }

        const target = button.dataset.target || button.dataset.tab;
        if (!target) return;
        openPanel(target);
        if (target === "assistant") {
          const input = document.getElementById("assistant-input");
          if (input) input.focus();
        }
      });
    });

    document.querySelectorAll(".quick-action").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.target;
        if (target) openPanel(target);
      });
    });

    document.querySelectorAll("[data-example]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById("assistant-input");
        if (!input) return;
        input.value = button.dataset.example;
        openPanel("assistant");
        input.focus();
      });
    });
  }

  function renderComplaints(items) {
    const list = document.getElementById("complaints-list");
    if (!list) return;

    if (!items.length) {
      list.innerHTML = '<div class="list-item"><p>No complaints yet — ask the assistant something to get started.</p></div>';
      return;
    }

    list.innerHTML = items.map((item) => `
      <div class="list-item">
        <div class="list-item-head">
          <strong>${escapeHtml(item.category || "Complaint")}</strong>
          <span class="badge ${String(item.priority || "Medium").toLowerCase()}">${escapeHtml(item.priority || "Medium")}</span>
        </div>
        <p>${escapeHtml(item.description || "No description provided.")}</p>
        <div class="list-meta"><span>${escapeHtml(item.status || "Open")}</span><span>•</span><span>${escapeHtml(item.created_at || "Recently")}</span></div>
      </div>
    `).join("");
  }

  function renderLostFound(items) {
    const list = document.getElementById("lostfound-list");
    if (!list) return;

    if (!items.length) {
      list.innerHTML = '<div class="list-item"><p>No items reported yet.</p></div>';
      return;
    }

    list.innerHTML = items.map((item) => `
      <div class="list-item">
        <div class="list-item-head">
          <strong>${escapeHtml(item.item_name || "Unnamed item")}</strong>
          <span class="badge ${item.item_type === "Found" ? "status-found" : "status-lost"}">${escapeHtml(item.item_type || "Lost")}</span>
        </div>
        <p>${escapeHtml(item.location || "Location not shared.")}</p>
        <div class="list-meta"><span>${escapeHtml(item.status || "Active")}</span><span>•</span><span>${escapeHtml(item.created_at || "Recently")}</span></div>
      </div>
    `).join("");
  }

  function renderEvents(events) {
    const notificationList = document.getElementById("notification-list");
    const sidebarEvents = document.getElementById("sidebar-events");
    const sidebarNotifications = document.getElementById("sidebar-notifications");
    const eventEntries = Array.isArray(events) ? events : [];

    if (notificationList) {
      notificationList.innerHTML = eventEntries.length
        ? eventEntries.slice(0, 4).map((event) => `
          <div class="timeline-item">
            <div class="timeline-icon">📌</div>
            <div>
              <h4>${escapeHtml(event.title || "Campus update")}</h4>
              <p>${escapeHtml(event.description || "Campus update")}</p>
            </div>
            <span class="timeline-time">${escapeHtml(event.event_date || "Today")}</span>
          </div>
        `).join("")
        : '<div class="timeline-item"><div class="timeline-icon">✓</div><div><h4>Everything is up to date</h4><p>No recent campus changes.</p></div><span class="timeline-time">Today</span></div>';
    }

    if (sidebarEvents) {
      sidebarEvents.innerHTML = eventEntries.length
        ? eventEntries.slice(0, 3).map((event) => `
          <div class="announcement-item">
            <strong>${escapeHtml(event.title || "Campus update")}</strong>
            <p>${escapeHtml(event.description || "Campus update")}</p>
          </div>
        `).join("")
        : '<div class="announcement-item"><strong>No announcements</strong><p>Check back later for campus updates.</p></div>';
    }

    if (sidebarNotifications) {
      sidebarNotifications.innerHTML = eventEntries.length
        ? eventEntries.slice(0, 3).map((event) => `<li><span>${escapeHtml(event.title || "Campus update")}</span><strong>${escapeHtml(event.event_date || "Today")}</strong></li>`).join("")
        : '<li><span>Everything is up to date</span><strong>Today</strong></li>';
    }
  }

  async function refreshDashboardData() {
    try {
      const [complaintsRes, lostRes, eventsRes] = await Promise.all([
        fetch("/api/complaints"),
        fetch("/api/lost-found"),
        fetch("/api/events"),
      ]);

      const complaints = complaintsRes.ok ? await complaintsRes.json() : [];
      const lostItems = lostRes.ok ? await lostRes.json() : [];
      const events = eventsRes.ok ? await eventsRes.json() : [];

      renderComplaints(complaints);
      renderLostFound(lostItems);
      renderEvents(events);
      updateStats({
        complaints: complaints.length,
        lostItems: lostItems.length,
        aiQueries: Number(localStorage.getItem("campuscopilot_ai_queries") || "0"),
      });
    } catch (error) {
      console.error("Dashboard refresh failed:", error);
    }
  }

  function attachAssistantHandlers() {
    const form = document.getElementById("assistant-form");
    const suggestionBox = document.getElementById("suggestion-box");
    const complaintButton = document.getElementById("submit-complaint-btn");

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("assistant-input");
      const message = input?.value.trim() || "";
      if (!message) return;

      const chatLog = document.getElementById("chat-log");
      if (chatLog) {
        const bubble = document.createElement("div");
        bubble.className = "chat-bubble user";
        bubble.textContent = message;
        chatLog.appendChild(bubble);
      }

      input.value = "";
      state.lastQuery = message;

      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      });
      const data = await res.json();

      if (chatLog) {
        const bubble = document.createElement("div");
        bubble.className = "chat-bubble bot";
        bubble.textContent = `I identified this as a ${String(data.intent || "general").replace("_", " ")} request.`;
        chatLog.appendChild(bubble);
      }

      if (suggestionBox) {
        const intent = document.getElementById("sugg-intent");
        const category = document.getElementById("sugg-category");
        const priority = document.getElementById("sugg-priority");
        const department = document.getElementById("sugg-department");
        const action = document.getElementById("sugg-action");
        if (intent) intent.textContent = String(data.intent || "General").replace("_", " ");
        if (category) category.textContent = data.category || "General Enquiry";
        if (priority) priority.textContent = data.priority || "Medium";
        if (department) department.textContent = data.suggested_department || "Helpdesk";
        if (action) action.textContent = String(data.next_action || "submit complaint").replaceAll("_", " ");
        suggestionBox.classList.remove("hidden");
      }

      if (complaintButton) {
        complaintButton.classList.toggle("hidden", data.next_action !== "submit_complaint");
      }

      const aiCount = Number(localStorage.getItem("campuscopilot_ai_queries") || "0") + 1;
      localStorage.setItem("campuscopilot_ai_queries", String(aiCount));
      applyAiCounter();

      const nextActionMap = {
        open_lost_found: "lostfound",
        view_events: "notifications",
        open_map: "map",
      };
      const target = nextActionMap[data.next_action];
      if (target) openPanel(target);
    });

    complaintButton?.addEventListener("click", async () => {
      const message = state.lastQuery;
      if (!message) return;

      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: message }),
      });

      if (res.ok) {
        const chatLog = document.getElementById("chat-log");
        if (chatLog) {
          const bubble = document.createElement("div");
          bubble.className = "chat-bubble bot";
          bubble.textContent = "✅ Complaint submitted and is now being tracked.";
          chatLog.appendChild(bubble);
        }
        if (suggestionBox) suggestionBox.classList.add("hidden");
        state.lastQuery = "";
        refreshDashboardData();
      }
    });
  }

  function attachLostFoundHandlers() {
    const form = document.getElementById("lostfound-form");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        item_type: document.getElementById("lf-type")?.value || "Lost",
        item_name: document.getElementById("lf-name")?.value || "",
        location: document.getElementById("lf-location")?.value || "",
        contact: document.getElementById("lf-contact")?.value || "",
      };
      const res = await fetch("/api/lost-found", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        form.reset();
        refreshDashboardData();
      }
    });
  }

  function initializeMap() {
    const mapPins = document.getElementById("map-pins");
    const toSelect = document.getElementById("map-to");
    if (!mapPins || !toSelect) return;

    const locations = [
      { id: "entrance", name: "Main Entrance", x: 8, y: 16, info: "Main gate and entry road onto campus." },
      { id: "venkatram", name: "Venkatram Learning Center", x: 42.3, y: 23.6, info: "Learning center building." },
      { id: "foodcourt", name: "Food Court", x: 46.8, y: 21.6, info: "Campus food court." },
      { id: "admin", name: "Admin Block", x: 44, y: 34.2, info: "Administrative offices." },
      { id: "stadium", name: "SKCET Stadium", x: 54, y: 43.4, info: "Running track and sports ground." },
      { id: "carparking", name: "Car Parking", x: 60, y: 38.8, info: "Car parking area." },
      { id: "hall", name: "SKCET Hall", x: 67.2, y: 16.3, info: "Main hall / auditorium building." },
      { id: "bikeparking", name: "Bike Parking", x: 30.3, y: 33.9, info: "Bike / two-wheeler parking area." },
    ];

    if (!mapPins.dataset.rendered) {
      locations.forEach((loc) => {
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "map-pin";
        pin.style.left = `${loc.x}%`;
        pin.style.top = `${loc.y}%`;
        pin.title = loc.name;
        pin.textContent = "📍";
        pin.addEventListener("click", () => {
          const box = document.getElementById("map-info-box");
          if (!box) return;
          box.innerHTML = `<strong>${loc.name}</strong><p>${loc.info}</p>`;
          box.classList.remove("hidden");
        });
        mapPins.appendChild(pin);

        const option = document.createElement("option");
        option.value = loc.id;
        option.textContent = loc.name;
        option.dataset.x = String(loc.x);
        option.dataset.y = String(loc.y);
        toSelect.appendChild(option);
      });
      mapPins.dataset.rendered = "true";
    }

    document.getElementById("map-locate-btn")?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        const status = document.getElementById("map-locate-status");
        if (status) {
          status.textContent = "Your browser doesn't support location. Try a different browser.";
          status.classList.remove("hidden");
          status.style.color = "var(--danger)";
        }
        return;
      }

      const status = document.getElementById("map-locate-status");
      if (status) {
        status.textContent = "Finding your location...";
        status.classList.remove("hidden");
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          const gpsScale = {
            scaleX: 75081.97,
            offsetX: -5777647.22,
            scaleY: -77699.37,
            offsetY: 850044.08,
            imgW: 880,
            imgH: 530,
          };
          const px = gpsScale.offsetX + gpsScale.scaleX * longitude;
          const py = gpsScale.offsetY + gpsScale.scaleY * latitude;
          const point = { x: (px / gpsScale.imgW) * 100, y: (py / gpsScale.imgH) * 100 };

          let dot = document.getElementById("my-location-dot");
          if (!dot) {
            dot = document.createElement("div");
            dot.id = "my-location-dot";
            dot.className = "my-location-dot";
            mapPins.appendChild(dot);
          }
          dot.style.left = `${point.x}%`;
          dot.style.top = `${point.y}%`;

          if (status) {
            status.textContent = `Location found (accuracy: ~${Math.round(accuracy)}m). Now pick where you want to go.`;
            status.style.color = "";
          }
        },
        () => {
          if (status) {
            status.textContent = "Couldn't get your location - make sure location access is allowed for this site in your browser settings.";
            status.classList.remove("hidden");
            status.style.color = "var(--danger)";
          }
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

    document.getElementById("map-show-path")?.addEventListener("click", () => {
      const dot = document.getElementById("my-location-dot");
      const selected = toSelect.value;
      const svg = document.getElementById("map-svg");
      if (!svg) return;
      svg.innerHTML = "";

      if (!dot) {
        const status = document.getElementById("map-locate-status");
        if (status) {
          status.textContent = 'Tap "Where Am I?" first so I know your starting point.';
          status.classList.remove("hidden");
          status.style.color = "var(--danger)";
        }
        return;
      }
      if (!selected) {
        const status = document.getElementById("map-locate-status");
        if (status) {
          status.textContent = "Pick a destination from the dropdown.";
          status.classList.remove("hidden");
          status.style.color = "var(--danger)";
        }
        return;
      }

      const destination = Array.from(toSelect.options).find((option) => option.value === selected);
      if (!destination) return;

      const startX = parseFloat(dot.style.left || "0");
      const startY = parseFloat(dot.style.top || "0");
      const endX = parseFloat(destination.dataset.x || "0");
      const endY = parseFloat(destination.dataset.y || "0");

      svg.innerHTML = `
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <polygon points="0 0, 8 4, 0 8" fill="var(--warning)" />
          </marker>
        </defs>
        <line x1="${startX}%" y1="${startY}%" x2="${endX}%" y2="${endY}%" stroke="var(--warning)" stroke-width="3" stroke-dasharray="8,6" marker-end="url(#arrowhead)" />
      `;

      const box = document.getElementById("map-info-box");
      if (box) {
        box.innerHTML = `<strong>You → ${destination.textContent}</strong><p>Approximate direct-line direction shown - follow campus roads/paths heading that way.</p>`;
        box.classList.remove("hidden");
      }
    });

    document.getElementById("map-clear-path")?.addEventListener("click", () => {
      const svg = document.getElementById("map-svg");
      if (svg) svg.innerHTML = "";
      const infoBox = document.getElementById("map-info-box");
      if (infoBox) infoBox.classList.add("hidden");
      const status = document.getElementById("map-locate-status");
      if (status) status.classList.add("hidden");
      toSelect.value = "";
      const dot = document.getElementById("my-location-dot");
      if (dot) dot.remove();
    });
  }

  function initialize() {
    attachAuthHandlers();
    attachNavigationHandlers();
    attachAssistantHandlers();
    attachLostFoundHandlers();
    initializeMap();
    openPanel("dashboard");
    refreshDashboardData();
    applyAiCounter();
    checkLoginStatus();
  }

  function openPanel(targetId) {
    const normalized = targetId || "dashboard";
    document.querySelectorAll(".nav-item").forEach((button) => {
      const active = (button.dataset.target || button.dataset.tab) === normalized;
      button.classList.toggle("active", active);
    });
    document.querySelectorAll(".panel-section").forEach((section) => {
      const sectionTarget = section.id.replace(/^tab-/, "");
      section.classList.toggle("active", sectionTarget === normalized);
    });
  }

  initialize();
})();
