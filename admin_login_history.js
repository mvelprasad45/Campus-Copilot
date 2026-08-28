const historyForm = document.getElementById("history-filters");
const historyList = document.getElementById("login-history-list");
const historyEmpty = document.getElementById("history-empty");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character]));
}

function formatLoginTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function loadLoginHistory() {
  const params = new URLSearchParams();
  const email = document.getElementById("history-email").value.trim();
  const userType = document.getElementById("history-user-type").value;
  const date = document.getElementById("history-date").value;
  if (email) params.set("email", email);
  if (userType) params.set("user_type", userType);
  if (date) params.set("date", date);

  const response = await fetch(`/api/admin/login-history?${params}`);
  if (response.status === 401) {
    window.location.href = "/admin/login";
    return;
  }
  const records = await response.json();
  historyList.innerHTML = records.map((record) => {
    return `<tr>
      <td>${escapeHtml(record.user_name || "Unknown")} <small>${escapeHtml(record.user_type)}</small></td>
      <td>${escapeHtml(record.user_email || "-")}</td>
      <td>${formatLoginTime(record.login_time)}</td>
      <td>${escapeHtml(record.ip_address || "-")}</td>
      <td>${escapeHtml(record.browser || "-")}</td>
      <td>${escapeHtml(record.operating_system || "-")}</td>
    </tr>`;
  }).join("");
  historyEmpty.classList.toggle("hidden", records.length > 0);
}

historyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadLoginHistory();
});

document.getElementById("clear-filters-btn").addEventListener("click", () => {
  historyForm.reset();
  loadLoginHistory();
});

document.getElementById("admin-logout-btn").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.href = "/admin/login";
});

loadLoginHistory();