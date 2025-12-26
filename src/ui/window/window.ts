/**
 * Veracross Plus — Popup Window Settings
 *
 * UI for toggling extension features on/off.
 * Uses the Phase 1 storage abstraction layer.
 */

import { getStorageProvider } from "../../storage";
import { getFeatureFlags, initializeFeatureFlags } from "../../features";
import type { ToggleablePreference } from "../../models/UserPreferences";

// Feature toggles displayed in the popup
const TOGGLEABLE_FEATURES: ToggleablePreference[] = [
  "enableChecklist",
  "enableCustomAssignments",
];

const WINDOW_DEFAULTS: Record<ToggleablePreference, boolean> = {
  enableChecklist: false,
  enableCustomAssignments: false,
  enableEstimator: false,
  enableHomeRedirect: false,
};

/**
 * Load current settings from storage and update UI
 */
async function load(): Promise<void> {
  const storage = getStorageProvider();
  const stored = await storage.getMany<Record<string, boolean>>(TOGGLEABLE_FEATURES);
  const vals = { ...WINDOW_DEFAULTS, ...stored };

  Object.entries(vals).forEach(([k, v]) => {
    const el = document.getElementById(k) as HTMLInputElement | null;
    if (!el) return;
    if (el.type === "checkbox") {
      el.checked = !!v;
    } else {
      el.value = String(v) || "";
    }
  });
}

/**
 * Save current UI state to storage
 */
async function save(): Promise<void> {
  const out: Record<string, boolean | string> = {};

  TOGGLEABLE_FEATURES.forEach((k) => {
    const el = document.getElementById(k) as HTMLInputElement | null;
    if (el) {
      out[k] = el.type === "checkbox" ? el.checked : el.value.trim();
    }
  });

  const storage = getStorageProvider();
  await storage.setMany(out);
}

/**
 * Initialize the popup window
 */
async function initializeWindow(): Promise<void> {
  // Initialize feature flags
  await initializeFeatureFlags();

  // Load settings
  await load();

  // Set up event listeners for toggles
  const checklistToggle = document.getElementById("enableChecklist");
  if (checklistToggle) {
    checklistToggle.addEventListener("change", save);
    checklistToggle.addEventListener("input", save);
  }

  const customAssignmentsToggle = document.getElementById("enableCustomAssignments");
  if (customAssignmentsToggle) {
    customAssignmentsToggle.addEventListener("change", save);
    customAssignmentsToggle.addEventListener("input", save);
  }

  // Click outside to close functionality
  const clickOutsideOverlay = document.getElementById("clickOutsideOverlay");
  const container = document.querySelector(".container");

  // Method 1: Click on overlay
  if (clickOutsideOverlay) {
    clickOutsideOverlay.addEventListener("click", (e) => {
      if (e.target === clickOutsideOverlay) {
        window.close();
      }
    });
  }

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
    chrome.windows.onFocusChanged.addListener((windowId: number) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        // No window focused, close our popup
        setTimeout(() => window.close(), 100);
      }
    });
  }

  // Prevent clicks inside the container from closing the window
  if (container) {
    container.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  initializeWindow().catch((error) => {
    console.error("[Veracross Plus] Window initialization error:", error);
  });
});
