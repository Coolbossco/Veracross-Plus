// Firefox compatibility: Create browser namespace polyfill
const browser = chrome || browser;

const WINDOW_DEFAULTS = {
  enableChecklist: false,
  enableCustomAssignments: false,
};

function load() {
  chrome.storage.sync.get(WINDOW_DEFAULTS, (vals) => {
    Object.entries(vals).forEach(([k, v]) => {
      const el = document.getElementById(k);
      if (!el) return;
      if (el.type === "checkbox") el.checked = !!v;
      else el.value = v || "";
    });
  });
}

function save() {
  const out = {};
  ["enableChecklist", "enableCustomAssignments"].forEach((k) => {
    const el = document.getElementById(k);
    if (el) {
      out[k] = el.type === "checkbox" ? el.checked : el.value.trim();
    }
  });
  chrome.storage.sync.set(out);
}

document.addEventListener("DOMContentLoaded", () => {
  load();

  const checklistToggle = document.getElementById("enableChecklist");
  if (checklistToggle) {
    checklistToggle.addEventListener("change", save);
    checklistToggle.addEventListener("input", save);
  }

  const customAssignmentsToggle = document.getElementById(
    "enableCustomAssignments",
  );
  if (customAssignmentsToggle) {
    customAssignmentsToggle.addEventListener("change", save);
    customAssignmentsToggle.addEventListener("input", save);
  }

  // Click outside to close functionality
  const clickOutsideOverlay = document.getElementById("clickOutsideOverlay");
  const container = document.querySelector(".container");

  // Method 1: Click on overlay
  clickOutsideOverlay.addEventListener("click", (e) => {
    if (e.target === clickOutsideOverlay) {
      window.close();
    }
  });

  // Method 2: Window blur/focus events (more reliable for popup windows)
  let windowFocused = true;
  window.addEventListener("blur", () => {
    windowFocused = false;
    // Close after a short delay to allow for re-focusing
    setTimeout(() => {
      if (!windowFocused) {
        window.close();
      }
    }, 150);
  });

  window.addEventListener("focus", () => {
    windowFocused = true;
  });

  // Method 3: Chrome API for window focus changes (backup)
  if (chrome.windows) {
    chrome.windows.onFocusChanged.addListener((windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        // No window focused, close our popup
        setTimeout(() => window.close(), 100);
      }
    });
  }

  // Method 4: Removed mouse leave detection - was too aggressive
  // The blur/focus and click detection methods are sufficient

  // Prevent clicks inside the container from closing the window
  container.addEventListener("click", (e) => {
    e.stopPropagation();
  });
});
