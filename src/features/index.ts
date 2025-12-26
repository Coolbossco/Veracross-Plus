/**
 * Veracross Plus — Features Module
 *
 * Central export for feature flag system.
 */

export {
  type FeatureFlag,
  type FeatureFlagConfig,
  FEATURE_FLAG_CONFIG,
  getFeatureFlags,
  initializeFeatureFlags,
  isFeatureEnabled,
  isFeatureAvailable,
} from "./FeatureFlags";

