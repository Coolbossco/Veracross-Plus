/**
 * Veracross Plus — Data Versioning & Migration System
 *
 * Ensures safe data migrations when the extension updates.
 * Migrations run automatically on extension startup.
 *
 * Migration Design Principles:
 * 1. Migrations are idempotent (safe to run multiple times)
 * 2. Migrations never delete user data without explicit backup
 * 3. Migrations preserve all existing functionality
 * 4. Failed migrations are logged but don't crash the extension
 *
 * @version 1
 */

import { getStorageProvider } from "../storage";
import { STORAGE_KEYS } from "../storage/StorageProvider";
import type { CustomAssignment } from "../models/Assignment";
import { migrateLegacyAssignment } from "../models/Assignment";
import { migrateLegacyCompletions } from "../models/Completion";

/**
 * Current data schema version
 *
 * Increment this when adding new migrations.
 */
export const CURRENT_DATA_VERSION = 1;

/**
 * Migration function type
 */
export type MigrationFn = () => Promise<void>;

/**
 * Migration definition
 */
export interface Migration {
  /** Version this migration upgrades TO */
  version: number;

  /** Human-readable description */
  description: string;

  /** Migration function */
  migrate: MigrationFn;
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  migrationsRun: number[];
  errors: Array<{ version: number; error: string }>;
}

/**
 * All migrations in order
 *
 * Each migration upgrades from version N-1 to version N.
 * Migration version 1 is the initial data format (no migration needed).
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial data format - add source field to custom assignments",
    migrate: async () => {
      const storage = getStorageProvider();

      // Migrate custom assignments to include new fields
      const customAssignments = await storage.get<unknown[]>(
        STORAGE_KEYS.CUSTOM_ASSIGNMENTS
      );

      if (customAssignments && Array.isArray(customAssignments)) {
        const migratedAssignments: CustomAssignment[] = customAssignments.map(
          (assignment) => {
            if (typeof assignment === "object" && assignment !== null) {
              // Check if already migrated (has source field)
              if ("source" in assignment) {
                return assignment as CustomAssignment;
              }
              // Migrate legacy assignment
              return migrateLegacyAssignment(assignment as Record<string, unknown>);
            }
            // Invalid data, create placeholder
            return migrateLegacyAssignment({});
          }
        );

        await storage.set(STORAGE_KEYS.CUSTOM_ASSIGNMENTS, migratedAssignments);
      }

      // Migrate completion records to ensure consistent format
      const completions = await storage.get<Record<string, unknown>>(
        STORAGE_KEYS.CHECKED_ASSIGNMENTS
      );

      if (completions && typeof completions === "object") {
        const migratedCompletions = migrateLegacyCompletions(completions);
        await storage.set(STORAGE_KEYS.CHECKED_ASSIGNMENTS, migratedCompletions);
      }
    },
  },
  // Future migrations will be added here:
  // {
  //   version: 2,
  //   description: "Add cloud sync metadata",
  //   migrate: async () => { ... }
  // },
];

/**
 * Get the current stored data version
 */
async function getStoredVersion(): Promise<number> {
  const storage = getStorageProvider();
  const version = await storage.get<number>(STORAGE_KEYS.DATA_VERSION);
  return version ?? 0; // 0 means never migrated
}

/**
 * Set the stored data version
 */
async function setStoredVersion(version: number): Promise<void> {
  const storage = getStorageProvider();
  await storage.set(STORAGE_KEYS.DATA_VERSION, version);
}

/**
 * Run all pending migrations
 *
 * Call this on extension startup.
 */
export async function runMigrations(): Promise<MigrationResult> {
  const fromVersion = await getStoredVersion();
  const result: MigrationResult = {
    success: true,
    fromVersion,
    toVersion: fromVersion,
    migrationsRun: [],
    errors: [],
  };

  // Get migrations that need to run
  const pendingMigrations = MIGRATIONS.filter(
    (m) => m.version > result.fromVersion
  ).sort((a, b) => a.version - b.version);

  if (pendingMigrations.length === 0) {
    return result;
  }

  for (const migration of pendingMigrations) {
    try {
      await migration.migrate();

      result.migrationsRun.push(migration.version);
      result.toVersion = migration.version;

      // Update stored version after each successful migration
      await setStoredVersion(migration.version);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error(
        `[Veracross Plus] Migration v${migration.version} failed:`,
        error
      );

      result.errors.push({
        version: migration.version,
        error: errorMessage,
      });

      result.success = false;

      // Stop running migrations after a failure
      break;
    }
  }

  return result;
}

/**
 * Check if migrations are needed
 */
export async function needsMigration(): Promise<boolean> {
  const currentVersion = await getStoredVersion();
  return currentVersion < CURRENT_DATA_VERSION;
}

/**
 * Get migration status
 */
export async function getMigrationStatus(): Promise<{
  currentVersion: number;
  targetVersion: number;
  needsMigration: boolean;
  pendingMigrations: number;
}> {
  const currentVersion = await getStoredVersion();

  return {
    currentVersion,
    targetVersion: CURRENT_DATA_VERSION,
    needsMigration: currentVersion < CURRENT_DATA_VERSION,
    pendingMigrations: MIGRATIONS.filter((m) => m.version > currentVersion).length,
  };
}

/**
 * Force re-run all migrations (for recovery/testing)
 *
 * ⚠️ Use with caution — only for development/recovery
 */
export async function resetAndMigrate(): Promise<MigrationResult> {
  await setStoredVersion(0);
  return runMigrations();
}

/**
 * Initialize data versioning
 *
 * Call this on extension startup, before accessing any data.
 */
export async function initializeDataVersioning(): Promise<MigrationResult> {
  // Check if this is a fresh install (no data version AND no legacy data)
  const storage = getStorageProvider();
  const hasVersion = await storage.has(STORAGE_KEYS.DATA_VERSION);
  const hasLegacyData =
    (await storage.has(STORAGE_KEYS.CUSTOM_ASSIGNMENTS)) ||
    (await storage.has(STORAGE_KEYS.CHECKED_ASSIGNMENTS)) ||
    (await storage.has("enableChecklist"));

  if (!hasVersion && !hasLegacyData) {
    // Fresh install — set to current version, no migrations needed
    await setStoredVersion(CURRENT_DATA_VERSION);

    return {
      success: true,
      fromVersion: CURRENT_DATA_VERSION,
      toVersion: CURRENT_DATA_VERSION,
      migrationsRun: [],
      errors: [],
    };
  }

  // Existing install — run any needed migrations
  return runMigrations();
}

