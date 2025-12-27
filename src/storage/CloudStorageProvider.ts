/**
 * Veracross Plus — Cloud Storage Provider
 *
 * Implementation of StorageProvider that syncs with the backend API.
 * Uses local storage as a cache and syncs changes to/from the cloud.
 *
 * @version 1
 */

import type { StorageProvider } from "./StorageProvider";
import { STORAGE_KEYS } from "./StorageProvider";
import { getAuthToken } from "./AuthService";
import { LocalStorageProvider } from "./LocalStorageProvider";

const API_BASE_URL = "http://localhost:3000/api/v1";

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
        // Trigger background sync after write
        this.scheduleSync();
    }

    async setMany(items: Record<string, unknown>): Promise<void> {
        await this.localStorage.setMany(items);
        this.scheduleSync();
    }

    async remove(key: string): Promise<void> {
        await this.localStorage.remove(key);
        this.scheduleSync();
    }

    async removeMany(keys: string[]): Promise<void> {
        await this.localStorage.removeMany(keys);
        this.scheduleSync();
    }

    async clear(): Promise<void> {
        await this.localStorage.clear();
        this.scheduleSync();
    }

    async keys(): Promise<string[]> {
        return this.localStorage.keys();
    }

    async has(key: string): Promise<boolean> {
        return this.localStorage.has(key);
    }

    /**
     * Schedule a sync operation (debounced)
     */
    private syncTimeout: ReturnType<typeof setTimeout> | null = null;
    private scheduleSync(): void {
        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
        }
        this.syncTimeout = setTimeout(() => this.pushToCloud(), 2000);
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
            console.log("[Veracross Plus] Sync push successful:", result.written);
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

            console.log("[Veracross Plus] Pull received cloud data:", {
                hasPrefs: !!cloudData.preferences,
                assignmentsCount: Array.isArray(cloudData.assignments) ? cloudData.assignments.length : 0,
                completionsCount: cloudData.completions ? Object.keys(cloudData.completions).length : 0
            });

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

            // === MERGE ASSIGNMENTS (by ID - cloud wins on duplicates, local-only preserved) ===
            const localAssignments = await this.localStorage.get<Array<{ id: string }>>(STORAGE_KEYS.CUSTOM_ASSIGNMENTS) || [];
            const cloudAssignments = Array.isArray(cloudData.assignments) ? cloudData.assignments : [];

            // Create a map of all assignments by ID
            const assignmentMap = new Map<string, unknown>();

            // Add local assignments first
            for (const assignment of localAssignments) {
                if (assignment.id) {
                    assignmentMap.set(assignment.id, assignment);
                }
            }

            // Cloud assignments override duplicates
            for (const assignment of cloudAssignments) {
                if (assignment.id) {
                    assignmentMap.set(assignment.id, assignment);
                }
            }

            const mergedAssignments = Array.from(assignmentMap.values());
            await this.localStorage.set(STORAGE_KEYS.CUSTOM_ASSIGNMENTS, mergedAssignments);
            console.log("[Veracross Plus] Merged assignments:", { local: localAssignments.length, cloud: cloudAssignments.length, merged: mergedAssignments.length });

            // === MERGE COMPLETIONS (by key - cloud wins on duplicates, local-only preserved) ===
            const localCompletions = await this.localStorage.get<Record<string, number>>(STORAGE_KEYS.CHECKED_ASSIGNMENTS) || {};
            const cloudCompletions = (cloudData.completions || {}) as Record<string, number>;
            const mergedCompletions = { ...localCompletions, ...cloudCompletions };

            await this.localStorage.set(STORAGE_KEYS.CHECKED_ASSIGNMENTS, mergedCompletions);
            console.log("[Veracross Plus] Merged completions:", { local: Object.keys(localCompletions).length, cloud: Object.keys(cloudCompletions).length, merged: Object.keys(mergedCompletions).length });

            console.log("[Veracross Plus] Sync pull + merge successful");
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
