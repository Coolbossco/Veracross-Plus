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
import { isExtensionAlive } from "./storage.js";
import {
  bindThemeHarden,
  scheduleThemeHarden,
  unbindThemeHarden,
} from "./theme-harden.js";

let themeBound = false;
let applyGeneration = 0;

/**
 * Apply a theme id to the current document (every frame).
 * @param {string | null | undefined} themeId
 * @param {{ transition?: boolean }} [opts]
 */
export function applyThemeToDocument(themeId, { transition = false } = {}) {
  const run = () => applyThemeImmediate(themeId);
  if (!transition) {
    run();
    return;
  }

  const doc = document;
  if (typeof doc.startViewTransition === "function") {
    try {
      const generation = ++applyGeneration;
      const transitionHandle = doc.startViewTransition(() => {
        if (generation !== applyGeneration) return;
        run();
      });
      void transitionHandle.finished.catch(() => {
        // Ignore aborted / unsupported transition failures.
      });
      return;
    } catch {
      // Fall through to immediate apply; CSS var transitions still help.
    }
  }
  run();
}

/**
 * @param {string | null | undefined} themeId
 */
function applyThemeImmediate(themeId) {
  const root = document.documentElement;
  const resolvedId = resolveThemeId(themeId);
  const theme = shouldSkipTheme() ? null : getTheme(resolvedId);

  for (const key of TOKEN_KEYS) {
    root.style.removeProperty(`--vch-${key}`);
  }

  if (!theme) {
    delete root.dataset.vchTheme;
    root.removeAttribute("data-vch-theme");
    unbindThemeHarden();
    return;
  }

  root.dataset.vchTheme = theme.id;
  const vars = tokensToCssVars(theme.tokens);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  bindThemeHarden();
  scheduleThemeHarden(0);
}

export async function applySelectedTheme() {
  let themeId = DEFAULT_THEME_ID;
  try {
    if (isExtensionAlive()) {
      const stored = await browser.storage.sync.get({
        selectedTheme: DEFAULT_THEME_ID,
      });
      themeId = resolveThemeId(stored.selectedTheme || DEFAULT_THEME_ID);
      if (themeId !== (stored.selectedTheme || DEFAULT_THEME_ID)) {
        await browser.storage.sync.set({ selectedTheme: themeId });
      }
    }
  } catch {
    themeId = DEFAULT_THEME_ID;
  }
  applyThemeToDocument(themeId);
}

export function bindThemeListeners() {
  if (themeBound) return;
  themeBound = true;

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.selectedTheme || !isExtensionAlive()) {
      return;
    }
    applyThemeToDocument(changes.selectedTheme.newValue, { transition: true });
  });
}

export async function initTheme() {
  bindThemeListeners();
  await applySelectedTheme();
}
