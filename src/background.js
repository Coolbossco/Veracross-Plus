import browser from "webextension-polyfill";

const ASSESSMENT_ALARM = "vch-assessment-reminders";
const ASSESSMENT_CACHE_KEY = "vch_assessment_cache";
const NOTIFIED_KEY = "vch_assessment_notified";
const CHECKED_KEY = "vc_checked_assignments";
const PORTAL_HOST_MATCH = "*://*.veracross.com/*";
const MS_DAY = 24 * 60 * 60 * 1000;

/** Popup HTML paths (relative to extension root / built like manifest action). */
const POPUP_LEGACY = "src/popup/popup.legacy.html";
const POPUP_MODERN = "src/popup/popup.html";

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "VCH_FETCH") {
    return fetchRemote(message);
  }
  if (message?.type === "VCH_CHECK_REMINDERS") {
    return checkAssessmentReminders({
      force: !!message.force,
      diagnose: true,
    });
  }
  if (message?.type === "VCH_ROLLOUT") {
    return syncActionPopup(message.enabled === true).then(() => ({ ok: true }));
  }
  return undefined;
});

browser.runtime.onInstalled.addListener((details) => {
  syncAssessmentAlarm();
  void syncActionPopup();
  if (details.reason === "update") {
    void markWhatsNewPending();
  }
});

async function markWhatsNewPending() {
  try {
    const version = browser.runtime.getManifest()?.version;
    if (!version) return;
    await browser.storage.local.set({
      vch_whats_new: {
        version,
        pending: true,
      },
    });
  } catch (error) {
    console.debug("Could not mark what's-new pending.", error);
  }
}

browser.runtime.onStartup.addListener(() => {
  syncAssessmentAlarm();
  void syncActionPopup();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.rolloutEnabled) {
    void syncActionPopup(changes.rolloutEnabled.newValue === true);
  }
  if (area !== "sync" || !changes.enableAssessmentReminders) return;
  syncAssessmentAlarm();
  if (changes.enableAssessmentReminders.newValue) {
    checkAssessmentReminders();
  }
});

/**
 * Swap toolbar popup between legacy (CWS) and modern (redesign) HTML.
 * Default / unknown → legacy so non-beta users never see the redesign chrome.
 * @param {boolean=} enabledOverride
 */
async function syncActionPopup(enabledOverride) {
  try {
    let enabled = enabledOverride;
    if (typeof enabled !== "boolean") {
      const stored = await browser.storage.local.get({ rolloutEnabled: false });
      enabled = stored.rolloutEnabled === true;
    }
    await browser.action.setPopup({
      popup: enabled ? POPUP_MODERN : POPUP_LEGACY,
    });
  } catch (error) {
    console.debug("Could not sync action popup for rollout.", error);
  }
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ASSESSMENT_ALARM) {
    checkAssessmentReminders();
  }
});

browser.notifications.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith("vch-assessment:")) return;
  try {
    await browser.notifications.clear(notificationId);
  } catch {
    // Ignore.
  }
  await focusOrOpenPortal();
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const tag = event.notification.tag || "";
  if (!tag.startsWith("vch-assessment:")) return;
  event.waitUntil(focusOrOpenPortal());
});

/**
 * @param {{
 *   url: string,
 *   headers?: Record<string, string>,
 *   as?: "json" | "text",
 *   credentials?: RequestCredentials
 * }} opts
 */
async function fetchRemote({
  url,
  headers = {},
  as = "json",
  credentials,
}) {
  try {
    let creds = credentials;
    if (!creds) {
      try {
        const host = new URL(url).hostname;
        creds = host.endsWith("sagedining.com") ? "omit" : "include";
      } catch {
        creds = "include";
      }
    }

    const response = await fetch(url, {
      credentials: creds,
      headers,
    });
    if (!response.ok) {
      return { ok: false, error: `Request failed: ${response.status}` };
    }
    if (as === "text") {
      return { ok: true, text: await response.text() };
    }
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, error: error?.message || "Request failed" };
  }
}

async function syncAssessmentAlarm() {
  try {
    const { enableAssessmentReminders = false } = await browser.storage.sync.get(
      { enableAssessmentReminders: false },
    );

    await browser.alarms.clear(ASSESSMENT_ALARM);

    if (!enableAssessmentReminders) return;

    await browser.alarms.create(ASSESSMENT_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: 60,
    });
  } catch (error) {
    console.debug("Could not sync assessment reminder alarm.", error);
  }
}

/**
 * @param {{ force?: boolean, diagnose?: boolean }=} options
 */
async function checkAssessmentReminders(options = {}) {
  const diagnose = !!options.diagnose;
  const summary = {
    enabled: false,
    forced: !!options.force,
    permission:
      typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    cacheCount: 0,
    notified: 0,
    skipped: /** @type {{ id: string, title: string, reason: string }[]} */ ([]),
    created: /** @type {string[]} */ ([]),
    errors: /** @type {string[]} */ ([]),
  };

  try {
    const sync = await browser.storage.sync.get({
      enableAssessmentReminders: false,
      [CHECKED_KEY]: {},
    });
    summary.enabled = !!sync.enableAssessmentReminders;
    if (!sync.enableAssessmentReminders && !options.force) {
      summary.errors.push(
        "enableAssessmentReminders is off — turn it on in the popup",
      );
      if (diagnose) console.info("VCH reminders:", summary);
      return summary;
    }

    const local = await browser.storage.local.get({
      [ASSESSMENT_CACHE_KEY]: null,
      [NOTIFIED_KEY]: {},
    });

    const cache = local[ASSESSMENT_CACHE_KEY];
    const items = Array.isArray(cache?.items) ? cache.items : [];
    summary.cacheCount = items.length;
    if (!items.length) {
      summary.errors.push("assessment cache is empty — open student home first");
      if (diagnose) console.info("VCH reminders:", summary);
      return summary;
    }

    const checked = sync[CHECKED_KEY] || {};
    const notified = { ...(local[NOTIFIED_KEY] || {}) };
    const now = Date.now();
    let changed = false;

    for (const item of items) {
      const id = String(item.id || item.storageKey || "");
      const title = item.title || id;
      if (!id) continue;
      if (isAssignmentChecked(checked, item.storageKey)) {
        if (diagnose) summary.skipped.push({ id, title, reason: "checked" });
        continue;
      }
      if (notified[id]) {
        if (diagnose) summary.skipped.push({ id, title, reason: "already notified" });
        continue;
      }

      const dueMs = parseDueMs(item);
      if (dueMs == null) {
        if (diagnose) summary.skipped.push({ id, title, reason: "bad due date" });
        continue;
      }
      // Veracross due times are usually midnight of the due day. Remind on the
      // local calendar day before and throughout the due day itself.
      if (!shouldRemind(dueMs, now)) {
        if (diagnose) {
          summary.skipped.push({ id, title, reason: `outside window (${item.dueDateText || item.dueDate})` });
        }
        continue;
      }

      const notificationId = `vch-assessment:${id}`;
      const dueLabel = formatDueLabel(item, dueMs);
      const message = [item.className, dueLabel].filter(Boolean).join(" · ");

      try {
        await showReminderNotification(
          notificationId,
          item.title || "Upcoming assessment",
          message || "Due soon",
        );
        notified[id] = Date.now();
        changed = true;
        summary.created.push(title);
      } catch (error) {
        const msg = error?.message || String(error);
        summary.errors.push(`notify failed: ${msg}`);
        console.warn("Could not create assessment notification.", error);
      }
    }

    if (changed) {
      // Drop stale notified ids that are no longer in the cache.
      const liveIds = new Set(
        items.map((item) => String(item.id || item.storageKey || "")),
      );
      for (const key of Object.keys(notified)) {
        if (!liveIds.has(key)) delete notified[key];
      }
      await browser.storage.local.set({ [NOTIFIED_KEY]: notified });
    }

    summary.notified = summary.created.length;
    if (diagnose) console.info("VCH reminders:", summary);
    return summary;
  } catch (error) {
    summary.errors.push(error?.message || String(error));
    console.warn("Assessment reminder check failed.", error);
    return summary;
  }
}

async function showReminderNotification(notificationId, title, message) {
  const icon = browser.runtime.getURL("icons/128.png");
  // Web Notifications stay on screen (requireInteraction). chrome.notifications
  // often reports success on macOS while the banner never appears.
  if (self.registration?.showNotification) {
    await self.registration.showNotification(title, {
      body: message,
      icon,
      tag: notificationId,
      requireInteraction: true,
    });
    return;
  }

  await browser.notifications.create(notificationId, {
    type: "basic",
    iconUrl: icon,
    title,
    message,
    priority: 2,
  });
}

function isAssignmentChecked(checkedMap, storageKey) {
  if (!storageKey || !checkedMap) return false;
  return !!checkedMap[storageKey];
}

function parseDueMs(item) {
  if (item?.dueDate) {
    const ms = Date.parse(item.dueDate);
    if (!Number.isNaN(ms)) return ms;
  }
  if (item?.dueDateText) {
    const ms = Date.parse(item.dueDateText);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/**
 * Remind from local midnight of the day before due through end of the due day.
 * @param {number} dueMs
 * @param {number} now
 */
function shouldRemind(dueMs, now) {
  const due = new Date(dueMs);
  const dueDayStart = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
  ).getTime();
  const dueDayEnd = dueDayStart + MS_DAY;
  const remindStart = dueDayStart - MS_DAY;
  return now >= remindStart && now < dueDayEnd;
}

function formatDueLabel(item, dueMs) {
  if (item?.dueDateText) return `Due ${item.dueDateText}`;
  try {
    return `Due ${new Date(dueMs).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })}`;
  } catch {
    return "Due soon";
  }
}

async function focusOrOpenPortal() {
  try {
    const local = await browser.storage.local.get({
      [ASSESSMENT_CACHE_KEY]: null,
    });
    const cache = local[ASSESSMENT_CACHE_KEY];
    const preferredOrigin =
      cache?.portalOrigin ||
      (cache?.host ? `https://${cache.host}` : "https://portals.veracross.com");

    const tabs = await browser.tabs.query({ url: PORTAL_HOST_MATCH });
    const match =
      tabs.find((tab) => tab.url?.startsWith(preferredOrigin)) || tabs[0];

    if (match?.id != null) {
      if (match.windowId != null) {
        await browser.windows.update(match.windowId, { focused: true });
      }
      await browser.tabs.update(match.id, { active: true });
      return;
    }

    await browser.tabs.create({ url: preferredOrigin });
  } catch (error) {
    console.debug("Could not open Veracross portal from notification.", error);
    try {
      await browser.tabs.create({ url: "https://portals.veracross.com" });
    } catch {
      // Ignore.
    }
  }
}

// Ensure alarm + popup path are correct whenever the worker wakes.
syncAssessmentAlarm();
void syncActionPopup();

// Service-worker console helper (sendMessage from this worker has no receiver).
globalThis.vchCheckReminders = (opts) =>
  checkAssessmentReminders({ force: true, diagnose: true, ...opts });
