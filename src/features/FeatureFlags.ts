/**
 * Veracross Plus — Feature Flag System
 *
 * Lightweight feature flag system for controlling feature availability.
 * Flags are stored locally and can be overridden for testing.
 *
 * Current flags:
 * - enableChecklist: Homework checkboxes (enabled by default when user opts in)
 * - enableCustomAssignments: Custom assignments feature
 * - enableCloudSync: Cloud synchronization (future, off by default)
 * - enableAccounts: User accounts (future, off by default)
 *
 * @version 1
 */

import { getStorageProvider } from "../storage";
import { STORAGE_KEYS } from "../storage/StorageProvider";

/**
 * Available feature flags
 */
export type FeatureFlag =
  | "enableChecklist"
  | "enableCustomAssignments"

  // Future features (Phase 2+)
  | "enableCloudSync"
  | "enableAccounts"
  | "enablePremium";

/**
 * Feature flag configuration
 */
export interface FeatureFlagConfig {
  /** Whether the feature is enabled by default */
  defaultEnabled: boolean;

  /** Whether users can toggle this feature */
  userConfigurable: boolean;

  /** Whether this feature requires an account */
  requiresAccount: boolean;

  /** Whether this feature requires premium subscription */
  requiresPremium: boolean;

  /** Human-readable feature name */
  displayName: string;

  /** Feature description */
  description: string;
}

/**
 * Feature flag definitions with their configurations
 */
export const FEATURE_FLAG_CONFIG: Record<FeatureFlag, FeatureFlagConfig> = {
  // Current features (Phase 0/1)
  enableChecklist: {
    defaultEnabled: false,
    userConfigurable: true,
    requiresAccount: false,
    requiresPremium: false,
    displayName: "Homework Checkboxes",
    description: "Add checkboxes to track assignment completion",
  },
  enableCustomAssignments: {
    defaultEnabled: false,
    userConfigurable: true,
    requiresAccount: false,
    requiresPremium: false,
    displayName: "Custom Assignments",
    description: "Create and track your own assignments",
  },
  // Future features (Phase 2+) - all enabled by default now
  enableCloudSync: {
    defaultEnabled: true,
    userConfigurable: true,
    requiresAccount: true,
    requiresPremium: false,
    displayName: "Cloud Sync",
    description: "Sync your data across devices",
  },
  enableAccounts: {
    defaultEnabled: true,
    userConfigurable: true,
    requiresAccount: false,
    requiresPremium: false,
    displayName: "User Accounts",
    description: "Create an account for cloud features",
  },
  enablePremium: {
    defaultEnabled: false,
    userConfigurable: false, // Not user-configurable until Phase 3
    requiresAccount: true,
    requiresPremium: false,
    displayName: "Premium Features",
    description: "Access premium features with subscription",
  },
};

/**
 * Local overrides for feature flags
 *
 * These override the default values for testing/development.
 */
type FeatureFlagOverrides = Partial<Record<FeatureFlag, boolean>>;

/**
 * Feature flags manager
 *
 * Centralized system for checking and managing feature availability.
 */
class FeatureFlagsManager {
  private overrides: FeatureFlagOverrides = {};
  private userSettings: Partial<Record<FeatureFlag, boolean>> = {};
  private initialized = false;

  /**
   * Initialize the feature flags manager
   *
   * Loads user settings and any stored overrides.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const storage = getStorageProvider();

    // Load user-configurable settings (legacy format compatibility)
    const legacySettings = await storage.getMany<Record<string, boolean>>([
      "enableChecklist",
      "enableCustomAssignments",

    ]);

    this.userSettings = legacySettings as Partial<Record<FeatureFlag, boolean>>;

    // Load any stored overrides (for development/testing)
    const storedOverrides = await storage.get<FeatureFlagOverrides>(
      STORAGE_KEYS.FEATURE_FLAGS
    );

    if (storedOverrides) {
      this.overrides = storedOverrides;
    }

    this.initialized = true;
  }

  /**
   * Check if a feature is enabled
   *
   * Evaluation order:
   * 1. Local overrides (highest priority)
   * 2. User settings (if user-configurable)
   * 3. Default value
   */
  isEnabled(flag: FeatureFlag): boolean {
    // Check overrides first
    if (this.overrides[flag] !== undefined) {
      return this.overrides[flag]!;
    }

    const config = FEATURE_FLAG_CONFIG[flag];

    // Check user settings for configurable features
    if (config.userConfigurable && this.userSettings[flag] !== undefined) {
      return this.userSettings[flag]!;
    }

    // Fall back to default
    return config.defaultEnabled;
  }

  /**
   * Check if a feature is available to the user
   *
   * A feature may be enabled but not available if it requires
   * an account or premium subscription.
   */
  isAvailable(flag: FeatureFlag): boolean {
    const config = FEATURE_FLAG_CONFIG[flag];

    // For now, all features are available if they don't require premium
    // Account requirements are handled by the UI/Sync flows
    if (config.requiresPremium) {
      return false;
    }

    return true;
  }

  /**
   * Check if a feature can be toggled by the user
   */
  isUserConfigurable(flag: FeatureFlag): boolean {
    return FEATURE_FLAG_CONFIG[flag].userConfigurable;
  }

  /**
   * Set a feature flag override
   *
   * Use for testing/development only.
   */
  async setOverride(flag: FeatureFlag, enabled: boolean): Promise<void> {
    this.overrides[flag] = enabled;

    const storage = getStorageProvider();
    await storage.set(STORAGE_KEYS.FEATURE_FLAGS, this.overrides);
  }

  /**
   * Clear a feature flag override
   */
  async clearOverride(flag: FeatureFlag): Promise<void> {
    delete this.overrides[flag];

    const storage = getStorageProvider();
    await storage.set(STORAGE_KEYS.FEATURE_FLAGS, this.overrides);
  }

  /**
   * Clear all overrides
   */
  async clearAllOverrides(): Promise<void> {
    this.overrides = {};

    const storage = getStorageProvider();
    await storage.remove(STORAGE_KEYS.FEATURE_FLAGS);
  }

  /**
   * Update user setting for a feature
   *
   * Only works for user-configurable features.
   */
  async setUserSetting(flag: FeatureFlag, enabled: boolean): Promise<void> {
    const config = FEATURE_FLAG_CONFIG[flag];

    if (!config.userConfigurable) {
      return;
    }

    this.userSettings[flag] = enabled;

    // Save to storage (legacy format for compatibility)
    const storage = getStorageProvider();
    await storage.set(flag, enabled);
  }

  /**
   * Get feature configuration
   */
  getConfig(flag: FeatureFlag): FeatureFlagConfig {
    return FEATURE_FLAG_CONFIG[flag];
  }

  /**
   * Get all user-configurable features
   */
  getUserConfigurableFeatures(): FeatureFlag[] {
    return (Object.keys(FEATURE_FLAG_CONFIG) as FeatureFlag[]).filter(
      (flag) => FEATURE_FLAG_CONFIG[flag].userConfigurable
    );
  }

  /**
   * Get current state of all flags
   */
  getAllFlags(): Record<FeatureFlag, boolean> {
    const flags = {} as Record<FeatureFlag, boolean>;

    for (const flag of Object.keys(FEATURE_FLAG_CONFIG) as FeatureFlag[]) {
      flags[flag] = this.isEnabled(flag);
    }

    return flags;
  }

  /**
   * Reload settings from storage
   */
  async reload(): Promise<void> {
    this.initialized = false;
    await this.initialize();
  }
}

/**
 * Singleton feature flags manager instance
 */
let featureFlagsInstance: FeatureFlagsManager | null = null;

/**
 * Get the feature flags manager instance
 */
export function getFeatureFlags(): FeatureFlagsManager {
  if (!featureFlagsInstance) {
    featureFlagsInstance = new FeatureFlagsManager();
  }
  return featureFlagsInstance;
}

/**
 * Initialize feature flags (call at extension startup)
 */
export async function initializeFeatureFlags(): Promise<void> {
  await getFeatureFlags().initialize();
}

/**
 * Quick check if a feature is enabled
 *
 * Note: Ensure initializeFeatureFlags() has been called first.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return getFeatureFlags().isEnabled(flag);
}

/**
 * Quick check if a feature is available
 */
export function isFeatureAvailable(flag: FeatureFlag): boolean {
  return getFeatureFlags().isAvailable(flag);
}

