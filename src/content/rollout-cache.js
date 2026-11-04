/**
 * Synchronous session snapshot of rollout + theme so document_start theme-boot
 * (and document_end content boot) can avoid FOUC without awaiting the Worker.
 */

const SESSION_KEY = "vch_rollout_theme_cache";

/**
 * @typedef {{
 *   rolloutEnabled: boolean,
 *   themeId: string,
 *   updatedAt: number,
 * }} RolloutThemeCache
 */

/**
 * @returns {RolloutThemeCache | null}
 */
export function readRolloutThemeCache() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.rolloutEnabled !== "boolean") return null;
    return {
      rolloutEnabled: parsed.rolloutEnabled === true,
      themeId: typeof parsed.themeId === "string" ? parsed.themeId : "none",
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ rolloutEnabled: boolean, themeId?: string }} state
 */
export function writeRolloutThemeCache(state) {
  try {
    /** @type {RolloutThemeCache} */
    const next = {
      rolloutEnabled: state.rolloutEnabled === true,
      themeId:
        typeof state.themeId === "string" && state.themeId
          ? state.themeId
          : readRolloutThemeCache()?.themeId || "none",
      updatedAt: Date.now(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    // sessionStorage may be blocked in some frames
  }
}
