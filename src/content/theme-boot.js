/**
 * Early theme boot at document_start to reduce unthemed flash.
 * Applies selectedTheme tokens as soon as storage is available.
 */
import browser from "webextension-polyfill";
import {
  DEFAULT_THEME_ID,
  getTheme,
  resolveThemeId,
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

try {
  browser.storage.sync
    .get({ selectedTheme: DEFAULT_THEME_ID })
    .then((stored) => {
      apply(stored.selectedTheme || DEFAULT_THEME_ID);
    })
    .catch(() => {
      apply(DEFAULT_THEME_ID);
    });
} catch {
  apply(DEFAULT_THEME_ID);
}

// Live theme changes are handled by theme.js so transitions run once.
