/**
 * Veracross Plus — Sync Manager
 *
 * The central orchestrator for all sync activities.
 * Implements safety rules, backup creation, and retry logic.
 *
 * @version 1
 */

import { getBackupManager } from "./BackupManager";
import { getCloudStorageProvider } from "../storage/CloudStorageProvider";
import { STORAGE_KEYS } from "../storage/StorageProvider";
import { getStorageProvider } from "../storage/LocalStorageProvider";
import { getAuthToken } from "../storage/AuthService";
import { trackSyncStarted, trackSyncSuccess, trackSyncFailed, trackSyncRetry, trackBackupCreated } from "./TelemetryService";

export type SyncState = "idle" | "checking" | "pushing" | "pulling" | "success" | "error" | "conflict" | "retrying";

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

export class SyncManager {
    private state: SyncState = "idle";
    private lastError: SyncError | null = null;
    private listeners: Set<(state: SyncState, error?: SyncError | null) => void> = new Set();
    private retryCount = 0;

    /**
     * Main sync orchestration entry point
     */
    async sync(): Promise<boolean> {
        if (this.state !== "idle" && this.state !== "error") {
            console.warn("[SyncManager] Sync already in progress, skipping");
            return false;
        }

        this.retryCount = 0;
        return this.attemptSync();
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
            console.log("[SyncManager] Snapshot created before sync");

            // 3. Handshake (Rule 2)
            const { localHasData, cloudHasData } = await this.performHandshake();

            if (localHasData && !cloudHasData) {
                // First sync push path
                console.log("[SyncManager] First sync: Local data exists, cloud empty. Pushing...");
                return await this.push();
            }

            // 4. Regular Sync (Pull then Push)
            this.setState("pulling");
            const cloudProvider = getCloudStorageProvider();
            const pullSuccess = await cloudProvider.pullFromCloud();

            if (!pullSuccess) {
                return this.handleFailure({ class: "network", message: "Sync pull failed", retriable: true });
            }

            return await this.push();
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
                console.log("[SyncManager] Cloud write confirmed:", result.written);
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
            console.log(`[SyncManager] Retry ${this.retryCount}/${MAX_RETRIES} in ${backoffMs}ms`);
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

        console.log("[SyncManager] Handshake - localHasData:", localHasData, "localData:", localData);

        // To check if cloud has data, we'll try to pull metadata or check with a lightweight call
        const token = await getAuthToken();
        const API_BASE_URL = "http://localhost:3000/api/v1";

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

    getState(): { state: SyncState; error: SyncError | null } {
        return { state: this.state, error: this.lastError };
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
}

let instance: SyncManager | null = null;

export function getSyncManager(): SyncManager {
    if (!instance) {
        instance = new SyncManager();
    }
    return instance;
}
