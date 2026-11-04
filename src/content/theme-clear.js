import { TOKEN_KEYS } from "../themes/registry.js";
import { unbindThemeHarden } from "./theme-harden.js";

/**
 * Fully strip theme state so the portal matches stock Veracross (no beta theme).
 * Safe to call when rollout.enabled is false / legacy experience.
 */
export function clearThemesFromDocument() {
  const root = document.documentElement;
  try {
    delete root.dataset.vchTheme;
    root.removeAttribute("data-vch-theme");
  } catch {
    // ignore
  }

  for (const key of TOKEN_KEYS) {
    try {
      root.style.removeProperty(`--vch-${key}`);
    } catch {
      // ignore
    }
  }

  try {
    unbindThemeHarden();
  } catch {
    // ignore
  }
}
