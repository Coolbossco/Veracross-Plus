import browser from "webextension-polyfill";
import { decideRollout } from "./rollout-decision.js";
import { writeRolloutThemeCache } from "./rollout-cache.js";
import { isExtensionAlive } from "./storage.js";

/** Configurable Worker origin (must match manifest host_permissions). */
export const ROLLOUT_ENDPOINT = "https://rollout.codegraph.cc/v1/rollout";

const SESSION_RESULT_KEY = "vch_rollout_result";
const STORAGE_ENABLED_KEY = "rolloutEnabled";
const STORAGE_REASON_KEY = "rolloutReason";
const STORAGE_VERSION_KEY = "rolloutVersion";
const STORAGE_CONFIRMED_KEY = "rolloutConfirmed";
const STORAGE_USER_KEY = "rolloutUser";
const FETCH_TIMEOUT_MS = 8000;
const SESSION_TTL_MS = 60_000;

let rolloutGeneration = 0;

/**
 * Resolve Veracross portal email local-part with several DOM / page fallbacks.
 * Not cached: a wrong first mailto used to stick for the whole tab and the
 * Worker answered not_allowlisted.
 * Prefer structured fields over the first mailto on the page.
 * @returns {string} lowercase local-part, or "" if unknown
 */
export function resolveVeracrossLocalPart() {
  return (
    fromDataAttributes() ||
    fromPageJson() ||
    fromProfileMenuText() ||
    fromMailtoLinks() ||
    fromUrlHints() ||
    ""
  );
}

/**
 * Re-check once the header/profile markup arrives. Calls `onUser` at most once.
 * @param {(user: string) => void} onUser
 * @returns {() => void}
 */
export function watchForRolloutUser(onUser) {
  if (resolveVeracrossLocalPart()) return () => {};

  let stopped = false;
  /** @type {MutationObserver} */
  let observer;
  /** @type {ReturnType<typeof setTimeout>} */
  let timer;

  const stop = () => {
    stopped = true;
    observer?.disconnect();
    clearTimeout(timer);
  };

  observer = new MutationObserver(() => {
    if (stopped) return;
    const found = resolveVeracrossLocalPart();
    if (!found) return;
    stop();
    onUser(found);
  });

  try {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  } catch {
    return stop;
  }

  timer = setTimeout(stop, 12_000);
  return stop;
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
 * @typedef {{ enabled: boolean, version: string, published: boolean, reason: string, superseded?: boolean }} RolloutResult
 */

/**
 * @returns {Promise<{ enabled: boolean, version: string, user: string, confirmed: boolean, reason: string }>}
 */
async function readStoredRollout() {
  const empty = {
    enabled: false,
    version: "",
    user: "",
    confirmed: false,
    reason: "",
  };
  if (!isExtensionAlive()) return empty;
  try {
    const stored = await browser.storage.local.get({
      [STORAGE_ENABLED_KEY]: false,
      [STORAGE_REASON_KEY]: "",
      [STORAGE_VERSION_KEY]: "",
      [STORAGE_CONFIRMED_KEY]: false,
      [STORAGE_USER_KEY]: "",
    });
    return {
      enabled: stored[STORAGE_ENABLED_KEY] === true,
      reason:
        typeof stored[STORAGE_REASON_KEY] === "string"
          ? stored[STORAGE_REASON_KEY]
          : "",
      version:
        typeof stored[STORAGE_VERSION_KEY] === "string"
          ? stored[STORAGE_VERSION_KEY]
          : "",
      confirmed: stored[STORAGE_CONFIRMED_KEY] === true,
      user:
        typeof stored[STORAGE_USER_KEY] === "string"
          ? stored[STORAGE_USER_KEY]
          : "",
    };
  } catch {
    return empty;
  }
}

/**
 * @param {string} version
 * @param {string} user
 */
function readAuthoritativeSession(version, user) {
  try {
    const raw = sessionStorage.getItem(SESSION_RESULT_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (
      cached &&
      cached.authoritative === true &&
      cached.version === version &&
      cached.user === user &&
      typeof cached.enabled === "boolean" &&
      Date.now() - (cached.fetchedAt || 0) < SESSION_TTL_MS
    ) {
      return cached;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * @param {{ enabled: boolean, reason: string, authoritative: boolean }} decision
 * @param {string} version
 * @param {string} user
 */
function writeAuthoritativeSession(decision, version, user) {
  if (!decision.authoritative || !user) return;
  try {
    sessionStorage.setItem(
      SESSION_RESULT_KEY,
      JSON.stringify({
        enabled: decision.enabled === true,
        version,
        user,
        reason: decision.reason,
        authoritative: true,
        fetchedAt: Date.now(),
      }),
    );
  } catch {
    // ignore
  }
}

/**
 * @param {string} version
 * @param {string} user
 * @returns {Promise<import("./rollout-decision.js").RolloutOutcome>}
 */
async function fetchRollout(version, user) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = new URL(ROLLOUT_ENDPOINT);
    url.searchParams.set("version", version);
    url.searchParams.set("user", user);
    const response = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { type: "http", reason: `http_${response.status}` };
    }
    const data = await response.json();
    return {
      type: "body",
      enabled: data?.enabled === true,
      reason: typeof data?.reason === "string" ? data.reason : "ok",
    };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : "fetch_failed";
    return { type: "transport", reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch rollout status for the installed extension version + resolved user.
 * One decision is written to storage (toolbar popup) and the document
 * (theme / experience) together.
 *
 * A prior enabled=true is kept across timeouts, HTTP errors, missing config,
 * and a missed username lookup. Explicit not_allowlisted / unpublished for
 * the granted user still turns beta off.
 *
 * @returns {Promise<RolloutResult>}
 */
export async function initRollout() {
  const generation = ++rolloutGeneration;
  const version = browser.runtime.getManifest()?.version || "";
  const stored = await readStoredRollout();
  const fresh = resolveVeracrossLocalPart();

  let user = fresh;
  if (stored.user && fresh && fresh !== stored.user) {
    // Ask about the identity we already granted, not a stray mailto.
    user = stored.user;
    console.debug("[veracross-plus] rollout lookup_mismatch");
  } else if (!user && stored.user) {
    user = stored.user;
    console.debug("[veracross-plus] rollout stored_user");
  }

  const cached = version && user ? readAuthoritativeSession(version, user) : null;

  // Paint popup + document from the grant before the network so a slow or
  // failed check cannot leave the themed page on the legacy toolbar popup.
  if (stored.enabled === true && !(cached && cached.enabled === false)) {
    await commitRollout(
      {
        enabled: true,
        reason: stored.reason || "sticky",
        authoritative: false,
        rememberUser: stored.user || "",
      },
      version,
    );
  }

  /** @type {import("./rollout-decision.js").RolloutOutcome} */
  let outcome;
  if (!version) {
    outcome = { type: "transport", reason: "missing_version" };
  } else if (!user) {
    outcome = { type: "missing_user", reason: "missing_user" };
  } else if (cached) {
    outcome = {
      type: "body",
      enabled: cached.enabled === true,
      reason: typeof cached.reason === "string" ? cached.reason : "cached",
    };
  } else {
    outcome = await fetchRollout(version, user);
  }

  const decision = decideRollout({ user, stored, outcome });
  if (generation !== rolloutGeneration) {
    return {
      enabled: decision.enabled,
      version,
      published: false,
      reason: decision.reason,
      superseded: true,
    };
  }

  writeAuthoritativeSession(decision, version, user || decision.rememberUser);
  const applied = await commitRollout(decision, version);
  return {
    enabled: applied.enabled,
    version,
    published: false,
    reason: applied.reason,
    superseded: false,
  };
}

/**
 * @param {RolloutResult} result
 */
function applyRolloutResult(result) {
  try {
    document.documentElement.dataset.vchRollout = result.enabled ? "1" : "0";
    document.documentElement.dataset.vchExperience = result.enabled
      ? "modern"
      : "legacy";
  } catch {
    // ignore
  }

  // Optional markup hooks: show elements marked data-vch-beta only when enabled
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
 * Write the same bit the popup and the page both read, then tell the
 * service worker to setPopup even when the stored value did not change
 * (no storage event, so a legacy default popup would otherwise stick).
 * @param {{ enabled: boolean, reason: string, authoritative: boolean, rememberUser: string }} decision
 * @param {string} version
 * @returns {Promise<{ enabled: boolean, reason: string }>}
 */
async function commitRollout(decision, version) {
  let enabled = decision.enabled === true;
  let reason = decision.reason || "";
  let rememberUser = decision.rememberUser || "";

  // A frame that never saw the username must not overwrite another frame's grant.
  if (!enabled && decision.authoritative !== true) {
    const latest = await readStoredRollout();
    if (latest.enabled === true) {
      enabled = true;
      reason = latest.reason || "sticky";
      rememberUser = latest.user || rememberUser;
      console.debug("[veracross-plus] rollout kept grant");
    }
  }

  applyRolloutResult({
    enabled,
    version,
    published: false,
    reason,
  });
  writeRolloutThemeCache({ rolloutEnabled: enabled });

  console.debug(
    `[veracross-plus] rollout ${enabled ? "enabled" : "legacy"} (${reason})`,
  );

  if (!isExtensionAlive()) return { enabled, reason };

  /** @type {Record<string, unknown>} */
  const payload = {
    [STORAGE_ENABLED_KEY]: enabled,
    [STORAGE_REASON_KEY]: reason,
    [STORAGE_VERSION_KEY]: version,
  };
  if (decision.authoritative && enabled === (decision.enabled === true)) {
    payload[STORAGE_CONFIRMED_KEY] = enabled;
  }
  if (rememberUser) {
    payload[STORAGE_USER_KEY] = rememberUser;
  }

  try {
    await browser.storage.local.set(payload);
  } catch {
    // ignore quota / invalidated context
  }

  try {
    await browser.runtime.sendMessage({
      type: "VCH_ROLLOUT",
      enabled,
      reason,
      version,
    });
  } catch {
    // background may be asleep — storage listener is the backup when the bit changes
  }

  return { enabled, reason };
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
