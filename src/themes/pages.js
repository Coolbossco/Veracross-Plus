/**
 * Page heuristics for theme application.
 */

/**
 * Pages that should stay stock Veracross (no dark/halloween skin).
 * Currently none — login + documents are themed with dedicated CSS.
 * @param {Window} [win]
 */
export function shouldSkipTheme(win = window) {
  try {
    void win;
    return false;
  } catch {
    return false;
  }
}

/** @deprecated use shouldSkipTheme */
export function isAuthPage(win = window) {
  return shouldSkipTheme(win);
}
