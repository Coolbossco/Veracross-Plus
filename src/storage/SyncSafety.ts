/**
 * Veracross Plus — Sync Safety Module
 *
 * Handles first-time sync confirmation and local data backup
 * to prevent accidental data loss during initial cloud sync.
 *
 * @version 1
 */

import { LocalStorageProvider } from "./LocalStorageProvider";
import { STORAGE_KEYS } from "./StorageProvider";

const SYNC_SAFETY_KEYS = {
    HAS_SYNCED_BEFORE: "vcp_has_synced_before",
    LOCAL_BACKUP: "vcp_local_backup",
    BACKUP_TIMESTAMP: "vcp_backup_timestamp",
} as const;

/**
 * Check if user has synced before
 */
export async function hasSyncedBefore(): Promise<boolean> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve(false);
            return;
        }
        chrome.storage.local.get(SYNC_SAFETY_KEYS.HAS_SYNCED_BEFORE, (result) => {
            resolve(result[SYNC_SAFETY_KEYS.HAS_SYNCED_BEFORE] === true);
        });
    });
}

/**
 * Mark that initial sync has been completed
 */
export async function markSyncedBefore(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve();
            return;
        }
        chrome.storage.local.set({ [SYNC_SAFETY_KEYS.HAS_SYNCED_BEFORE]: true }, resolve);
    });
}

/**
 * Create a backup of local data before first sync
 */
export async function backupLocalData(): Promise<void> {
    const localStorage = new LocalStorageProvider();

    const preferences = await localStorage.get(STORAGE_KEYS.PREFERENCES);
    const assignments = await localStorage.get(STORAGE_KEYS.CUSTOM_ASSIGNMENTS);
    const completions = await localStorage.get(STORAGE_KEYS.CHECKED_ASSIGNMENTS);

    const backup = {
        preferences,
        assignments,
        completions,
        timestamp: new Date().toISOString(),
    };

    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve();
            return;
        }
        chrome.storage.local.set(
            {
                [SYNC_SAFETY_KEYS.LOCAL_BACKUP]: backup,
                [SYNC_SAFETY_KEYS.BACKUP_TIMESTAMP]: backup.timestamp,
            },
            resolve
        );
    });
}

/**
 * Restore from local backup
 */
export async function restoreFromBackup(): Promise<boolean> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve(false);
            return;
        }

        chrome.storage.local.get(SYNC_SAFETY_KEYS.LOCAL_BACKUP, async (result) => {
            const backup = result[SYNC_SAFETY_KEYS.LOCAL_BACKUP] as {
                preferences?: unknown;
                assignments?: unknown;
                completions?: unknown;
            } | undefined;

            if (!backup) {
                resolve(false);
                return;
            }

            const localStorage = new LocalStorageProvider();

            if (backup.preferences) {
                await localStorage.set(STORAGE_KEYS.PREFERENCES, backup.preferences);
            }
            if (backup.assignments) {
                await localStorage.set(STORAGE_KEYS.CUSTOM_ASSIGNMENTS, backup.assignments);
            }
            if (backup.completions) {
                await localStorage.set(STORAGE_KEYS.CHECKED_ASSIGNMENTS, backup.completions);
            }

            resolve(true);
        });
    });
}

/**
 * Get backup timestamp
 */
export async function getBackupTimestamp(): Promise<string | null> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve(null);
            return;
        }
        chrome.storage.local.get(SYNC_SAFETY_KEYS.BACKUP_TIMESTAMP, (result) => {
            resolve((result[SYNC_SAFETY_KEYS.BACKUP_TIMESTAMP] as string) || null);
        });
    });
}

/**
 * Perform safe first-time sync with backup
 */
export async function performSafeFirstSync(
    syncFunction: () => Promise<boolean>
): Promise<{ success: boolean; backedUp: boolean }> {
    const alreadySynced = await hasSyncedBefore();

    if (!alreadySynced) {
        // First time syncing - create backup
        await backupLocalData();
    }

    const success = await syncFunction();

    if (success && !alreadySynced) {
        await markSyncedBefore();
    }

    return { success, backedUp: !alreadySynced };
}
