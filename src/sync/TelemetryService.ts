/**
 * Veracross Plus — Telemetry Service
 *
 * Privacy-safe telemetry for sync diagnostics.
 * Only sends anonymized event types, never content.
 *
 * @version 1
 */

export type TelemetryEvent =
    | "sync_started"
    | "sync_success"
    | "sync_failed"
    | "sync_retry"
    | "conflict_detected"
    | "backup_created"
    | "backup_restored";

export interface TelemetryPayload {
    event: TelemetryEvent;
    errorClass?: string;
    retryCount?: number;
    timestamp: string;
}

const TELEMETRY_STORAGE_KEY = "vcp_telemetry_enabled";
const API_BASE_URL = "http://localhost:3000/api/v1";

class TelemetryService {
    private enabled = true;
    private queue: TelemetryPayload[] = [];
    private flushTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.loadSettings();
    }

    private async loadSettings(): Promise<void> {
        if (typeof chrome === "undefined" || !chrome.storage?.local) return;

        return new Promise((resolve) => {
            chrome.storage.local.get(TELEMETRY_STORAGE_KEY, (result) => {
                this.enabled = result[TELEMETRY_STORAGE_KEY] !== false;
                resolve();
            });
        });
    }

    /**
     * Enable or disable telemetry (kill switch)
     */
    async setEnabled(enabled: boolean): Promise<void> {
        this.enabled = enabled;
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            await new Promise<void>((resolve) => {
                chrome.storage.local.set({ [TELEMETRY_STORAGE_KEY]: enabled }, resolve);
            });
        }
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Track a telemetry event
     */
    track(event: TelemetryEvent, extra?: { errorClass?: string; retryCount?: number }): void {
        if (!this.enabled) return;

        const payload: TelemetryPayload = {
            event,
            timestamp: new Date().toISOString(),
            ...extra
        };

        this.queue.push(payload);
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.flushTimeout) return;

        // Batch events and send after 5 seconds
        this.flushTimeout = setTimeout(() => this.flush(), 5000);
    }

    private async flush(): Promise<void> {
        if (this.queue.length === 0) return;

        const events = [...this.queue];
        this.queue = [];
        this.flushTimeout = null;

        try {
            await fetch(`${API_BASE_URL}/telemetry`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ events })
            });
        } catch (error) {
            // Silently fail - telemetry should never break the app
            console.debug("[Telemetry] Failed to send events:", error);
        }
    }
}

let instance: TelemetryService | null = null;

export function getTelemetryService(): TelemetryService {
    if (!instance) {
        instance = new TelemetryService();
    }
    return instance;
}

// Convenience functions
export function trackSyncStarted(): void {
    getTelemetryService().track("sync_started");
}

export function trackSyncSuccess(): void {
    getTelemetryService().track("sync_success");
}

export function trackSyncFailed(errorClass: string): void {
    getTelemetryService().track("sync_failed", { errorClass });
}

export function trackSyncRetry(retryCount: number): void {
    getTelemetryService().track("sync_retry", { retryCount });
}

export function trackBackupCreated(): void {
    getTelemetryService().track("backup_created");
}

export function trackBackupRestored(): void {
    getTelemetryService().track("backup_restored");
}
