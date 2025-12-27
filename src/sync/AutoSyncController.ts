/**
 * Veracross Plus — Auto Sync Controller
 *
 * Handles event-driven sync triggers:
 * - Online/offline detection
 * - Tab visibility changes
 * - Cross-tab storage events
 *
 * @version 1
 */

import { getSyncManager } from "./SyncManager";

class AutoSyncController {
    private initialized = false;

    /**
     * Initialize the auto-sync controller
     * Should be called once when the extension loads
     */
    initialize(): void {
        if (this.initialized) {
            return;
        }

        this.initialized = true;

        // Online/Offline detection
        if (typeof window !== "undefined") {
            window.addEventListener("online", () => this.handleOnline());
            window.addEventListener("offline", () => this.handleOffline());

            // Initial state
            getSyncManager().setOnlineStatus(navigator.onLine);
        }

        // Tab visibility change (sync when tab regains focus)
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", () => this.handleVisibilityChange());
        }

        // Cross-tab storage changes (sync when another tab makes changes)
        if (typeof window !== "undefined" && chrome?.storage?.onChanged) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
                this.handleStorageChange(changes, areaName);
            });
        }

        // Setup periodic background sync (every 5 minutes)
        this.setupPeriodicSync();
    }

    private setupPeriodicSync(): void {
        const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

        setInterval(async () => {
            const syncManager = getSyncManager();
            if (await syncManager.isAutoSyncEnabled()) {
                // Use markDirty() to debounce with any other pending actions
                syncManager.markDirty();
            }
        }, INTERVAL_MS);
    }

    /**
     * Handle coming online
     */
    private handleOnline(): void {
        getSyncManager().setOnlineStatus(true);
    }

    /**
     * Handle going offline
     */
    private handleOffline(): void {
        getSyncManager().setOnlineStatus(false);
    }

    /**
     * Handle tab visibility changes
     * Sync when tab becomes visible again after being hidden
     */
    private async handleVisibilityChange(): Promise<void> {
        if (document.visibilityState === "visible") {
            const syncManager = getSyncManager();
            if (await syncManager.isAutoSyncEnabled()) {
                // Don't sync immediately on every tab switch
                // Only sync if there's dirty data or enough time has passed
                const state = syncManager.getState();
                if (state.state === "idle") {
                    // Light pull to check for remote changes
                    syncManager.markDirty();
                }
            }
        }
    }

    /**
     * Handle storage changes from other tabs/windows
     */
    private handleStorageChange(
        changes: { [key: string]: chrome.storage.StorageChange },
        areaName: string
    ): void {
        // Only care about local storage changes
        if (areaName !== "local") return;

        // Ignore internal sync-related keys
        const ignoredPrefixes = ["vcp_sync_", "vcp_auth_", "vcp_telemetry", "vcp_first_sync"];
        const relevantChanges = Object.keys(changes).filter(key =>
            !ignoredPrefixes.some(prefix => key.startsWith(prefix))
        );

        if (relevantChanges.length > 0) {
            // Data changed externally, mark as dirty to sync
            getSyncManager().markDirty();
        }
    }

    /**
     * Check if the controller is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }
}

let instance: AutoSyncController | null = null;

export function getAutoSyncController(): AutoSyncController {
    if (!instance) {
        instance = new AutoSyncController();
    }
    return instance;
}

/**
 * Convenience function to initialize auto-sync
 * Call this once during extension startup
 */
export function initializeAutoSync(): void {
    getAutoSyncController().initialize();
}
