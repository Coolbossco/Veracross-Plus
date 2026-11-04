/**
 * Early theme boot at document_start to reduce unthemed flash.
 * Applies selectedTheme tokens only when staged rollout is enabled; otherwise
 * strips any theme attrs so non-beta / CWS legacy never keeps beta chrome.
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

  root.dataset.vchTheme = theme.id;
  const vars = tokensToCssVars(theme.tokens);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}

async function boot() {
  const root = document.documentElement;
  try {
    const local = await browser.storage.local.get({ rolloutEnabled: false });
    // Safe default matches dual-experience: legacy until Worker says otherwise.
    if (local.rolloutEnabled !== true) {
      clearTheme(root);
      return;
    }
  } catch {
    clearTheme(root);
    return;
  }

  try {
    const stored = await browser.storage.sync.get({
      selectedTheme: DEFAULT_THEME_ID,
    });
    apply(stored.selectedTheme || DEFAULT_THEME_ID);
  } catch {
    apply(DEFAULT_THEME_ID);
  }
}

try {
  void boot();
} catch {
  clearTheme(document.documentElement);
}

// Live theme + rollout changes are handled by theme.js after document_end.
