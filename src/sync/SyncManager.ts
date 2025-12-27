/**
 * Veracross Plus — Sync Manager
 *
 * The central orchestrator for all sync activities.
 * Implements safety rules, backup creation, retry logic,
 * dirty flag serialization, and automatic sync guards.
 *
 * @version 2 - Added automatic sync support
 */

import { getBackupManager } from "./BackupManager";
import { getCloudStorageProvider, registerSyncManager } from "../storage/CloudStorageProvider";
import { API_BASE_URL } from "../constants";
import { STORAGE_KEYS } from "../storage/StorageProvider";
import { getStorageProvider } from "../storage/LocalStorageProvider";
import { getAuthToken, isLoggedIn } from "../storage/AuthService";
import { trackSyncStarted, trackSyncSuccess, trackSyncFailed, trackSyncRetry, trackBackupCreated } from "./TelemetryService";

export type SyncState = "idle" | "checking" | "pushing" | "pulling" | "success" | "error" | "conflict" | "retrying" | "offline";

export type SyncErrorClass = "network" | "auth" | "validation" | "server" | "conflict" | "unknown";

export interface SyncStats {
    assignments?: number;
    completions?: number;
    preferences?: number;
}

export interface SyncError {
    class: SyncErrorClass;
    message: string;
    retriable: boolean;
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const AUTO_SYNC_DEBOUNCE_MS = 2000;
const FIRST_SYNC_COMPLETE_KEY = "vcp_first_sync_complete";

export class SyncManager {
    private state: SyncState = "idle";
    private lastError: SyncError | null = null;
    private listeners: Set<(state: SyncState, error?: SyncError | null) => void> = new Set();
    private retryCount = 0;

    // Serialization & Dirty Flag
    private isDirty = false;
    private syncPromise: Promise<boolean> | null = null;
    private autoSyncTimeout: ReturnType<typeof setTimeout> | null = null;

    // Offline tracking
    private isOffline = false;

    constructor() {
        // Register this instance with CloudStorageProvider for notifications
        registerSyncManager(this);

        // Check initial online state
        if (typeof navigator !== "undefined") {
            this.isOffline = !navigator.onLine;
            if (this.isOffline) {
                this.setState("offline");
            }
        }
    }

    /**
     * Mark data as dirty - triggers debounced auto-sync if enabled
     */
    markDirty(): void {
        this.isDirty = true;
        this.scheduleAutoSync();
    }

    /**
     * Schedule a debounced auto-sync
     */
    private scheduleAutoSync(): void {
        if (this.autoSyncTimeout) {
            clearTimeout(this.autoSyncTimeout);
        }

        this.autoSyncTimeout = setTimeout(async () => {
            this.autoSyncTimeout = null;
            if (await this.isAutoSyncEnabled()) {
                await this.sync();
            }
        }, AUTO_SYNC_DEBOUNCE_MS);
    }

    /**
     * Check if automatic sync is allowed
     */
    async isAutoSyncEnabled(): Promise<boolean> {
        // Guard 1: Must be online
        if (this.isOffline) {
            return false;
        }

        // Guard 2: Must be authenticated
        const authenticated = await isLoggedIn();
        if (!authenticated) {
            return false;
        }

        // Guard 3: Must have completed first sync successfully
        const firstSyncComplete = await this.isFirstSyncComplete();
        if (!firstSyncComplete) {
            return false;
        }

        // Guard 4: Not in persistent error state (non-retriable)
        if (this.lastError && !this.lastError.retriable) {
            return false;
        }

        return true;
    }

    /**
     * Check if first sync has been completed
     */
    private async isFirstSyncComplete(): Promise<boolean> {
        const storage = getStorageProvider();
        const complete = await storage.get<boolean>(FIRST_SYNC_COMPLETE_KEY);
        return complete === true;
    }

    /**
     * Mark first sync as complete
     */
    private async setFirstSyncComplete(): Promise<void> {
        const storage = getStorageProvider();
        await storage.set(FIRST_SYNC_COMPLETE_KEY, true);
    }

    /**
     * Handle online/offline status changes
     */
    setOnlineStatus(online: boolean): void {
        const wasOffline = this.isOffline;
        this.isOffline = !online;

        if (this.isOffline) {
            this.setState("offline");
        } else if (wasOffline && online) {
            this.setState("idle");
            // If we have pending changes, sync now
            if (this.isDirty) {
                this.scheduleAutoSync();
            }
        }
    }

    /**
     * Main sync orchestration entry point
     * Serialized: only one sync at a time, dirty flag for re-run
     */
    async sync(): Promise<boolean> {
        // If already syncing, mark dirty and return the existing promise
        if (this.syncPromise) {
            this.isDirty = true;
            return this.syncPromise;
        }

        // Check if offline
        if (this.isOffline) {
            this.isDirty = true; // Queue for later
            return false;
        }

        // Clear dirty flag at start
        this.isDirty = false;
        this.retryCount = 0;

        // Create and track the sync promise
        this.syncPromise = this.attemptSync();

        try {
            const result = await this.syncPromise;
            return result;
        } finally {
            this.syncPromise = null;

            // If dirty flag was set during sync, trigger another sync
            if (this.isDirty) {
                // Small delay to prevent tight loops
                setTimeout(() => this.sync(), 500);
            }
        }
    }

    /**
     * Attempt sync with retry logic
     */
    private async attemptSync(): Promise<boolean> {
        this.setState("checking");
        trackSyncStarted();

        try {
            // 1. Check Auth
            const token = await getAuthToken();
            if (!token) {
                this.setError({ class: "auth", message: "User not authenticated", retriable: false });
                return false;
            }

            // 2. Create Backup (Rule 1 & 5)
            const backupManager = getBackupManager();
            await backupManager.createSnapshot();
            trackBackupCreated();

            // 3. Handshake (Rule 2)
            const { localHasData, cloudHasData } = await this.performHandshake();

            if (localHasData && !cloudHasData) {
                // First sync push path
                const success = await this.push();
                if (success) {
                    await this.setFirstSyncComplete();
                }
                return success;
            }

            // 4. Regular Sync (Pull then Push)
            this.setState("pulling");
            const cloudProvider = getCloudStorageProvider();
            const pullSuccess = await cloudProvider.pullFromCloud();

            if (!pullSuccess) {
                return this.handleFailure({ class: "network", message: "Sync pull failed", retriable: true });
            }

            const success = await this.push();
            if (success) {
                await this.setFirstSyncComplete();
            }
            return success;
        } catch (error) {
            console.error("[SyncManager] Unexpected sync error:", error);
            const errorClass = this.classifyError(error);
            return this.handleFailure(errorClass);
        }
    }

    private async push(): Promise<boolean> {
        this.setState("pushing");
        const cloudProvider = getCloudStorageProvider();

        try {
            const result = await cloudProvider.pushToCloud();

            if (result.success && result.written) {
                trackSyncSuccess();
                this.setState("success");
                this.lastError = null;
                // Reset to idle after a short delay
                setTimeout(() => this.setState("idle"), 3000);
                return true;
            } else {
                return this.handleFailure({ class: "server", message: "Sync push failed or write not confirmed", retriable: true });
            }
        } catch (error) {
            const errorClass = this.classifyError(error);
            return this.handleFailure(errorClass);
        }
    }

    /**
     * Handle sync failure with retry logic
     */
    private async handleFailure(error: SyncError): Promise<boolean> {
        if (error.retriable && this.retryCount < MAX_RETRIES) {
            this.retryCount++;
            const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, this.retryCount - 1);
            trackSyncRetry(this.retryCount);

            this.setState("retrying");
            await this.delay(backoffMs);
            return this.attemptSync();
        }

        trackSyncFailed(error.class);
        this.setError(error);
        return false;
    }

    /**
     * Classify an error into a sync error class
     */
    private classifyError(error: unknown): SyncError {
        if (error instanceof TypeError && error.message.includes("fetch")) {
            return { class: "network", message: "Network error", retriable: true };
        }

        if (error instanceof Error) {
            if (error.message.includes("401") || error.message.includes("unauthorized")) {
                return { class: "auth", message: "Authentication expired", retriable: false };
            }
            if (error.message.includes("400") || error.message.includes("validation")) {
                return { class: "validation", message: "Invalid data", retriable: false };
            }
            if (error.message.includes("500") || error.message.includes("server")) {
                return { class: "server", message: "Server error", retriable: true };
            }
            if (error.message.includes("conflict")) {
                return { class: "conflict", message: "Data conflict detected", retriable: false };
            }
        }

        return { class: "unknown", message: error instanceof Error ? error.message : "Unknown error", retriable: false };
    }

    private async performHandshake(): Promise<{ localHasData: boolean; cloudHasData: boolean }> {
        const localStorage = getStorageProvider();

        // Check both the unified STORAGE_KEYS and individual setting keys that popup uses
        const unifiedKeys = [
            STORAGE_KEYS.PREFERENCES,
            STORAGE_KEYS.CUSTOM_ASSIGNMENTS,
            STORAGE_KEYS.CHECKED_ASSIGNMENTS
        ];

        // Also check individual settings that popup saves directly
        const individualSettingKeys = [
            "enableChecklist",
            "enableCustomAssignments",
            "enableEstimator",
            "enableHomeRedirect"
        ];

        const allKeys = [...unifiedKeys, ...individualSettingKeys];
        const localData = await localStorage.getMany(allKeys);

        // Check if any meaningful data exists
        const localHasData = Object.entries(localData).some(([key, val]) => {
            if (val === undefined || val === null) return false;
            // For boolean settings, true counts as data
            if (typeof val === "boolean") return val === true;
            // For arrays, non-empty counts as data
            if (Array.isArray(val)) return val.length > 0;
            // For objects, non-empty counts as data
            if (typeof val === "object") return Object.keys(val).length > 0;
            // For strings, non-empty counts as data
            if (typeof val === "string") return val.length > 0;
            return true;
        });

        // To check if cloud has data, we'll try to pull metadata or check with a lightweight call
        const token = await getAuthToken();

        try {
            const response = await fetch(`${API_BASE_URL}/sync/pull`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!response.ok) return { localHasData, cloudHasData: false };

            const cloudData = await response.json();
            const cloudHasData = Object.values(cloudData).some(val =>
                val !== undefined && (Array.isArray(val) ? val.length > 0 : true)
            );

            return { localHasData, cloudHasData };
        } catch (error) {
            console.error("[SyncManager] Handshake failed:", error);
            return { localHasData, cloudHasData: false };
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private setState(state: SyncState): void {
        this.state = state;
        this.notifyListeners();
    }

    private setError(error: SyncError): void {
        this.state = "error";
        this.lastError = error;
        this.notifyListeners();
    }

    getState(): { state: SyncState; error: SyncError | null; isOffline: boolean } {
        return { state: this.state, error: this.lastError, isOffline: this.isOffline };
    }

    onStateChange(callback: (state: SyncState, error?: SyncError | null) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    private notifyListeners(): void {
        for (const listener of this.listeners) {
            listener(this.state, this.lastError);
        }
    }

    /**
     * Get available backups for manual restore
     */
    async getBackups() {
        const backupManager = getBackupManager();
        return backupManager.getSnapshots();
    }

    /**
     * Restore from a specific backup
     */
    async restoreFromBackup(snapshotId: string): Promise<boolean> {
        const backupManager = getBackupManager();
        return backupManager.restoreFromSnapshot(snapshotId);
    }

    /**
     * Clear error state and allow retry
     */
    clearError(): void {
        if (this.state === "error") {
            this.lastError = null;
            this.setState("idle");
        }
    }
}

let instance: SyncManager | null = null;

export function getSyncManager(): SyncManager {
    if (!instance) {
        instance = new SyncManager();
    }
    return instance;
}
