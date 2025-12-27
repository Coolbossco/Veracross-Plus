/**
 * Veracross Plus — Backup Manager
 *
 * Handles snapshotting of local data before sync operations.
 * Maintains a rotation of the last 3 snapshots to ensure recoverability.
 *
 * Snapshots are stored in chrome.storage.local to survive
 * accidental wipes of chrome.storage.sync (if that's where local data lives).
 *
 * @version 1
 */

import { STORAGE_KEYS } from "../storage/StorageProvider";
import { getStorageProvider } from "../storage/LocalStorageProvider";

export interface Snapshot {
    id: string;
    timestamp: string;
    data: {
        [key: string]: unknown;
    };
}

const BACKUP_STORAGE_KEY = "vcp_sync_backups";
const MAX_SNAPSHOTS = 3;

export class BackupManager {
    /**
     * Create a snapshot of current local data
     *
     * @returns The ID of the created snapshot
     */
    async createSnapshot(): Promise<string> {
        const localStorage = getStorageProvider();
        const allKeys = await localStorage.keys();

        // Filter out internal keys we don't want to backup
        const keysToBackup = allKeys.filter(
            (key) =>
                key === STORAGE_KEYS.PREFERENCES ||
                key === STORAGE_KEYS.CUSTOM_ASSIGNMENTS ||
                key === STORAGE_KEYS.CHECKED_ASSIGNMENTS ||
                key === STORAGE_KEYS.DATA_VERSION
        );

        const data = await localStorage.getMany(keysToBackup);

        const snapshot: Snapshot = {
            id: `snapshot_${Date.now()}`,
            timestamp: new Date().toISOString(),
            data: data as Record<string, unknown>,
        };

        await this.saveSnapshot(snapshot);
        await this.rotateSnapshots();

        return snapshot.id;
    }

    /**
     * Get all available snapshots
     */
    async getSnapshots(): Promise<Snapshot[]> {
        return new Promise<Snapshot[]>((resolve) => {
            if (typeof chrome === "undefined" || !chrome.storage?.local) {
                resolve([]);
                return;
            }

            chrome.storage.local.get(BACKUP_STORAGE_KEY, (result) => {
                const snapshots = (result[BACKUP_STORAGE_KEY] as Snapshot[] | undefined) ?? [];
                resolve(snapshots);
            });
        });
    }

    /**
     * Restore local data from a snapshot
     *
     * @param snapshotId - ID of the snapshot to restore
     */
    async restoreFromSnapshot(snapshotId: string): Promise<boolean> {
        const snapshots = await this.getSnapshots();
        const snapshot = snapshots.find((s) => s.id === snapshotId);

        if (!snapshot) {
            console.error(`[BackupManager] Snapshot ${snapshotId} not found`);
            return false;
        }

        const localStorage = getStorageProvider();
        await localStorage.setMany(snapshot.data);

        return true;
    }

    /**
     * Save a new snapshot to local storage
     */
    private async saveSnapshot(snapshot: Snapshot): Promise<void> {
        const snapshots = await this.getSnapshots();
        snapshots.unshift(snapshot);

        return new Promise((resolve) => {
            chrome.storage.local.set({ [BACKUP_STORAGE_KEY]: snapshots }, resolve);
        });
    }

    /**
     * Keep only the most recent snapshots
     */
    private async rotateSnapshots(): Promise<void> {
        let snapshots = await this.getSnapshots();

        if (snapshots.length > MAX_SNAPSHOTS) {
            snapshots = snapshots.slice(0, MAX_SNAPSHOTS);
            return new Promise((resolve) => {
                chrome.storage.local.set({ [BACKUP_STORAGE_KEY]: snapshots }, resolve);
            });
        }
    }
}

let instance: BackupManager | null = null;

export function getBackupManager(): BackupManager {
    if (!instance) {
        instance = new BackupManager();
    }
    return instance;
}
