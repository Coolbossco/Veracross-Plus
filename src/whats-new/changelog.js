/**
 * Per-version bullet lists shown in the Veracross what's-new modal.
 * Add a new key matching package.json / manifest version on each release.
 * @type {Record<string, string[]>}
 */
export const CHANGELOG = {
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
