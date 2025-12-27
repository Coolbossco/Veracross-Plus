/**
 * Veracross Plus — Cloud Storage Provider
 *
 * Implementation of StorageProvider that syncs with the backend API.
 * Uses local storage as a cache and syncs changes to/from the cloud.
 *
 * @version 2 - Delegates sync to SyncManager
 */

import type { StorageProvider } from "./StorageProvider";
import { STORAGE_KEYS } from "./StorageProvider";
import { getAuthToken } from "./AuthService";
import { LocalStorageProvider } from "./LocalStorageProvider";

import { API_BASE_URL } from "../constants";

// Cached reference to SyncManager to avoid circular dependency issues
let cachedSyncManager: { markDirty: () => void } | null = null;

function getSyncManagerLazy(): { markDirty: () => void } | null {
    if (!cachedSyncManager) {
        // Try to get it from the global sync module
        // This is set by the sync module on initialization
        cachedSyncManager = (globalThis as any).__vcpSyncManager || null;
    }
    return cachedSyncManager;
}

// Called by SyncManager to register itself
export function registerSyncManager(manager: { markDirty: () => void }): void {
    cachedSyncManager = manager;
    (globalThis as any).__vcpSyncManager = manager;
}

/**
 * Cloud Storage Provider
 *
 * Wraps local storage and syncs with backend API when authenticated.
 */
export class CloudStorageProvider implements StorageProvider {
    private localStorage: LocalStorageProvider;
    private syncInProgress = false;

    constructor() {
        this.localStorage = new LocalStorageProvider();
    }

    // Delegate basic operations to local storage (acts as cache)
    async get<T>(key: string): Promise<T | undefined> {
        return this.localStorage.get<T>(key);
    }

    async getMany<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
        return this.localStorage.getMany<T>(keys);
    }

    async getWithDefault<T>(key: string, defaultValue: T): Promise<T> {
        return this.localStorage.getWithDefault(key, defaultValue);
    }

    async set<T>(key: string, value: T): Promise<void> {
        await this.localStorage.set(key, value);
        // Delegate sync scheduling to SyncManager
        this.notifySyncManager();
    }

    async setMany(items: Record<string, unknown>): Promise<void> {
        await this.localStorage.setMany(items);
        this.notifySyncManager();
    }

    async remove(key: string): Promise<void> {
        await this.localStorage.remove(key);
        this.notifySyncManager();
    }

    async removeMany(keys: string[]): Promise<void> {
        await this.localStorage.removeMany(keys);
        this.notifySyncManager();
    }

    async clear(): Promise<void> {
        await this.localStorage.clear();
        this.notifySyncManager();
    }

    async keys(): Promise<string[]> {
        return this.localStorage.keys();
    }

    async has(key: string): Promise<boolean> {
        return this.localStorage.has(key);
    }

    /**
     * Notify SyncManager that data changed
     * SyncManager handles debouncing and sync guards
     */
    private notifySyncManager(): void {
        try {
            const syncManager = getSyncManagerLazy();
            if (syncManager) {
                syncManager.markDirty();
            }
        } catch (error) {
            console.error("[CloudStorage] Could not notify SyncManager:", error);
        }
    }

    /**
     * Push local data to cloud
     * Returns the confirmation stats from the backend
     */
    async pushToCloud(): Promise<{ success: boolean; written?: { assignments: number; completions: number; preferences: number } }> {
        if (this.syncInProgress) return { success: false };

        const token = await getAuthToken();
        if (!token) return { success: false };

        this.syncInProgress = true;

        try {
            // Gather data to sync - both unified keys AND individual settings
            const preferences = await this.localStorage.get(STORAGE_KEYS.PREFERENCES);
            const assignments = await this.localStorage.get(STORAGE_KEYS.CUSTOM_ASSIGNMENTS);
            const completions = await this.localStorage.get(STORAGE_KEYS.CHECKED_ASSIGNMENTS);

            // Also gather individual settings that popup saves directly
            const individualSettings = await this.localStorage.getMany([
                "enableChecklist",
                "enableCustomAssignments",
                "enableEstimator",
                "enableHomeRedirect",
                "homeUrl"
            ]);

            // Merge individual settings into preferences object for sync
            const mergedPreferences = {
                ...(preferences || {}),
                ...individualSettings
            };

            const response = await fetch(`${API_BASE_URL}/sync/push`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    preferences: mergedPreferences,
                    assignments,
                    completions
                }),
            });

            if (!response.ok) {
                console.error("[Veracross Plus] Sync push failed:", await response.text());
                return { success: false };
            }

            const result = await response.json();
            return { success: true, written: result.written };
        } catch (error) {
            console.error("[Veracross Plus] Sync push error:", error);
            return { success: false };
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Pull data from cloud and MERGE into local (never overwrites, always combines)
     */
    async pullFromCloud(): Promise<boolean> {
        if (this.syncInProgress) return false;

        const token = await getAuthToken();
        if (!token) return false;

        this.syncInProgress = true;

        try {
            const response = await fetch(`${API_BASE_URL}/sync/pull`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!response.ok) {
                console.error("[Veracross Plus] Sync pull failed:", await response.text());
                return false;
            }

            const cloudData = await response.json();

            // === MERGE PREFERENCES (cloud properties override local, but local-only properties preserved) ===
            const localPrefs = await this.localStorage.get<Record<string, unknown>>(STORAGE_KEYS.PREFERENCES) || {};
            const cloudPrefs = (cloudData.preferences || {}) as Record<string, unknown>;
            const mergedPrefs = { ...localPrefs, ...cloudPrefs };

            if (Object.keys(mergedPrefs).length > 0) {
                await this.localStorage.set(STORAGE_KEYS.PREFERENCES, mergedPrefs);

                // Also set individual settings that popup reads directly
                if (mergedPrefs.enableChecklist !== undefined) {
                    await this.localStorage.set("enableChecklist", mergedPrefs.enableChecklist);
                }
                if (mergedPrefs.enableCustomAssignments !== undefined) {
                    await this.localStorage.set("enableCustomAssignments", mergedPrefs.enableCustomAssignments);
                }
                if (mergedPrefs.enableEstimator !== undefined) {
                    await this.localStorage.set("enableEstimator", mergedPrefs.enableEstimator);
                }
                if (mergedPrefs.enableHomeRedirect !== undefined) {
                    await this.localStorage.set("enableHomeRedirect", mergedPrefs.enableHomeRedirect);
                }
                if (mergedPrefs.homeUrl !== undefined) {
                    await this.localStorage.set("homeUrl", mergedPrefs.homeUrl);
                }
            }

            // === MERGE ASSIGNMENTS (Last-Write-Wins via updatedAt) ===
            const localAssignments = await this.localStorage.get<Array<any>>(STORAGE_KEYS.CUSTOM_ASSIGNMENTS) || [];
            const cloudAssignments = Array.isArray(cloudData.assignments) ? cloudData.assignments : [];

            // Map by ID
            const assignmentMap = new Map<string, any>();

            // 1. Load all local assignments
            for (const assignment of localAssignments) {
                if (assignment.id) {
                    assignmentMap.set(assignment.id, assignment);
                }
            }

            // 2. Merge cloud assignments
            for (const cloudAssignment of cloudAssignments) {
                if (!cloudAssignment.id) continue;

                const localAssignment = assignmentMap.get(cloudAssignment.id);

                if (!localAssignment) {
                    // New from cloud
                    assignmentMap.set(cloudAssignment.id, cloudAssignment);
                } else {
                    // Conflict: Compare timestamps
                    const localTime = new Date(localAssignment.updatedAt || 0).getTime();
                    const cloudTime = new Date(cloudAssignment.updatedAt || 0).getTime();

                    if (cloudTime >= localTime) {
                        // Cloud is newer or equal -> Cloud Wins
                        assignmentMap.set(cloudAssignment.id, cloudAssignment);
                    } else {
                        // Local is newer -> Local Wins (preserved)
                    }
                }
            }

            const mergedAssignments = Array.from(assignmentMap.values());
            await this.localStorage.set(STORAGE_KEYS.CUSTOM_ASSIGNMENTS, mergedAssignments);

            // === MERGE COMPLETIONS (by key - cloud wins on duplicates, local-only preserved) ===
            const localCompletions = await this.localStorage.get<Record<string, number>>(STORAGE_KEYS.CHECKED_ASSIGNMENTS) || {};
            const cloudCompletions = (cloudData.completions || {}) as Record<string, number>;
            const mergedCompletions = { ...localCompletions, ...cloudCompletions };

            await this.localStorage.set(STORAGE_KEYS.CHECKED_ASSIGNMENTS, mergedCompletions);

            return true;
        } catch (error) {
            console.error("[Veracross Plus] Sync pull error:", error);
            return false;
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Full sync: pull then push
     */
    async fullSync(): Promise<boolean> {
        const pullSuccess = await this.pullFromCloud();
        if (!pullSuccess) return false;
        const pushResult = await this.pushToCloud();
        return pushResult.success;
    }
}

// Singleton
let cloudStorageInstance: CloudStorageProvider | null = null;

export function getCloudStorageProvider(): CloudStorageProvider {
    if (!cloudStorageInstance) {
        cloudStorageInstance = new CloudStorageProvider();
    }
    return cloudStorageInstance;
}
