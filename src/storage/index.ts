/**
 * Veracross Plus — Storage Module
 *
 * Central export for storage abstraction layer.
 * Provides a clean API for all storage operations.
 */

// Storage provider interface and types
export {
  type StorageProvider,
  type ObservableStorageProvider,
  type StorageChangeCallback,
  type StorageProviderFactory,
  STORAGE_KEYS,
} from "./StorageProvider";

// Local storage implementation
export {
  LocalStorageProvider,
  getStorageProvider,
  createStorageProvider,
} from "./LocalStorageProvider";

// Re-export a convenience function for quick storage access
import { getStorageProvider } from "./LocalStorageProvider";
import { STORAGE_KEYS } from "./StorageProvider";

/**
 * Quick storage access utilities
 *
 * These provide backwards-compatible functions that mirror
 * the original getStorage/setStorage API.
 */

/**
 * Get a value from storage (backwards compatible)
 */
export async function getStorage<T>(key: string): Promise<T | undefined> {
  return getStorageProvider().get<T>(key);
}

/**
 * Set value(s) in storage (backwards compatible)
 */
export async function setStorage(items: Record<string, unknown>): Promise<void> {
  return getStorageProvider().setMany(items);
}

/**
 * Load user settings with defaults (backwards compatible)
 */
export async function loadSettings<T extends Record<string, unknown>>(
  defaults: T
): Promise<T> {
  const keys = Object.keys(defaults);
  const stored = await getStorageProvider().getMany<T>(keys);

  return {
    ...defaults,
    ...stored,
  };
}

/**
 * Save user settings (backwards compatible)
 */
export async function saveSettings(
  changes: Record<string, unknown>
): Promise<void> {
  return getStorageProvider().setMany(changes);
}

