import browser from "webextension-polyfill";
import { isExtensionAlive } from "./storage.js";

/** Configurable Worker origin (must match manifest host_permissions). */
export const ROLLOUT_ENDPOINT = "https://rollout.codegraph.cc/v1/rollout";

const SESSION_USER_KEY = "vch_rollout_user";
const SESSION_RESULT_KEY = "vch_rollout_result";
const STORAGE_ENABLED_KEY = "rolloutEnabled";
const STORAGE_REASON_KEY = "rolloutReason";
const STORAGE_VERSION_KEY = "rolloutVersion";

/**
 * Resolve Veracross portal email local-part with several DOM / page fallbacks.
 * Cached in sessionStorage for the tab session.
 * @returns {string} lowercase local-part, or "" if unknown
 */
export function resolveVeracrossLocalPart() {
  try {
    const cached = sessionStorage.getItem(SESSION_USER_KEY);
    if (cached != null && cached !== "") return cached;
  } catch {
    // sessionStorage may be blocked in some embed frames
  }

  const resolved =
    fromMailtoLinks() ||
    fromDataAttributes() ||
    fromProfileMenuText() ||
    fromPageJson() ||
    fromUrlHints() ||
    "";

  if (resolved) {
    try {
      sessionStorage.setItem(SESSION_USER_KEY, resolved);
    } catch {
      // ignore
    }
  }
  return resolved;
}

/**
 * @param {string} value
 * @returns {string}
 */
function localPartFromEmailish(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const emailMatch = trimmed.match(
    /([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})/i,
  );
  if (emailMatch) return emailMatch[1].toLowerCase();
  // Bare username: letters/digits/._- only, reasonable length
  if (/^[a-z0-9._-]{2,64}$/i.test(trimmed) && !trimmed.includes(" ")) {
    return trimmed.toLowerCase();
  }
  return "";
}

function fromMailtoLinks() {
  const links = document.querySelectorAll('a[href^="mailto:"]');
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const addr = href.replace(/^mailto:/i, "").split("?")[0];
    const part = localPartFromEmailish(addr);
    if (part) return part;
  }
  return "";
}

function fromDataAttributes() {
  const selectors = [
    "[data-user-email]",
    "[data-email]",
    "[data-username]",
    "[data-user-name]",
    "[data-login]",
    "[data-person-email]",
    "[data-current-user]",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    for (const attr of [
      "data-user-email",
      "data-email",
      "data-username",
      "data-user-name",
      "data-login",
      "data-person-email",
      "data-current-user",
    ]) {
      const part = localPartFromEmailish(el.getAttribute(attr) || "");
      if (part) return part;
    }
  }
  return "";
}

function fromProfileMenuText() {
  const candidates = document.querySelectorAll(
    [
      "[class*='user']",
      "[class*='profile']",
      "[class*='account']",
      "[id*='user']",
      "[id*='profile']",
      "header",
      "nav",
      ".dropdown-menu",
      "[role='menu']",
    ].join(","),
  );
  for (const el of candidates) {
    const text = (el.textContent || "").slice(0, 500);
    const match = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (match) {
      const part = localPartFromEmailish(match[0]);
      if (part) return part;
    }
  }
  return "";
}

function fromPageJson() {
  const scripts = document.querySelectorAll(
    'script[type="application/json"], script[type="application/ld+json"]',
  );
  for (const script of scripts) {
    const raw = script.textContent || "";
    if (!raw || raw.length > 200_000) continue;
    if (!/@/.test(raw) && !/email|username|login/i.test(raw)) continue;
    try {
      const data = JSON.parse(raw);
      const found = walkForEmail(data, 0);
      if (found) return found;
    } catch {
      // not JSON
    }
  }

  // Common globals sometimes dumped into inline scripts
  const inline = document.querySelectorAll("script:not([src])");
  for (const script of inline) {
    const raw = script.textContent || "";
    if (raw.length > 100_000) continue;
    const match = raw.match(
      /"(?:email|user_email|username|login)"\s*:\s*"([^"]+)"/i,
    );
    if (match) {
      const part = localPartFromEmailish(match[1]);
      if (part) return part;
    }
  }
  return "";
}

/**
 * @param {unknown} node
 * @param {number} depth
 * @returns {string}
 */
function walkForEmail(node, depth) {
  if (depth > 8 || node == null) return "";
  if (typeof node === "string") return localPartFromEmailish(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walkForEmail(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof node === "object") {
    const obj = /** @type {Record<string, unknown>} */ (node);
    for (const key of [
      "email",
      "user_email",
      "userEmail",
      "username",
      "login",
      "user_name",
    ]) {
      if (key in obj) {
        const found = localPartFromEmailish(String(obj[key] ?? ""));
        if (found) return found;
      }
    }
    for (const value of Object.values(obj)) {
      const found = walkForEmail(value, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function fromUrlHints() {
  try {
    const path = location.pathname || "";
    // e.g. /student/portal/... rarely embeds username; skip fragile guesses
    const params = new URLSearchParams(location.search);
    for (const key of ["user", "username", "login", "email"]) {
      const part = localPartFromEmailish(params.get(key) || "");
      if (part) return part;
    }
    void path;
  } catch {
    // ignore
  }
  return "";
}

/**
 * @typedef {{ enabled: boolean, version: string, published: boolean, reason: string }} RolloutResult
 */

/**
 * Fetch rollout status for the installed extension version + resolved user.
 * Sets `document.documentElement.dataset.vchRollout`, syncs storage, and
 * toggles `[data-vch-beta]` visibility.
 *
 * @returns {Promise<RolloutResult>}
 */
export async function initRollout() {
  const version = browser.runtime.getManifest()?.version || "";
  const user = resolveVeracrossLocalPart();

  /** @type {RolloutResult} */
  let result = {
    enabled: false,
    version,
    published: false,
    reason: "pending",
  };

  // Short-lived session cache to avoid hammering the Worker on SPA navigations
  try {
    const cachedRaw = sessionStorage.getItem(SESSION_RESULT_KEY);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (
        cached &&
        cached.version === version &&
        cached.user === user &&
        typeof cached.enabled === "boolean" &&
        Date.now() - (cached.fetchedAt || 0) < 60_000
      ) {
        result = {
          enabled: cached.enabled,
          version: cached.version,
          published: !!cached.published,
          reason: cached.reason || "cached",
        };
        applyRolloutResult(result);
        return result;
      }
    }
  } catch {
    // ignore cache errors
  }

  if (!version) {
    result.reason = "missing_version";
    applyRolloutResult(result);
    return result;
  }

  try {
    const url = new URL(ROLLOUT_ENDPOINT);
    url.searchParams.set("version", version);
    if (user) url.searchParams.set("user", user);

    const response = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
      cache: "no-cache",
    });

    if (response.ok) {
      const data = await response.json();
      result = {
        enabled: data?.enabled === true,
        version: typeof data?.version === "string" ? data.version : version,
        published: data?.published === true,
        reason: typeof data?.reason === "string" ? data.reason : "ok",
      };
    } else {
      result.reason = `http_${response.status}`;
    }
  } catch {
    result.reason = "fetch_failed";
  }

  try {
    sessionStorage.setItem(
      SESSION_RESULT_KEY,
      JSON.stringify({
        ...result,
        user,
        fetchedAt: Date.now(),
      }),
    );
  } catch {
    // ignore
  }

  applyRolloutResult(result);
  await syncRolloutStorage(result);
  return result;
}

/**
 * @param {RolloutResult} result
 */
function applyRolloutResult(result) {
  try {
    document.documentElement.dataset.vchRollout = result.enabled ? "1" : "0";
  } catch {
    // ignore
  }

  // Beta channel: show elements marked data-vch-beta only when enabled
  try {
    document.querySelectorAll("[data-vch-beta]").forEach((el) => {
      if (result.enabled) {
        el.removeAttribute("hidden");
        el.setAttribute("data-vch-beta-active", "1");
      } else {
        el.setAttribute("hidden", "");
        el.removeAttribute("data-vch-beta-active");
      }
    });
  } catch {
    // ignore
  }
}

/**
 * @param {RolloutResult} result
 */
async function syncRolloutStorage(result) {
  if (!isExtensionAlive()) return;
  try {
    await browser.storage.local.set({
      [STORAGE_ENABLED_KEY]: result.enabled,
      [STORAGE_REASON_KEY]: result.reason,
      [STORAGE_VERSION_KEY]: result.version,
    });
  } catch {
    // ignore quota / invalidated context
  }
}

/**
 * Read last synced rollout flag (for popup / options).
 * @returns {Promise<boolean>}
 */
export async function getStoredRolloutEnabled() {
  if (!isExtensionAlive()) return false;
  try {
    const stored = await browser.storage.local.get({
      [STORAGE_ENABLED_KEY]: false,
    });
    return stored[STORAGE_ENABLED_KEY] === true;
  } catch {
    return false;
  }
}
