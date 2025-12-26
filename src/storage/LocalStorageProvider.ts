/**
 * Veracross Plus — Local Storage Provider
 *
 * Implementation of StorageProvider using chrome.storage.sync.
 * This is the default storage backend for the extension.
 *
 * Uses chrome.storage.sync for:
 * - Automatic sync across Chrome instances (if user is signed in)
 * - Persistence across browser sessions
 * - Structured data support (JSON serialization handled automatically)
 *
 * @version 1
 */

import type {
  StorageProvider,
  ObservableStorageProvider,
  StorageChangeCallback,
} from "./StorageProvider";

/**
 * Chrome Storage Sync Provider
 *
 * Wraps chrome.storage.sync with a clean async interface.
 */
export class LocalStorageProvider implements ObservableStorageProvider {
  private listeners: Set<StorageChangeCallback> = new Set();
  private storageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | null = null;

  constructor() {
    this.setupChangeListener();
  }

  /**
   * Set up the chrome.storage change listener
   */
  private setupChangeListener(): void {
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      this.storageListener = (changes, areaName) => {
        if (areaName === "sync") {
          const normalizedChanges: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};

          for (const [key, change] of Object.entries(changes)) {
            normalizedChanges[key] = {
              oldValue: change.oldValue,
              newValue: change.newValue,
            };
          }

          this.notifyListeners(normalizedChanges);
        }
      };

      chrome.storage.onChanged.addListener(this.storageListener);
    }
  }

  /**
   * Notify all registered listeners of storage changes
   */
  private notifyListeners(
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
  ): void {
    for (const callback of this.listeners) {
      try {
        callback(changes);
      } catch (error) {
        console.error("[Veracross Plus] Storage change listener error:", error);
      }
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.sync) {
        resolve(undefined);
        return;
      }

      chrome.storage.sync.get(key, (result) => {
        resolve(result[key] as T | undefined);
      });
    });
  }

  async getMany<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.sync) {
        resolve({});
        return;
      }

      chrome.storage.sync.get(keys, (result) => {
        resolve(result as Partial<T>);
      });
    });
  }

  async getWithDefault<T>(key: string, defaultValue: T): Promise<T> {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.sync) {
        resolve(defaultValue);
        return;
      }

      chrome.storage.sync.get({ [key]: defaultValue }, (result) => {
        resolve(result[key] as T);
      });
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.sync) {
        resolve();
        return;
      }

      chrome.storage.sync.set({ [key]: value }, () => {
        resolve();
      });
    });
  }

  async setMany(items: Record<string, unknown>): Promise<void> {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.sync) {
        resolve();
        return;
      }

      chrome.storage.sync.set(items, () => {
        resolve();
      });
    });
  }

  async remove(key: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.sync) {
        resolve();
        return;
      }

      chrome.storage.sync.remove(key, () => {
        resolve();
      });
    });
  }

  async removeMany(keys: string[]): Promise<void> {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.sync) {
        resolve();
        return;
      }

      chrome.storage.sync.remove(keys, () => {
        resolve();
      });
    });
  }

  async clear(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.sync) {
        resolve();
        return;
      }

      chrome.storage.sync.clear(() => {
        resolve();
      });
    });
  }

  async keys(): Promise<string[]> {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.sync) {
        resolve([]);
        return;
      }

      chrome.storage.sync.get(null, (result) => {
        resolve(Object.keys(result));
      });
    });
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== undefined;
  }

  onChange(callback: StorageChangeCallback): () => void {
    this.listeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Cleanup method to remove chrome storage listener
   *
   * Should be called when the provider is no longer needed.
   */
  destroy(): void {
    if (this.storageListener && typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(this.storageListener);
      this.storageListener = null;
    }
    this.listeners.clear();
  }
}

/**
 * Singleton instance of the local storage provider
 *
 * Use this for consistent storage access across the extension.
 */
let storageInstance: LocalStorageProvider | null = null;

/**
 * Get the singleton storage provider instance
 */
export function getStorageProvider(): LocalStorageProvider {
  if (!storageInstance) {
    storageInstance = new LocalStorageProvider();
  }
  return storageInstance;
}

/**
 * Create a new storage provider instance
 *
 * Use this when you need an isolated provider (e.g., for testing).
 */
export function createStorageProvider(): StorageProvider {
  return new LocalStorageProvider();
}

