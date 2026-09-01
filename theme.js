(function () {
  const storageKey = "campuscopilot_theme";

  function savedTheme() {
    try {
      const theme = localStorage.getItem(storageKey);
      if (theme === "light" || theme === "dark") return theme;
    } catch (error) {
      // Use the system preference when browser storage is unavailable.
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
    applyTheme(savedTheme());
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

  applyTheme(savedTheme());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeThemeToggle);
  } else {
    initializeThemeToggle();
  }
})();
