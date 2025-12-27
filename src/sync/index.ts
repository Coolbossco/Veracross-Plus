/**
 * Veracross Plus — Sync Module
 *
 * Central export for sync-related functionality.
 */

export { BackupManager, getBackupManager, type Snapshot } from "./BackupManager";
export { SyncManager, getSyncManager, type SyncState, type SyncStats, type SyncError, type SyncErrorClass } from "./SyncManager";
export {
    getTelemetryService,
    trackSyncStarted,
    trackSyncSuccess,
    trackSyncFailed,
    trackSyncRetry,
    trackBackupCreated,
    trackBackupRestored,
    type TelemetryEvent
} from "./TelemetryService";
