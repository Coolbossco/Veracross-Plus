/**
 * Early theme boot at document_start to reduce unthemed flash.
 *
 * Order:
 * 1. Sync session cache (same-tab navigations) — apply before first paint when possible
 * 2. Parallel chrome.storage read — confirm / correct
 * Never wait on the rollout Worker here. Non-beta clears themes.
 */
import browser from "webextension-polyfill";
import {
  DEFAULT_THEME_ID,
  getTheme,
  resolveThemeId,
  TOKEN_KEYS,
  tokensToCssVars,
} from "../themes/registry.js";
import { shouldSkipTheme } from "../themes/pages.js";
import {
  readRolloutThemeCache,
  writeRolloutThemeCache,
} from "./rollout-cache.js";
import "../themes/skin.css";
import "../themes/halloween/extras.css";
import "../themes/galaxy/extras.css";
import "../themes/aurora/extras.css";

function clearTheme(root) {
  delete root.dataset.vchTheme;
  root.removeAttribute("data-vch-theme");
  for (const key of TOKEN_KEYS) {
    root.style.removeProperty(`--vch-${key}`);
  }
}

/**
 * @param {string | null | undefined} themeId
 */
function apply(themeId) {
  const root = document.documentElement;
  if (shouldSkipTheme()) {
    clearTheme(root);
    return;
  }

  const resolvedId = resolveThemeId(themeId);
  const theme = getTheme(resolvedId);

  if (!theme) {
    clearTheme(root);
    return;
  }

  // Set attrs/vars without clearing first — avoids a one-frame unthemed flash.
  root.dataset.vchTheme = theme.id;
  const vars = tokensToCssVars(theme.tokens);
  const keep = new Set(Object.keys(vars));
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  for (const key of TOKEN_KEYS) {
    const name = `--vch-${key}`;
    if (!keep.has(name)) root.style.removeProperty(name);
  }
}

// 1) Synchronous session hint (best chance before first paint on SPA / reload in-tab)
try {
  const cached = readRolloutThemeCache();
  if (cached?.rolloutEnabled && cached.themeId && cached.themeId !== "none") {
    apply(cached.themeId);
  } else if (cached && cached.rolloutEnabled === false) {
    clearTheme(document.documentElement);
  }
} catch {
  // ignore
}

async function bootFromStorage() {
  const root = document.documentElement;
  try {
    const [local, sync] = await Promise.all([
      browser.storage.local.get({ rolloutEnabled: false }),
      browser.storage.sync.get({ selectedTheme: DEFAULT_THEME_ID }),
    ]);

    const enabled = local.rolloutEnabled === true;
    const themeId = resolveThemeId(sync.selectedTheme || DEFAULT_THEME_ID);
    writeRolloutThemeCache({ rolloutEnabled: enabled, themeId });

    if (!enabled) {
      clearTheme(root);
      return;
    }

    apply(themeId);
  } catch {
    // Keep session-cache paint if any; otherwise stay clear.
    const cached = readRolloutThemeCache();
    if (!cached?.rolloutEnabled) clearTheme(root);
  }
}

try {
  void bootFromStorage();
} catch {
  clearTheme(document.documentElement);
}

// Live theme + rollout changes are handled by theme.js after document_end.
