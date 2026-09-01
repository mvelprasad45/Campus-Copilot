(function () {
  // Navigation
  const navItems = document.querySelectorAll(".nav-item[data-target]");
  const sections = document.querySelectorAll(".panel-section");

  function switchTab(target) {
    navItems.forEach((btn) => btn.classList.toggle("active", btn.dataset.target === target));
    sections.forEach((sec) => sec.classList.toggle("active", sec.id === `tab-${target}`));
    
    // Load data based on tab
    if (target === "dashboard") loadDashboardStats();
    if (target === "users") loadUsers();
    if (target === "events") loadEvents();
    if (target === "complaints") loadComplaints();
    if (target === "lostfound") loadLostFoundAdmin();
    if (target === "announcements") loadAnnouncements();
    if (target === "profile") loadProfile();
  }

  navItems.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.target));
  });

  // Logout & Switch User
  document.querySelector(".nav-item-logout").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    location.href = "/admin/login";
  });
  
  document.getElementById("switch-user-btn").addEventListener("click", () => {
      location.href = "/student/login";
  });

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  // --- Profile Load ---
  async function loadProfile() {
    const res = await fetch("/api/admin/me");
    if (!res.ok) {
        location.href = "/admin/login";
        return;
    }
    const admin = await res.json();
    document.getElementById("profile-name").textContent = admin.name || "Admin";
    document.getElementById("profile-admin-id").textContent = admin.admin_id || "ADMIN";
    document.getElementById("profile-email").textContent = admin.email || "";
    document.getElementById("profile-role").textContent = admin.role || "";
    document.getElementById("profile-status").textContent = admin.status || "Active";
    document.getElementById("current-user-label").textContent = (admin.name || "Admin").split(" ")[0];
    document.getElementById("hello-heading").textContent = `Good Morning, ${admin.name || "Admin"} 👋`;
    
    if (admin.name) {
        document.getElementById("profile-avatar").textContent = admin.name.charAt(0).toUpperCase();
        document.querySelector(".header-actions .profile-avatar").textContent = admin.name.charAt(0).toUpperCase();
    }
  }

  // --- Dashboard Stats ---
  async function loadDashboardStats() {
    try {
      const res = await fetch("/api/admin/dashboard/stats");
      if (!res.ok) throw new Error();
      const stats = await res.json();
      document.getElementById("stat-students-count").textContent = stats.total_students;
      document.getElementById("stat-events-count").textContent = stats.active_events;
      document.getElementById("stat-complaints-count").textContent = stats.pending_complaints;
      document.getElementById("stat-lostfound-count").textContent = stats.active_lost_found;
      document.getElementById("stat-announcements-count").textContent = stats.total_announcements;
    } catch {
      document.getElementById("stat-students-count").textContent = "Error";
      document.getElementById("stat-events-count").textContent = "Error";
      document.getElementById("stat-complaints-count").textContent = "Error";
      document.getElementById("stat-lostfound-count").textContent = "Error";
      document.getElementById("stat-announcements-count").textContent = "Error";
    }
  }

  // --- Users Management ---
  async function loadUsers() {
    const list = document.getElementById("admin-users-list");
    list.innerHTML = "<tr><td colspan='6'>Loading...</td></tr>";
    
    const res = await fetch("/api/admin/users");
    if (!res.ok) { list.innerHTML = "<tr><td colspan='6'>Error loading users</td></tr>"; return; }
    const users = await res.json();
    
    if (users.length === 0) { list.innerHTML = "<tr><td colspan='6'>No users found</td></tr>"; return; }
    
    list.innerHTML = "";
    users.forEach(u => {
      const tr = document.createElement("tr");
      const statusText = u.is_active ? "Active" : "Inactive";
      const actionText = u.is_active ? "Deactivate" : "Activate";
      tr.innerHTML = `
        <td>${u.id}</td>
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.roll_number)}</td>
        <td>${escapeHtml(u.college_email)}</td>
        <td>${statusText}</td>
        <td>
            <button class="ghost-button toggle-user-btn" data-id="${u.id}" data-active="${!u.is_active}">
                ${actionText}
            </button>
        </td>
      `;
      list.appendChild(tr);
    });

    document.querySelectorAll(".toggle-user-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const id = e.target.dataset.id;
            const is_active = e.target.dataset.active === "true";
            await fetch(`/api/admin/users/${id}/status`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ is_active })
            });
            loadUsers();
        });
    });
  }
  document.getElementById("refresh-users-btn").addEventListener("click", loadUsers);

  // --- Events Management ---
  const eventForm = document.getElementById("event-form");
  const openEventModal = document.getElementById("open-event-modal-btn");
  const cancelEventBtn = document.getElementById("cancel-event-btn");
  let editingEventId = null;

  openEventModal.addEventListener("click", () => {
    eventForm.classList.remove("hidden");
    eventForm.reset();
    editingEventId = null;
  });

  cancelEventBtn.addEventListener("click", () => {
    eventForm.classList.add("hidden");
  });

  eventForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
        title: document.getElementById("event-title").value,
        event_date: document.getElementById("event-date").value,
        description: document.getElementById("event-description").value,
        venue: document.getElementById("event-venue").value,
    };
    
    let url = "/api/admin/events";
    let method = "POST";
    if (editingEventId) {
        url = `/api/admin/events/${editingEventId}`;
        method = "PUT";
    }

    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    
    if (res.ok) {
        eventForm.classList.add("hidden");
        eventForm.reset();
        loadEvents();
    }
  });

  async function loadEvents() {
    const list = document.getElementById("admin-events-list");
    list.innerHTML = "<p>Loading events...</p>";
    
    const res = await fetch("/api/admin/events");
    if (!res.ok) { list.innerHTML = "<p>Error loading events</p>"; return; }
    const items = await res.json();
    
    if (items.length === 0) { list.innerHTML = "<p>No events found.</p>"; return; }
    
    list.innerHTML = "";
    items.forEach(ev => {
      const div = document.createElement("div");
      div.className = "card-soft";
      div.style.marginBottom = "16px";
      div.style.padding = "16px";
      
      div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
                <strong>${escapeHtml(ev.title)}</strong>
                <p style="margin: 4px 0; color: var(--muted); font-size: 0.9rem;">${escapeHtml(ev.description || "No description")}</p>
                <div class="meta">${ev.event_date ? new Date(ev.event_date).toLocaleDateString() : ""} • ${escapeHtml(ev.venue || "No venue")}</div>
            </div>
            <div>
                <span class="badge ${ev.status === 'published' ? 'success' : ''}">${ev.status}</span>
                <button class="ghost-button edit-event-btn" data-id="${ev.id}" data-title="${escapeHtml(ev.title)}" data-desc="${escapeHtml(ev.description)}" data-date="${ev.event_date ? ev.event_date.split('T')[0] : ''}" data-venue="${escapeHtml(ev.venue)}">Edit</button>
                <button class="ghost-button del-event-btn" data-id="${ev.id}" style="color: var(--danger)">Delete</button>
            </div>
        </div>
      `;
      list.appendChild(div);
    });

    document.querySelectorAll(".edit-event-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            editingEventId = e.target.dataset.id;
            document.getElementById("event-title").value = e.target.dataset.title;
            document.getElementById("event-description").value = e.target.dataset.desc;
            document.getElementById("event-date").value = e.target.dataset.date;
            document.getElementById("event-venue").value = e.target.dataset.venue;
            eventForm.classList.remove("hidden");
            document.getElementById("tab-events").scrollIntoView();
        });
    });

    document.querySelectorAll(".del-event-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            if(confirm("Delete this event?")) {
                await fetch(`/api/admin/events/${e.target.dataset.id}`, { method: "DELETE" });
                loadEvents();
            }
        });
    });
  }

  // --- Complaints Management ---
  const STATUSES = ["Open", "In Progress", "Resolved"];
  async function loadComplaints() {
    const list = document.getElementById("admin-complaints-list");
    list.innerHTML = "<p>Loading...</p>";
    
    const res = await fetch("/api/admin/complaints");
    if (!res.ok) { list.innerHTML = "<p>Error</p>"; return; }
    const items = await res.json();
    
    if (items.length === 0) { list.innerHTML = "<p>No complaints submitted yet.</p>"; return; }
    
    list.innerHTML = "";
    items.forEach((c) => {
      const div = document.createElement("div");
      div.className = "card-soft";
      div.style.marginBottom = "16px";
      div.style.padding = "16px";
  
      const options = STATUSES.map(
        (s) => `<option value="${s}" ${s === c.status ? "selected" : ""}>${s}</option>`
      ).join("");
  
      div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
                <span class="badge ${c.priority ? c.priority.toLowerCase() : ''}">${c.priority}</span>
                <strong style="margin-left: 8px;">${escapeHtml(c.category)}</strong>
                <p style="margin: 8px 0; color: var(--body-text);">${escapeHtml(c.description)}</p>
                <div class="meta">${escapeHtml(c.student_name)} (${escapeHtml(c.roll_number)}) · ${new Date(c.created_at).toLocaleString()}</div>
            </div>
            <div>
                <select class="status-select" data-id="${c.id}">${options}</select>
            </div>
        </div>
      `;
      list.appendChild(div);
    });
  
    document.querySelectorAll(".status-select").forEach((select) => {
      select.addEventListener("change", async (e) => {
        const id = e.target.dataset.id;
        const status = e.target.value;
        await fetch(`/api/admin/complaints/${id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
      });
    });
  }
  document.getElementById("refresh-complaints-btn").addEventListener("click", loadComplaints);

  // --- Lost & Found Management ---
  const LF_STATUSES = ["Active", "Claimed", "Returned"];
  async function loadLostFoundAdmin() {
    const list = document.getElementById("admin-lostfound-list");
    list.innerHTML = "<p>Loading...</p>";
    
    const res = await fetch("/api/admin/lost-found");
    if (!res.ok) { list.innerHTML = "<p>Error</p>"; return; }
    const items = await res.json();
    
    if (items.length === 0) { list.innerHTML = "<p>No items reported yet.</p>"; return; }
    
    list.innerHTML = "";
    items.forEach((i) => {
      const div = document.createElement("div");
      div.className = "card-soft";
      div.style.marginBottom = "16px";
      div.style.padding = "16px";
  
      const options = LF_STATUSES.map(
        (s) => `<option value="${s}" ${s === (i.status || "Active") ? "selected" : ""}>${s}</option>`
      ).join("");
  
      div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
                <span class="badge">${i.item_type}</span>
                <strong style="margin-left: 8px;">${escapeHtml(i.item_name)}</strong>
                <p style="margin: 8px 0; color: var(--body-text);">${escapeHtml(i.description || "")}</p>
                <div class="meta">${escapeHtml(i.student_name)} (${escapeHtml(i.roll_number)}) · ${escapeHtml(i.location || "no location")} · ${new Date(i.created_at).toLocaleString()}</div>
            </div>
            <div>
                <select class="lf-status-select" data-id="${i.id}">${options}</select>
            </div>
        </div>
      `;
      list.appendChild(div);
    });
  
    document.querySelectorAll(".lf-status-select").forEach((select) => {
      select.addEventListener("change", async (e) => {
        const id = e.target.dataset.id;
        const status = e.target.value;
        await fetch(`/api/admin/lost-found/${id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
      });
    });
  }
  document.getElementById("refresh-lf-btn").addEventListener("click", loadLostFoundAdmin);

  // --- Announcements Management ---
  const announcementForm = document.getElementById("announcement-form");
  const openAnnouncementModal = document.getElementById("open-announcement-modal-btn");
  const cancelAnnouncementBtn = document.getElementById("cancel-announcement-btn");
  let editingAnnouncementId = null;

  openAnnouncementModal.addEventListener("click", () => {
    announcementForm.classList.remove("hidden");
    announcementForm.reset();
    editingAnnouncementId = null;
  });

  cancelAnnouncementBtn.addEventListener("click", () => {
    announcementForm.classList.add("hidden");
  });

  announcementForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
        title: document.getElementById("announcement-title").value,
        content: document.getElementById("announcement-content").value,
    };
    
    let url = "/api/admin/announcements";
    let method = "POST";
    if (editingAnnouncementId) {
        url = `/api/admin/announcements/${editingAnnouncementId}`;
        method = "PUT";
    }

    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    
    if (res.ok) {
        announcementForm.classList.add("hidden");
        announcementForm.reset();
        loadAnnouncements();
    }
  });

  async function loadAnnouncements() {
    const list = document.getElementById("admin-announcements-list");
    list.innerHTML = "<p>Loading...</p>";
    
    const res = await fetch("/api/admin/announcements");
    if (!res.ok) { list.innerHTML = "<p>Error</p>"; return; }
    const items = await res.json();
    
    if (items.length === 0) { list.innerHTML = "<p>No announcements found.</p>"; return; }
    
    list.innerHTML = "";
    items.forEach(ann => {
      const div = document.createElement("div");
      div.className = "card-soft";
      div.style.marginBottom = "16px";
      div.style.padding = "16px";
      
      div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
                <strong>${escapeHtml(ann.title)}</strong>
                <p style="margin: 4px 0; color: var(--muted); font-size: 0.9rem;">${escapeHtml(ann.content)}</p>
                <div class="meta">${new Date(ann.created_at).toLocaleString()}</div>
            </div>
            <div>
                <span class="badge ${ann.status === 'published' ? 'success' : ''}">${ann.status}</span>
                <button class="ghost-button edit-ann-btn" data-id="${ann.id}" data-title="${escapeHtml(ann.title)}" data-content="${escapeHtml(ann.content)}">Edit</button>
                <button class="ghost-button del-ann-btn" data-id="${ann.id}" style="color: var(--danger)">Delete</button>
            </div>
        </div>
      `;
      list.appendChild(div);
    });

    document.querySelectorAll(".edit-ann-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            editingAnnouncementId = e.target.dataset.id;
            document.getElementById("announcement-title").value = e.target.dataset.title;
            document.getElementById("announcement-content").value = e.target.dataset.content;
            announcementForm.classList.remove("hidden");
            document.getElementById("tab-announcements").scrollIntoView();
        });
    });

    document.querySelectorAll(".del-ann-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            if(confirm("Delete this announcement?")) {
                await fetch(`/api/admin/announcements/${e.target.dataset.id}`, { method: "DELETE" });
                loadAnnouncements();
            }
        });
    });
  }

  // Initial load
  loadProfile();
  loadDashboardStats();

})();
