const adminLoginForm = document.getElementById("admin-login-form");
const adminLoginError = document.getElementById("admin-login-error");

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminLoginError.classList.add("hidden");

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
    adminLoginError.textContent = data.error || "Invalid credentials.";
    adminLoginError.classList.remove("hidden");
    return;
  }

  window.location.href = "/admin/dashboard";
});

document.querySelectorAll(".password-toggle").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = document.getElementById(toggle.dataset.target);
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    toggle.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
  });
});
