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

  /** Enable grade percentage estimator */
  enableEstimator: boolean;

  /** Enable automatic redirect to a custom home URL */
  enableHomeRedirect: boolean;

  /** Enable custom assignments feature */
  enableCustomAssignments: boolean;

  /** Custom home URL for redirect feature (relative or absolute) */
  homeUrl: string;
}

/**
 * Default user preferences
 *
 * All features are opt-in (disabled by default) to ensure
 * a non-intrusive initial experience.
 */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  enableChecklist: false,
  enableEstimator: false,
  enableHomeRedirect: false,
  enableCustomAssignments: false,
  homeUrl: "",
};

/**
 * Preference keys that can be toggled on/off
 */
export type ToggleablePreference =
  | "enableChecklist"
  | "enableEstimator"
  | "enableHomeRedirect"
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
    enableEstimator: Boolean(data.enableEstimator ?? DEFAULT_USER_PREFERENCES.enableEstimator),
    enableHomeRedirect: Boolean(data.enableHomeRedirect ?? DEFAULT_USER_PREFERENCES.enableHomeRedirect),
    enableCustomAssignments: Boolean(data.enableCustomAssignments ?? DEFAULT_USER_PREFERENCES.enableCustomAssignments),
    homeUrl: typeof data.homeUrl === "string" ? data.homeUrl : DEFAULT_USER_PREFERENCES.homeUrl,
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

