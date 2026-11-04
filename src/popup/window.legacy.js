import browser from 'webextension-polyfill';

const WINDOW_DEFAULTS = {
  enableChecklist: false,
  enableCustomAssignments: false,
};

async function load() {
  const vals = await browser.storage.sync.get(WINDOW_DEFAULTS);
  Object.entries(vals).forEach(([k, v]) => {
    const el = document.getElementById(k);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v || "";
  });
}

async function save() {
  const out = {};
  ["enableChecklist", "enableCustomAssignments"].forEach((k) => {
    const el = document.getElementById(k);
    if (el) {
      out[k] = el.type === "checkbox" ? el.checked : el.value.trim();
    }
  });
  await browser.storage.sync.set(out);
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

  if (clickOutsideOverlay) {
    clickOutsideOverlay.addEventListener("click", (e) => {
      if (e.target === clickOutsideOverlay) {
        window.close();
      }
    });
  }

  let windowFocused = true;
  window.addEventListener("blur", () => {
    windowFocused = false;
    setTimeout(() => {
      if (!windowFocused) {
        window.close();
      }
    }, 150);
  });

  window.addEventListener("focus", () => {
    windowFocused = true;
  });

  if (browser.windows) {
    browser.windows.onFocusChanged.addListener((windowId) => {
      if (windowId === browser.windows.WINDOW_ID_NONE) {
        setTimeout(() => window.close(), 100);
      }
    });
  }

  if (container) {
    container.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }
});
