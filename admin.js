document.getElementById("admin-logout-btn").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  location.href = "/admin/login";
});

loadComplaints();
loadLostFoundAdmin();
loadEvents();

// ---------------------------------------------------------------------------
// Complaints list with status dropdown
// ---------------------------------------------------------------------------
const STATUSES = ["Open", "In Progress", "Resolved"];

async function loadComplaints() {
  const res = await fetch("/api/admin/complaints");
  if (!res.ok) return;
  const items = await res.json();

  const list = document.getElementById("admin-complaints-list");
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = `<p>No complaints submitted yet.</p>`;
    return;
  }

  items.forEach((c) => {
    const div = document.createElement("div");
    div.className = "list-item";

    const options = STATUSES.map(
      (s) => `<option value="${s}" ${s === c.status ? "selected" : ""}>${s}</option>`
    ).join("");

    div.innerHTML = `
      <span class="badge ${c.priority.toLowerCase()}">${c.priority}</span>
      <strong>${c.category}</strong>
      <p>${c.description}</p>
      <div class="meta">${c.student_name} (${c.roll_number}) · ${c.created_at}</div>
      <select class="status-select" data-id="${c.id}">${options}</select>
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

document.getElementById("refresh-btn").addEventListener("click", loadComplaints);

// ---------------------------------------------------------------------------
// Lost & Found list with status dropdown
// ---------------------------------------------------------------------------
const LOST_FOUND_STATUSES = ["Active", "Claimed", "Returned"];

async function loadLostFoundAdmin() {
  const res = await fetch("/api/admin/lost-found");
  if (!res.ok) return;
  const items = await res.json();

  const list = document.getElementById("admin-lostfound-list");
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = `<p>No items reported yet.</p>`;
    return;
  }

  items.forEach((i) => {
    const div = document.createElement("div");
    div.className = "list-item";

    const options = LOST_FOUND_STATUSES.map(
      (s) => `<option value="${s}" ${s === (i.status || "Active") ? "selected" : ""}>${s}</option>`
    ).join("");

    div.innerHTML = `
      <span class="badge">${i.item_type}</span>
      <strong>${i.item_name}</strong>
      <p>${i.description || ""}</p>
      <div class="meta">${i.student_name} (${i.roll_number}) · ${i.location || "no location"} · ${i.created_at}</div>
      <select class="lf-status-select" data-id="${i.id}">${options}</select>
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

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
document.getElementById("event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    title: document.getElementById("event-title").value,
    description: document.getElementById("event-description").value,
    event_date: document.getElementById("event-date").value,
  };
  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    e.target.reset();
    loadEvents();
  }
});

async function loadEvents() {
  const res = await fetch("/api/events");
  const items = await res.json();
  const list = document.getElementById("admin-events-list");
  list.innerHTML = "";

  items.forEach((ev) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <strong>${ev.title}</strong>
      <p>${ev.description || ""}</p>
      <div class="meta">${ev.event_date || ""}</div>
    `;
    list.appendChild(div);
  });
}
