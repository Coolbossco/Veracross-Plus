/**
 * Per-version bullet lists shown in the Veracross what's-new modal.
 * Add a new key matching package.json / manifest version on each release.
 * @type {Record<string, string[]>}
 */
export const CHANGELOG = {
  "0.7.1": [
    "Themes recolor the assignment timeline without moving its columns, class rail, or chips",
    "The week bar above the assignment days uses the theme surface color",
    "Beta stays on through a failed allowlist check, and the toolbar popup matches the page",
  ],
  "0.7.0": [
    "Redesigned settings popup and overlay chrome with Geist type and shared tokens",
    "Homepage homework grouped by calendar day under Past due and Upcoming",
    "Official Veracross Plus toolbar and store icons",
    "Staged rollout: non-beta keeps CWS UI; allowlist/published unlocks redesign",
  ],
  "0.6.0": [
    "Themes: Default, Soft Light, Lilac, Matcha, Dark, Ocean, Forest, Ember, Halloween, Galaxy, and Aurora",
    "Homepage widget for upcoming and past-due homework",
    "Lunch card on the student home page",
    "Assessment reminders and a faster settings popup",
  ],
};

/**
 * @param {string} version
 * @returns {string[]}
 */
export function changelogForVersion(version) {
  const entry = CHANGELOG[version];
  if (Array.isArray(entry) && entry.length) return entry;
  return ["Extension updated. Open the toolbar popup to explore settings and themes."];
}
