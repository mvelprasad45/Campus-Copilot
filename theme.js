(function () {
  const storageKey = "campuscopilot_theme";

  function isAuthPage() {
    // Check if we're on an authentication page (login/signup)
    // - Student login: check for #login-screen visible
    // - Admin login: check for .auth-page or no #app-shell
    const loginScreen = document.getElementById("login-screen");
    const appShell = document.getElementById("app-shell");
    const authPage = document.querySelector(".auth-page");
    
    // If login screen exists and is visible, we're on auth page
    if (loginScreen && !loginScreen.classList.contains("hidden")) return true;
    
    // Pages without #app-shell (Smart Canteen, staff, admin) still use saved theme.
    if (appShell && appShell.classList.contains("hidden") && loginScreen) return true;
    
    // If .auth-page exists and is visible, we're on auth page
    if (authPage && !authPage.classList.contains("hidden")) return true;
    
    return false;
  }

  function systemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function savedTheme() {
    try {
      const theme = localStorage.getItem(storageKey);
      if (theme === "light" || theme === "dark") return theme;
    } catch (error) {
      // Use the system preference when browser storage is unavailable.
    }
    return systemTheme();
  }

  function appliedTheme() {
    // Auth pages always use light theme, never saved theme from previous user
    if (isAuthPage()) return "light";
    return savedTheme();
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";

    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.checked = isDark;
      const label = isDark ? "Switch to Light Mode" : "Switch to Dark Mode";
      toggle.setAttribute("aria-label", label);
      toggle.parentElement?.setAttribute("title", label);
    }
  }

  function initializeThemeToggle() {
    applyTheme(appliedTheme());
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;

    toggle.addEventListener("change", () => {
      const theme = toggle.checked ? "dark" : "light";
      try {
        localStorage.setItem(storageKey, theme);
      } catch (error) {
        // The selected theme remains active for the current page when storage is unavailable.
      }
      applyTheme(theme);
    });
  }

  applyTheme(appliedTheme());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeThemeToggle);
  } else {
    initializeThemeToggle();
  }
})();
