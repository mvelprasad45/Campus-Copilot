const adminLoginForm = document.getElementById("admin-login-form");
const adminLoginError = document.getElementById("admin-login-error");

// Ensure form is cleared on page load or return
function clearLoginForm() {
  if (adminLoginForm) {
    adminLoginForm.reset();
    // Explicitly clear all input values to ensure no data persists
    adminLoginForm.querySelectorAll("input, textarea").forEach((input) => {
      input.value = "";
      input.dataset.value = "";
    });
  }
  if (adminLoginError) {
    adminLoginError.classList.add("hidden");
    adminLoginError.textContent = "";
  }
}

adminLoginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (adminLoginError) adminLoginError.classList.add("hidden");

  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: document.getElementById("admin-login-email").value.trim(),
      password: document.getElementById("admin-login-password").value,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    if (adminLoginError) {
      adminLoginError.textContent = data.error || "Invalid credentials.";
      adminLoginError.classList.remove("hidden");
    }
    return;
  }

  // Clear form before redirecting
  clearLoginForm();
  window.location.href = "/admin/dashboard";
});

// Clear form when page loads or user returns from navigation
clearLoginForm();

// Firefox/Safari can restore old form values from back/forward cache
window.addEventListener("pageshow", (event) => {
  if (event.persisted) clearLoginForm();
});

document.querySelectorAll(".password-toggle").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = document.getElementById(toggle.dataset.target);
    if (!input) return;
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    toggle.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
  });
});
