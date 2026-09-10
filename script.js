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
    if (helloHeading) helloHeading.textContent = `Good Morning, ${firstName}`;
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
    
    // Ensure forms are cleared before showing login screen
    resetAuthForms();
  }
  
  function resetAuthForms() {
    // Reset all form elements to ensure no previous user's data is visible
    ["login-form", "admin-inline-login-form", "register-form"].forEach((id) => {
      const form = document.getElementById(id);
      if (form) {
        form.reset();
        // Explicitly clear all input values to handle cases where reset() alone isn't sufficient
        form.querySelectorAll("input, textarea").forEach((input) => {
          input.value = "";
        });
      }
    });
    // Clear all error messages
    document.querySelectorAll("#login-screen .error-text, #login-screen .field-error").forEach(hideError);
  }

  function attachAuthHandlers() {
    document.querySelectorAll(".password-toggle").forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const input = document.getElementById(toggle.dataset.target);
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        toggle.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
        toggle.textContent = isPassword ? "Hide" : "Show";
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

    document.getElementById("global-search-btn")?.addEventListener("click", toggleGlobalSearch);
    document.getElementById("global-notifications-btn")?.addEventListener("click", toggleNotificationsPanel);
    document.getElementById("global-search-input")?.addEventListener("input", handleGlobalSearch);
    document.getElementById("global-search-input")?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const panel = document.getElementById("global-search-panel");
        if (panel) panel.classList.add("hidden");
      }
    });

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
      resetAuthForms();
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

  function toggleGlobalSearch() {
    const panel = document.getElementById("global-search-panel");
    const input = document.getElementById("global-search-input");
    if (!panel || !input) return;

    if (panel.classList.contains("hidden")) {
      panel.classList.remove("hidden");
      input.focus();
      input.value = input.value || "";
    } else {
      panel.classList.add("hidden");
      input.blur();
    }
  }

  function handleGlobalSearch() {
    const input = document.getElementById("global-search-input");
    const query = (input?.value || "").trim().toLowerCase();

    document.querySelectorAll(".panel-section").forEach((section) => {
      const text = (section.textContent || "").toLowerCase();
      const matches = !query || text.includes(query);
      section.style.display = matches ? "" : "none";
    });

    document.querySelectorAll(".nav-item").forEach((button) => {
      if (!button.dataset.target) return;
      const target = button.dataset.target;
      const label = (button.textContent || "").toLowerCase();
      const matches = !query || label.includes(query) || target === "dashboard";
      button.style.display = matches ? "" : "none";
    });

    const visibleSections = [...document.querySelectorAll(".panel-section")].filter((section) => section.style.display !== "none");
    if (visibleSections.length) {
      const firstVisible = visibleSections[0];
      if (firstVisible?.id) {
        const target = firstVisible.id.replace(/^tab-/, "");
        openPanel(target);
      }
    }
  }

  function toggleNotificationsPanel() {
    const target = document.getElementById("tab-notifications");
    if (target) {
      openPanel("notifications");
      const searchPanel = document.getElementById("global-search-panel");
      if (searchPanel) searchPanel.classList.add("hidden");
    }
  }

  function attachNavigationHandlers() {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => {
              if (button.dataset.action === "logout") {
          fetch("/api/logout", { method: "POST" }).finally(() => {
            // Clear authentication state and forms
            resetAuthForms();
            // Preserve theme preference on logout
            const savedTheme = localStorage.getItem("campuscopilot_theme");
            // Clear session state
            sessionStorage.clear();
            // Reload to return to login page with preserved theme
            window.location.reload();
          });
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

    list.innerHTML = items.map((item) => {
      const photoFilename = item.photo_filename ? item.photo_filename.trim() : "";
      const photoUrl = photoFilename ? `/complaint/photo/${item.id}` : "";
      const photoMarkup = photoUrl
        ? `<a class="complaint-photo-link" href="${photoUrl}" target="_blank" rel="noopener noreferrer"><img class="complaint-thumb" src="${photoUrl}" alt="Complaint photo"></a>`
        : "";

      return `
        <div class="list-item">
          <div class="list-item-head">
            <strong>${escapeHtml(item.category || "Complaint")}</strong>
            <span class="badge ${String(item.priority || "Medium").toLowerCase()}">${escapeHtml(item.priority || "Medium")}</span>
          </div>
          <p>${escapeHtml(item.description || "No description provided.")}</p>
          ${photoMarkup}
          <div class="list-meta"><span>${escapeHtml(item.status || "Open")}</span><span>•</span><span>${escapeHtml(item.created_at || "Recently")}</span></div>
        </div>
      `;
    }).join("");
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
    const complaintForm = document.getElementById("complaint-upload-form");
    const complaintButton = document.getElementById("submit-complaint-btn");
    const photoInput = document.getElementById("complaint-photo");
    const photoPreview = document.getElementById("complaint-photo-preview");
    const photoError = document.getElementById("complaint-photo-error");

    function updateComplaintPhotoPreview() {
      const file = photoInput?.files?.[0];
      if (!file) {
        if (photoPreview) {
          photoPreview.src = "";
          photoPreview.classList.add("hidden");
        }
        if (photoError) photoError.classList.add("hidden");
        return;
      }

      if (!file.type.startsWith("image/")) {
        if (photoError) {
          photoError.textContent = "Please choose a valid image file.";
          photoError.classList.remove("hidden");
        }
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (photoPreview) {
          photoPreview.src = reader.result;
          photoPreview.classList.remove("hidden");
        }
        if (photoError) photoError.classList.add("hidden");
      };
      reader.readAsDataURL(file);
    }

    photoInput?.addEventListener("change", updateComplaintPhotoPreview);

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

      if (complaintForm) {
        complaintForm.classList.toggle("hidden", data.next_action !== "submit_complaint");
      }
      if (complaintButton) {
        complaintButton.disabled = data.next_action !== "submit_complaint";
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

    complaintForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = state.lastQuery;
      if (!message) return;

      const formData = new FormData();
      formData.append("description", message);
      const selectedPhoto = photoInput?.files?.[0];
      if (selectedPhoto) {
        formData.append("photo", selectedPhoto);
      }

      try {
        const res = await fetch("/api/complaints", {
          method: "POST",
          body: formData,
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (photoError) {
            photoError.textContent = data.error || "Upload failed. Please try again.";
            photoError.classList.remove("hidden");
          }
          return;
        }

        const chatLog = document.getElementById("chat-log");
        if (chatLog) {
          const bubble = document.createElement("div");
          bubble.className = "chat-bubble bot";
          bubble.textContent = "✅ Complaint submitted and is now being tracked.";
          chatLog.appendChild(bubble);
        }
        if (suggestionBox) suggestionBox.classList.add("hidden");
        if (complaintForm) complaintForm.classList.add("hidden");
        if (photoInput) photoInput.value = "";
        if (photoPreview) {
          photoPreview.src = "";
          photoPreview.classList.add("hidden");
        }
        if (photoError) photoError.classList.add("hidden");
        state.lastQuery = "";
        refreshDashboardData();
      } catch (error) {
        console.error("Complaint upload failed:", error);
        if (photoError) {
          photoError.textContent = "Upload failed. Please try again.";
          photoError.classList.remove("hidden");
        }
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

  async function initializeMap() {
    const mapPins = document.getElementById("map-pins");
    const toSelect = document.getElementById("map-to");
    const manualLocationButton = document.getElementById("map-manual-location-btn");
    const manualLocationSelect = document.getElementById("map-manual-location");
    if (!mapPins || !toSelect) return;
    let gpsLocation = null;
    let manualLocation = null;

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

    try {
      const response = await fetch("/api/buildings");
      if (!response.ok) throw new Error("Failed to load building coordinates");
      const buildings = await response.json();
      const buildingsByName = new Map(buildings.map((building) => [building.name, building]));
      locations.forEach((location) => {
        const building = buildingsByName.get(location.name);
        if (building) {
          location.latitude = building.latitude;
          location.longitude = building.longitude;
        }
      });
    } catch (error) {
      console.error("Error loading building coordinates:", error);
    }

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
        if (loc.latitude !== undefined && loc.longitude !== undefined) {
          option.dataset.latitude = String(loc.latitude);
          option.dataset.longitude = String(loc.longitude);
          if (manualLocationSelect) {
            const manualOption = option.cloneNode(true);
            manualOption.textContent = loc.name;
            manualLocationSelect.appendChild(manualOption);
          }
        }
        toSelect.appendChild(option);
      });
      mapPins.dataset.rendered = "true";
    }

    const getMapPoint = (latitude, longitude) => ({
      x: 8 + ((longitude - 76.9555) / (76.9590 - 76.9555)) * 59,
      y: 44 - ((latitude - 11.0195) / (11.0225 - 11.0195)) * 28,
    });

    manualLocationButton?.addEventListener("click", () => {
      manualLocationSelect?.classList.toggle("hidden");
      manualLocationSelect?.focus();
    });

    manualLocationSelect?.addEventListener("change", () => {
      const selected = Array.from(manualLocationSelect.options).find((option) => option.value === manualLocationSelect.value);
      const latitude = Number(selected?.dataset.latitude);
      const longitude = Number(selected?.dataset.longitude);
      if (!selected || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const point = getMapPoint(latitude, longitude);
      manualLocation = { latitude, longitude, x: point.x, y: point.y, name: selected.textContent };
      let pin = document.getElementById("manual-location-pin");
      if (!pin) {
        pin = document.createElement("div");
        pin.id = "manual-location-pin";
        pin.className = "manual-location-pin";
        pin.textContent = "M";
        mapPins.appendChild(pin);
      }
      pin.style.left = `${point.x}%`;
      pin.style.top = `${point.y}%`;
      pin.title = `Manually set location: ${selected.textContent}`;
      pin.setAttribute("aria-label", `Manually set location: ${selected.textContent}`);

      const status = document.getElementById("map-locate-status");
      if (status) {
        status.textContent = `Manually set location at ${selected.textContent}. GPS location remains available.`;
        status.classList.remove("hidden");
        status.style.color = "";
      }
    });

    toSelect.addEventListener("change", () => {
      const selected = locations.find((location) => location.id === toSelect.value);
      const box = document.getElementById("map-info-box");
      if (!selected || !box) return;
      const gpsText = selected.latitude !== undefined && selected.longitude !== undefined
        ? `<p>GPS destination: ${selected.latitude.toFixed(4)}, ${selected.longitude.toFixed(4)}</p>`
        : "";
      box.innerHTML = `<strong>${selected.name}</strong><p>${selected.info}</p>${gpsText}`;
      box.classList.remove("hidden");
    });

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
        status.textContent = "Requesting location permission...";
        status.classList.remove("hidden");
      }

      // Request location with proper permission handling
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          const point = getMapPoint(latitude, longitude);
          gpsLocation = { latitude, longitude, x: point.x, y: point.y, name: "Your live GPS location" };

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
        (error) => {
          if (status) {
            status.classList.remove("hidden");
            status.style.color = "var(--danger)";
            
            if (error.code === error.PERMISSION_DENIED) {
              status.textContent = "Location permission is required for this feature. Please allow location access in your browser settings.";
            } else if (error.code === error.POSITION_UNAVAILABLE) {
              status.textContent = "Location information is unavailable. Please try again or allow location access.";
            } else if (error.code === error.TIMEOUT) {
              status.textContent = "Location request timed out. Please try again.";
            } else {
              status.textContent = "Couldn't get your location - make sure location access is allowed for this site in your browser settings.";
            }
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });

    document.getElementById("map-show-path")?.addEventListener("click", () => {
      const dot = document.getElementById("my-location-dot");
      const selected = toSelect.value;
      const svg = document.getElementById("map-svg");
      if (!svg) return;
      svg.innerHTML = "";

      const startLocation = manualLocation || gpsLocation;
      if (!dot && !manualLocation) {
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

      const startX = startLocation ? startLocation.x : parseFloat(dot?.style.left || "0");
      const startY = startLocation ? startLocation.y : parseFloat(dot?.style.top || "0");
      const endX = parseFloat(destination.dataset.x || "0");
      const endY = parseFloat(destination.dataset.y || "0");
      const latitude = Number(destination.dataset.latitude);
      const longitude = Number(destination.dataset.longitude);
      const distance = startLocation && Number.isFinite(latitude) && Number.isFinite(longitude)
        ? calculateDistanceKm(startLocation.latitude, startLocation.longitude, latitude, longitude)
        : null;

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
        const startLabel = startLocation === manualLocation ? "Manually set location" : "Your live GPS location";
        const gpsText = Number.isFinite(latitude) && Number.isFinite(longitude)
          ? `<p>GPS destination: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}</p>`
          : "";
        const distanceText = distance !== null ? `<p>Distance from ${startLabel}: ${distance.toFixed(2)} km</p>` : "";
        box.innerHTML = `<strong>You → ${destination.textContent}</strong>${gpsText}${distanceText}<p>Approximate direct-line direction shown - follow campus roads/paths heading that way.</p>`;
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
      const manualPin = document.getElementById("manual-location-pin");
      if (manualPin) manualPin.remove();
      if (manualLocationSelect) manualLocationSelect.value = "";
      gpsLocation = null;
      manualLocation = null;
    });
  }

  async function initializeLeafletMap() {
    const mapElement = document.getElementById("campus-map");
    const toSelect = document.getElementById("map-to");
    const manualLocationButton = document.getElementById("map-manual-location-btn");
    const manualLocationSelect = document.getElementById("map-manual-location");
    if (!mapElement || !toSelect || mapElement.dataset.initialized) return;
    if (!window.L) {
      mapElement.innerHTML = '<div class="map-load-error">The live map could not load. Check your internet connection and refresh the page.</div>';
      return;
    }

    mapElement.dataset.initialized = "true";
    const campusCenter = [10.9378, 76.9564];
    const map = L.map(mapElement, { zoomControl: true }).setView(campusCenter, 17);
    window.campusLeafletMap = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const mapContainer = document.getElementById("map-container");
    const resizeMap = () => map.invalidateSize({ pan: false });
    if (mapContainer && "ResizeObserver" in window) {
      new ResizeObserver(resizeMap).observe(mapContainer);
    }
    const fullMapButton = document.getElementById("open-full-map-btn");
    fullMapButton?.addEventListener("click", () => {
      const expanded = mapContainer?.classList.toggle("is-expanded") || false;
      document.body.classList.toggle("map-expanded", expanded);
      fullMapButton.textContent = expanded ? "Close Full Map" : "Open Full Map";
      fullMapButton.setAttribute("aria-expanded", String(expanded));
      window.setTimeout(resizeMap, 120);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !mapContainer?.classList.contains("is-expanded")) return;
      mapContainer.classList.remove("is-expanded");
      document.body.classList.remove("map-expanded");
      fullMapButton.textContent = "Open Full Map";
      fullMapButton.setAttribute("aria-expanded", "false");
      window.setTimeout(resizeMap, 120);
    });

    const locations = [
      { id: "entrance", name: "Main Entrance", latitude: 10.9371, longitude: 76.9538, info: "Main gate and entry road onto campus." },
      { id: "venkatram", name: "Venkatram Learning Center", latitude: 10.938605849328804, longitude: 76.95614845441831, info: "Learning center building." },
      { id: "foodcourt", name: "Food Court", latitude: 10.938855061181442, longitude: 76.95663446788484, info: "Campus food court." },
      { id: "admin", name: "Admin Block", latitude: 10.937877896310905, longitude: 76.95634224673121, info: "Administrative offices." },
      { id: "stadium", name: "SKCET Stadium", latitude: 10.93720512733253, longitude: 76.95751806013921, info: "Running track and sports ground." },
      { id: "carparking", name: "Car Parking", latitude: 10.9370, longitude: 76.9585, info: "Car parking area." },
      { id: "hall", name: "SKCET Hall", latitude: 10.938940413455155, longitude: 76.95906197789171, info: "Main hall / auditorium building." },
      { id: "bikeparking", name: "Bike Parking", latitude: 10.937065992407732, longitude: 76.95419069860179, info: "Bike / two-wheeler parking area." },
    ];

    try {
      const response = await fetch("/api/buildings");
      if (response.ok) {
        const buildingsByName = new Map((await response.json()).map((building) => [building.name, building]));
        locations.forEach((location) => {
          const building = buildingsByName.get(location.name);
          if (building) {
            location.latitude = Number(building.latitude);
            location.longitude = Number(building.longitude);
          }
        });
      }
    } catch (error) {
      console.warn("Using built-in SKCET map coordinates:", error);
    }
    const mapAnchor = locations.find((location) => location.id === "admin") || locations[0];
    map.setView([mapAnchor.latitude, mapAnchor.longitude], 17);

    const markers = new Map();
    locations.forEach((location) => {
      const marker = L.circleMarker([location.latitude, location.longitude], {
        radius: 8, color: "#ffffff", weight: 3, fillColor: "#159a8c", fillOpacity: 1,
      }).addTo(map);
      marker.bindPopup(`<strong>${location.name}</strong><br>${location.info}`);
      markers.set(location.id, marker);

      const option = document.createElement("option");
      option.value = location.id;
      option.textContent = location.name;
      option.dataset.latitude = String(location.latitude);
      option.dataset.longitude = String(location.longitude);
      toSelect.appendChild(option);
      const manualOption = option.cloneNode(true);
      manualOption.textContent = location.name;
      manualLocationSelect?.appendChild(manualOption);
    });

    let gpsLocation = null;
    let manualLocation = null;
    let routeLine = null;
    let currentLocationMarker = null;
    const status = document.getElementById("map-locate-status");
    const infoBox = document.getElementById("map-info-box");
    const showStatus = (message, isError = false) => {
      if (!status) return;
      status.textContent = message;
      status.classList.remove("hidden");
      status.style.color = isError ? "var(--danger)" : "";
    };

    manualLocationButton?.addEventListener("click", () => {
      manualLocationSelect?.classList.toggle("hidden");
      manualLocationSelect?.focus();
    });

    manualLocationSelect?.addEventListener("change", () => {
      const selected = manualLocationSelect.options[manualLocationSelect.selectedIndex];
      const latitude = Number(selected?.dataset.latitude);
      const longitude = Number(selected?.dataset.longitude);
      if (!selected?.value || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      manualLocation = { latitude, longitude, name: selected.textContent };
      currentLocationMarker?.remove();
      currentLocationMarker = L.circleMarker([latitude, longitude], {
        radius: 9, color: "#ffffff", weight: 3, fillColor: "#f59e0b", fillOpacity: 1,
      }).addTo(map).bindPopup(`<strong>Manual location</strong><br>${selected.textContent}`);
      map.flyTo([latitude, longitude], 18);
      showStatus(`Manually set location at ${selected.textContent}.`);
    });

    toSelect.addEventListener("change", () => {
      const location = locations.find((item) => item.id === toSelect.value);
      if (!location || !infoBox) return;
      infoBox.innerHTML = `<strong>${location.name}</strong><p>${location.info}</p><p>GPS destination: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}</p>`;
      infoBox.classList.remove("hidden");
      markers.get(location.id)?.openPopup();
    });

    document.getElementById("map-locate-btn")?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        showStatus("Your browser does not support GPS location.", true);
        return;
      }
      showStatus("Requesting GPS location permission...");
      navigator.geolocation.getCurrentPosition((position) => {
        const { latitude, longitude, accuracy } = position.coords;
        gpsLocation = { latitude, longitude, name: "Your live GPS location" };
        currentLocationMarker?.remove();
        currentLocationMarker = L.circleMarker([latitude, longitude], {
          radius: 9, color: "#ffffff", weight: 3, fillColor: "#2563eb", fillOpacity: 1,
        }).addTo(map).bindPopup("<strong>Your live GPS location</strong>");
        map.flyTo([latitude, longitude], 18);
        showStatus(`Location found (accuracy: ~${Math.round(accuracy)}m). Pick a destination.`);
      }, () => showStatus("Could not get your GPS location. Allow location access and try again.", true), {
        enableHighAccuracy: true, timeout: 10000, maximumAge: 0,
      });
    });

    document.getElementById("map-show-path")?.addEventListener("click", async () => {
      const start = manualLocation || gpsLocation;
      const destination = locations.find((location) => location.id === toSelect.value);
      if (!start) {
        showStatus('Tap "Where Am I?" first or set your location manually.', true);
        return;
      }
      if (!destination) {
        showStatus("Pick a destination from the dropdown.", true);
        return;
      }
      showStatus("Finding a route along campus roads...");
      routeLine?.remove();
      try {
        const routeUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${start.longitude},${start.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson&alternatives=true&steps=true`;
        const response = await fetch(routeUrl);
        const routeData = await response.json();
        if (!response.ok || routeData.code !== "Ok" || !routeData.routes?.length) {
          throw new Error("No road route found");
        }

        const route = routeData.routes
          .filter((candidate) => candidate.geometry && Number.isFinite(candidate.distance))
          .sort((first, second) => first.distance - second.distance)[0];
        if (!route) throw new Error("No usable road route found");
        routeLine = L.geoJSON(route.geometry, {
          style: { color: "#f59e0b", weight: 6, opacity: 0.95 },
        }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [48, 48] });
        showStatus(`Shortest walking route found to ${destination.name}.`);
        if (infoBox) {
          infoBox.innerHTML = `<strong>You → ${destination.name}</strong><p>GPS destination: ${destination.latitude.toFixed(5)}, ${destination.longitude.toFixed(5)}</p><p>Walking distance: ${(route.distance / 1000).toFixed(2)} km</p><p>Follow the highlighted campus walking path.</p>`;
          infoBox.classList.remove("hidden");
        }
      } catch (error) {
        console.error("Unable to load road route:", error);
        showStatus("A road route could not be loaded. Check your internet connection and try again.", true);
      }
    });

    document.getElementById("map-clear-path")?.addEventListener("click", () => {
      routeLine?.remove();
      currentLocationMarker?.remove();
      currentLocationMarker = null;
      gpsLocation = null;
      manualLocation = null;
      toSelect.value = "";
      if (manualLocationSelect) manualLocationSelect.value = "";
      infoBox?.classList.add("hidden");
      status?.classList.add("hidden");
      map.setView(campusCenter, 17);
    });

    const refreshMapSize = () => window.setTimeout(resizeMap, 80);
    document.querySelectorAll('[data-target="map"]').forEach((control) => {
      control.addEventListener("click", refreshMapSize);
    });
    window.setTimeout(refreshMapSize, 100);
  }

  function calculateDistanceKm(startLatitude, startLongitude, endLatitude, endLongitude) {
    const earthRadiusKm = 6371;
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = toRadians(endLatitude - startLatitude);
    const longitudeDelta = toRadians(endLongitude - startLongitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(toRadians(startLatitude)) * Math.cos(toRadians(endLatitude))
      * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function loadBuildingLocations() {
    const blockDropdown = document.getElementById("location-block-dropdown");
    const roomDropdown = document.getElementById("location-room-dropdown");
    if (!blockDropdown || !roomDropdown) return;

    try {
      const response = await fetch("/api/buildings-with-locations");
      if (!response.ok) throw new Error("Failed to load building locations");
      const buildings = await response.json();
      buildings.forEach((building) => {
        const option = document.createElement("option");
        option.value = building.building;
        option.textContent = building.building;
        blockDropdown.appendChild(option);
      });

      blockDropdown.addEventListener("change", () => {
        const building = buildings.find((item) => item.building === blockDropdown.value);
        roomDropdown.innerHTML = '<option value="">Select a room or lab...</option>';
        roomDropdown.disabled = !building;
        (building?.locations || []).forEach((location) => {
          const option = document.createElement("option");
          option.value = location;
          option.textContent = location;
          roomDropdown.appendChild(option);
        });
      });
    } catch (error) {
      console.error("Error loading building locations:", error);
      blockDropdown.innerHTML = '<option value="">Error loading blocks</option>';
      roomDropdown.innerHTML = '<option value="">Locations unavailable</option>';
    }
  }

  async function handleLocationSearch() {
    const dropdown = document.getElementById("location-room-dropdown");
    const resultDiv = document.getElementById("location-result");
    const errorDiv = document.getElementById("location-error");
    
    if (!dropdown) return;
    
    const selectedLocation = dropdown.value.trim();
    if (!selectedLocation) {
      showError(errorDiv, "Please select a location.");
      if (resultDiv) resultDiv.classList.add("hidden");
      return;
    }
    
    try {
      const response = await fetch(`/api/lookup?name=${encodeURIComponent(selectedLocation)}`);
      const data = await response.json();
      
      if (!response.ok) {
        showError(errorDiv, data.error || "Location not found.");
        if (resultDiv) resultDiv.classList.add("hidden");
        return;
      }
      
      hideError(errorDiv);
      
      const locationName = document.getElementById("result-location-name");
      const buildingName = document.getElementById("result-building-name");
      const floor = document.getElementById("result-floor");
      
      if (locationName) locationName.textContent = data.location;
      if (buildingName) buildingName.textContent = `is located inside ${data.building}`;
      if (floor) floor.textContent = `Floor: ${data.floor}`;
      
      if (resultDiv) resultDiv.classList.remove("hidden");
    } catch (error) {
      console.error("Error during location lookup:", error);
      showError(errorDiv, "An error occurred while searching for the location.");
      if (resultDiv) resultDiv.classList.add("hidden");
    }
  }

  function attachLocationLookupHandlers() {
    loadBuildingLocations();
    
    const searchBtn = document.getElementById("location-search-btn");
    if (searchBtn) {
      searchBtn.addEventListener("click", handleLocationSearch);
    }
    
    const dropdown = document.getElementById("location-room-dropdown");
    if (dropdown) {
      dropdown.addEventListener("change", handleLocationSearch);
    }
  }

  function initialize() {
    resetAuthForms();
    attachAuthHandlers();
    attachNavigationHandlers();
    attachAssistantHandlers();
    attachLostFoundHandlers();
    attachLocationLookupHandlers();
    initializeLeafletMap();
    openPanel("dashboard");
    refreshDashboardData();
    applyAiCounter();
    checkLoginStatus();
  }

  window.addEventListener("pageshow", (event) => {
    // Firefox/Safari can restore old form values from the back/forward cache;
    // clear them so a previous user's email/password never reappears.
    if (event.persisted) resetAuthForms();
  });

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
    if (normalized === "map" && window.campusLeafletMap) {
      window.setTimeout(() => window.campusLeafletMap.invalidateSize({ pan: false }), 120);
    }
  }

  initialize();
})();
