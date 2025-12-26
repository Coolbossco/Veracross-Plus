/**
 * Veracross Plus — Data Models
 *
 * Central export for all data models used throughout the extension.
 * These models provide type safety and future-proof data structures
 * for local storage and eventual cloud sync.
 */

// Assignment models
export {
  type AssignmentType,
  type AssignmentSource,
  type CustomAssignment,
  type NativeAssignmentRef,
  isCustomAssignment,
  isNativeAssignmentRef,
  createCustomAssignment,
  migrateLegacyAssignment,
} from "./Assignment";

// Completion state models
export {
  type CompletionState,
  type CompletionRecord,
  type CheckedAssignmentsStore,
  isCompleted,
  markCompleted,
  markNotCompleted,
  toggleCompletion,
  getCustomAssignmentKey,
  getNativeAssignmentKey,
  compactCompletionRecord,
  migrateLegacyCompletions,
} from "./Completion";

// User preferences models
export {
  type UserPreferences,
  type ToggleablePreference,
  DEFAULT_USER_PREFERENCES,
  validatePreferences,
  isFeatureEnabled,
  toggleFeature,
  updatePreferences,
  getPreferenceChanges,
} from "./UserPreferences";

