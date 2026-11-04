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
import { writeRolloutThemeCache } from "./rollout-cache.js";
import { isExtensionAlive } from "./storage.js";
import { clearThemesFromDocument } from "./theme-clear.js";
import {
  bindThemeHarden,
  scheduleThemeHarden,
} from "./theme-harden.js";

export { clearThemesFromDocument };

let themeBound = false;
let rolloutThemeBound = false;
let applyGeneration = 0;
/** Matches dual-experience default: themes off until rollout enables modern. */
let themesAllowed = false;

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
  if (!themesAllowed) {
    clearThemesFromDocument();
    return;
  }

  const root = document.documentElement;
  const resolvedId = resolveThemeId(themeId);
  const theme = shouldSkipTheme() ? null : getTheme(resolvedId);

  if (!theme) {
    clearThemesFromDocument();
    return;
  }

  // Already painted by theme-boot — don't strip vars then re-set (FOUC).
  if (root.dataset.vchTheme === theme.id) {
    const vars = tokensToCssVars(theme.tokens);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    bindThemeHarden();
    scheduleThemeHarden(0);
    return;
  }

  const vars = tokensToCssVars(theme.tokens);
  const keep = new Set(Object.keys(vars));
  root.dataset.vchTheme = theme.id;
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  for (const key of TOKEN_KEYS) {
    const name = `--vch-${key}`;
    if (!keep.has(name)) root.style.removeProperty(name);
  }
  bindThemeHarden();
  scheduleThemeHarden(0);
}

/**
 * Gate themes behind staged rollout. When disallowed, strip any active theme
 * (including leftover CSS vars / harden inline styles) so legacy matches CWS.
 * @param {boolean} allowed
 */
export function setThemesAllowed(allowed) {
  themesAllowed = allowed === true;
  if (!themesAllowed) {
    clearThemesFromDocument();
    writeRolloutThemeCache({ rolloutEnabled: false });
  } else {
    writeRolloutThemeCache({ rolloutEnabled: true });
  }
}

/**
 * Keep themes in sync if rolloutEnabled flips mid-session (e.g. allowlist edit).
 */
export function bindRolloutThemeGate() {
  if (rolloutThemeBound) return;
  rolloutThemeBound = true;

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.rolloutEnabled || !isExtensionAlive()) {
      return;
    }
    const enabled = changes.rolloutEnabled.newValue === true;
    setThemesAllowed(enabled);
    if (enabled) {
      void applySelectedTheme();
    }
  });
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
  writeRolloutThemeCache({
    rolloutEnabled: themesAllowed,
    themeId,
  });
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
  setThemesAllowed(true);
  bindThemeListeners();
  bindRolloutThemeGate();
  await applySelectedTheme();
}
