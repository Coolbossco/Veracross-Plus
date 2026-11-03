import darkTheme from "./dark/theme.json";
import halloweenTheme from "./halloween/theme.json";
import softLightTheme from "./soft-light/theme.json";
import lilacTheme from "./lilac/theme.json";
import matchaTheme from "./matcha/theme.json";
import oceanTheme from "./ocean/theme.json";
import forestTheme from "./forest/theme.json";
import emberTheme from "./ember/theme.json";
import galaxyTheme from "./galaxy/theme.json";
import auroraTheme from "./aurora/theme.json";

/** @typedef {{
 *   id: string,
 *   name: string,
 *   description?: string,
 *   group?: "light" | "dark" | "seasonal" | "fun",
 *   tokens: Record<string, string>
 * }} ThemePack */

/** @type {ThemePack[]} */
export const THEMES = [
  softLightTheme,
  lilacTheme,
  matchaTheme,
  darkTheme,
  oceanTheme,
  forestTheme,
  emberTheme,
  halloweenTheme,
  galaxyTheme,
  auroraTheme,
];

export const DEFAULT_THEME_ID = "none";

/** Removed for poor contrast; map any leftover storage ids to Dark. */
export const REMOVED_THEME_IDS = ["winter", "valentine", "custom"];

/** @type {Record<string, string>} */
export const THEME_GROUP_LABELS = {
  light: "Light",
  dark: "Dark",
  seasonal: "Seasonal",
  fun: "Fun",
};

export const THEME_GROUP_ORDER = ["light", "dark", "seasonal", "fun"];

export const TOKEN_KEYS = [
  "bg",
  "surface",
  "surfaceAlt",
  "text",
  "textMuted",
  "border",
  "accent",
  "accentText",
  "headerBg",
  "headerText",
  "link",
  "today",
  "danger",
  "shadow",
];

/**
 * Themes featured in the what's-new live demo.
 * @type {string[]}
 */
export const WHATS_NEW_DEMO_THEME_IDS = [
  "none",
  "soft-light",
  "lilac",
  "matcha",
  "dark",
  "ocean",
  "forest",
  "ember",
  "halloween",
  "galaxy",
  "aurora",
];

/**
 * @param {string | null | undefined} id
 * @returns {ThemePack | null}
 */
export function getTheme(id) {
  if (!id || id === DEFAULT_THEME_ID) return null;
  if (REMOVED_THEME_IDS.includes(id)) return null;
  return THEMES.find((theme) => theme.id === id) || null;
}

/**
 * @param {string | null | undefined} id
 * @returns {string}
 */
export function resolveThemeId(id) {
  if (!id || id === DEFAULT_THEME_ID) return DEFAULT_THEME_ID;
  if (REMOVED_THEME_IDS.includes(id) || !getTheme(id)) return "dark";
  return id;
}

/**
 * @param {Record<string, string>} tokens
 * @returns {Record<string, string>}
 */
export function tokensToCssVars(tokens = {}) {
  const vars = {};
  for (const key of TOKEN_KEYS) {
    if (tokens[key]) {
      vars[`--vch-${key}`] = tokens[key];
    }
  }
  return vars;
}
