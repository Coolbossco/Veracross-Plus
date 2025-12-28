/**
 * Veracross Plus — User Preferences Model
 *
 * Defines user preferences and settings for the extension.
 * All preferences are stored locally and never synced to cloud
 * without explicit user consent.
 *
 * @version 1
 */

/**
 * User preferences for Veracross Plus features
 */
export interface UserPreferences {
  /** Enable homework checkboxes on timeline and schedule pages */
  enableChecklist: boolean;

  /** Enable custom assignments feature */
  enableCustomAssignments: boolean;
}

/**
 * Default user preferences
 *
 * All features are opt-in (disabled by default) to ensure
 * a non-intrusive initial experience.
 */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  enableChecklist: false,
  enableCustomAssignments: false,
};

/**
 * Preference keys that can be toggled on/off
 */
export type ToggleablePreference =
  | "enableChecklist"
  | "enableCustomAssignments";

/**
 * Validate and normalize user preferences
 *
 * Ensures all required fields exist with valid types.
 */
export function validatePreferences(
  data: Partial<UserPreferences>
): UserPreferences {
  return {
    enableChecklist: Boolean(data.enableChecklist ?? DEFAULT_USER_PREFERENCES.enableChecklist),
    enableCustomAssignments: Boolean(data.enableCustomAssignments ?? DEFAULT_USER_PREFERENCES.enableCustomAssignments),
  };
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(
  preferences: UserPreferences,
  feature: ToggleablePreference
): boolean {
  return preferences[feature] === true;
}

/**
 * Create updated preferences with a toggled feature
 */
export function toggleFeature(
  preferences: UserPreferences,
  feature: ToggleablePreference
): UserPreferences {
  return {
    ...preferences,
    [feature]: !preferences[feature],
  };
}

/**
 * Create updated preferences with multiple changes
 */
export function updatePreferences(
  current: UserPreferences,
  updates: Partial<UserPreferences>
): UserPreferences {
  return validatePreferences({
    ...current,
    ...updates,
  });
}

/**
 * Extract only the changed preferences
 *
 * Useful for efficient storage updates.
 */
export function getPreferenceChanges(
  current: UserPreferences,
  updated: UserPreferences
): Partial<UserPreferences> {
  const changes: Partial<UserPreferences> = {};

  for (const key of Object.keys(DEFAULT_USER_PREFERENCES) as (keyof UserPreferences)[]) {
    if (current[key] !== updated[key]) {
      (changes as Record<string, unknown>)[key] = updated[key];
    }
  }

  return changes;
}

