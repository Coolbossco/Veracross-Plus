/**
 * Veracross Plus — Storage Provider Interface
 *
 * Abstracts storage operations to decouple feature logic from
 * browser-specific storage APIs. This enables:
 *
 * 1. Easy testing with mock implementations
 * 2. Future cloud sync without changing feature code
 * 3. Potential migration between storage backends
 *
 * @version 1
 */

/**
 * Storage provider interface
 *
 * All storage operations are async to support both sync and async
 * storage backends (chrome.storage, IndexedDB, cloud APIs, etc.)
 */
export interface StorageProvider {
  /**
   * Get a value from storage
   *
   * @param key - Storage key
   * @returns The stored value, or undefined if not found
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Get multiple values from storage
   *
   * @param keys - Array of storage keys
   * @returns Object mapping keys to their values
   */
  getMany<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>>;

  /**
   * Get a value with a default fallback
   *
   * @param key - Storage key
   * @param defaultValue - Value to return if key doesn't exist
   * @returns The stored value or the default
   */
  getWithDefault<T>(key: string, defaultValue: T): Promise<T>;

  /**
   * Set a value in storage
   *
   * @param key - Storage key
   * @param value - Value to store
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Set multiple values in storage
   *
   * @param items - Object mapping keys to values
   */
  setMany(items: Record<string, unknown>): Promise<void>;

  /**
   * Remove a value from storage
   *
   * @param key - Storage key to remove
   */
  remove(key: string): Promise<void>;

  /**
   * Remove multiple values from storage
   *
   * @param keys - Array of storage keys to remove
   */
  removeMany(keys: string[]): Promise<void>;

  /**
   * Clear all extension storage
   *
   * ⚠️ Use with caution — this removes all user data
   */
  clear(): Promise<void>;

  /**
   * Get all keys in storage
   *
   * @returns Array of all storage keys
   */
  keys(): Promise<string[]>;

  /**
   * Check if a key exists in storage
   *
   * @param key - Storage key to check
   * @returns true if key exists
   */
  has(key: string): Promise<boolean>;
}

/**
 * Storage change listener callback
 */
export type StorageChangeCallback = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
) => void;

/**
 * Extended storage provider with change observation
 */
export interface ObservableStorageProvider extends StorageProvider {
  /**
   * Subscribe to storage changes
   *
   * @param callback - Function called when storage changes
   * @returns Unsubscribe function
   */
  onChange(callback: StorageChangeCallback): () => void;
}

/**
 * Storage provider factory type
 *
 * Used to create storage providers with specific configurations.
 */
export type StorageProviderFactory = () => StorageProvider;

/**
 * Well-known storage keys used by Veracross Plus
 *
 * Centralized key definitions prevent typos and enable
 * easy refactoring of storage key names.
 */
export const STORAGE_KEYS = {
  /** User preferences/settings */
  PREFERENCES: "vcp_preferences",

  /** Custom assignments array */
  CUSTOM_ASSIGNMENTS: "customAssignments",

  /** Checked/completed assignments map */
  CHECKED_ASSIGNMENTS: "vc_checked_assignments",

  /** Data schema version for migrations */
  DATA_VERSION: "vcp_data_version",

  /** Feature flags (local overrides) */
  FEATURE_FLAGS: "vcp_feature_flags",

  /** Whether the user has completed the first-run onboarding */
  ONBOARDING_COMPLETE: "vcp_onboarding_complete",

  // Legacy keys (for migration compatibility)
  LEGACY: {
    ENABLE_CHECKLIST: "enableChecklist",
    ENABLE_CUSTOM_ASSIGNMENTS: "enableCustomAssignments",
  },
} as const;

