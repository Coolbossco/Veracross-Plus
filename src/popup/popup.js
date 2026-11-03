import browser from "webextension-polyfill";
import {
  DEFAULT_THEME_ID,
  resolveThemeId,
  THEME_GROUP_LABELS,
  THEME_GROUP_ORDER,
  THEMES,
} from "../themes/registry.js";

const POPUP_DEFAULTS = {
  enableChecklist: false,
  enableAssessmentCheckboxes: false,
  enableCustomAssignments: false,
  enableHomepageWidget: false,
  homepageShowCompleted: false,
  enableAssessmentReminders: false,
  enableLunchHomepage: false,
  enableLunchTimeline: false,
  selectedTheme: DEFAULT_THEME_ID,
};

async function hasAnalyticsConsent() {
  try {
    const grantedPermissions = await browser.permissions.getAll();

    // Firefox 140+ exposes its built-in data collection choices here. Chrome
    // does not expose this property, so its existing analytics behavior stays
    // unchanged.
    if (Object.hasOwn(grantedPermissions, "data_collection")) {
      return grantedPermissions.data_collection.includes(
        "technicalAndInteraction",
      );
    }
  } catch {
    console.debug("Could not read analytics permission.");
  }

  return true;
}

async function trackUmamiEvent(eventName, eventData = {}) {
  try {
    if (!(await hasAnalyticsConsent())) return;

    await fetch("https://stats.codegraph.cc/api/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "event",
        payload: {
          website: "0597c8be-13ec-4ab5-8793-9559562dbbdb",
          hostname: "extension.codegraph.cc",
          url: "/extension-action",
          name: eventName,
          data: eventData,
        },
      }),
    });
  } catch {
    console.debug("Analytics blocked or failed.");
  }
}

function populateThemeSelect() {
  const select = document.getElementById("selectedTheme");
  if (!select || select.dataset.populated === "1") return;

  /** @type {Map<string, HTMLOptGroupElement>} */
  const groups = new Map();
  for (const groupId of THEME_GROUP_ORDER) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = THEME_GROUP_LABELS[groupId] || groupId;
    groups.set(groupId, optgroup);
    select.appendChild(optgroup);
  }

  for (const theme of THEMES) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.name;
    if (theme.description) option.title = theme.description;
    const groupId = theme.group || "dark";
    const optgroup = groups.get(groupId) || groups.get("dark");
    (optgroup || select).appendChild(option);
  }
  select.dataset.populated = "1";
}

async function load() {
  populateThemeSelect();
  const vals = await browser.storage.sync.get(POPUP_DEFAULTS);
  const resolved = resolveThemeId(vals.selectedTheme);
  if (resolved !== vals.selectedTheme) {
    vals.selectedTheme = resolved;
    try {
      await browser.storage.sync.set({ selectedTheme: resolved });
    } catch {
      // Quota or sync unavailable — UI still shows resolved theme.
    }
  }
  Object.entries(vals).forEach(([k, v]) => {
    const el = document.getElementById(k);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v || "";
  });
}

/**
 * Write only the changed key. Avoid rewriting every setting on each click —
 * that burns Chrome's storage.sync MAX_WRITE_OPERATIONS_PER_MINUTE quota.
 */
async function saveSetting(settingName) {
  const el = document.getElementById(settingName);
  if (!el) return;

  const value = el.type === "checkbox" ? el.checked : el.value.trim();
  try {
    await browser.storage.sync.set({ [settingName]: value });
  } catch (error) {
    console.debug("Could not save setting.", settingName, error);
  }
}

async function confirmReminderNotifications() {
  const status = document.getElementById("reminderStatus");
  const setStatus = (text) => {
    if (status) status.textContent = text;
  };

  if (typeof Notification === "undefined") {
    setStatus("This browser cannot show notifications.");
    return;
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    setStatus(
      "Notifications are blocked. In macOS System Settings → Notifications → Google Chrome, turn Allow Notifications on and set the alert style to Alerts.",
    );
    return;
  }

  try {
    const note = new Notification("Veracross Plus", {
      body: "Assessment reminders are on.",
      icon: browser.runtime.getURL("icons/128.png"),
      requireInteraction: true,
    });
    note.onclick = () => note.close();
    setStatus("A test notification was sent. If you don't see it, check Notification Center.");
  } catch (error) {
    setStatus("Could not show a notification. Check macOS notification settings for Google Chrome.");
    console.debug("Test notification failed.", error);
  }
}

async function saveAndTrack(settingName) {
  const el = document.getElementById(settingName);
  await saveSetting(settingName);

  if (settingName === "enableAssessmentReminders" && el?.checked) {
    await confirmReminderNotifications();
  }

  if (el?.type === "checkbox") {
    trackUmamiEvent("setting_toggled", {
      setting: settingName,
      enabled: el.checked,
    });
  } else if (settingName === "selectedTheme") {
    trackUmamiEvent("theme_changed", {
      theme: el?.value || DEFAULT_THEME_ID,
    });
  }
}

function bindToggle(id) {
  const el = document.getElementById(id);
  if (!el) return;
  // Checkboxes only need `change` — pairing `input` doubled sync writes.
  el.addEventListener("change", () => saveAndTrack(id));
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  trackUmamiEvent("popup_opened");

  [
    "enableChecklist",
    "enableAssessmentCheckboxes",
    "enableCustomAssignments",
    "enableHomepageWidget",
    "homepageShowCompleted",
    "enableAssessmentReminders",
    "enableLunchHomepage",
    "enableLunchTimeline",
  ].forEach(bindToggle);

  const themeSelect = document.getElementById("selectedTheme");
  if (themeSelect) {
    themeSelect.addEventListener("change", () =>
      saveAndTrack("selectedTheme"),
    );
  }
});
