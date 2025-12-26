/**
 * Veracross Plus — Completion State Model
 *
 * Tracks completion/checked state for assignments (both native and custom).
 * Uses compact storage format to minimize sync storage usage.
 *
 * @version 1
 */

/**
 * Completion state value
 * - 1: Completed/checked
 * - undefined: Not completed (omitted from storage for compactness)
 */
export type CompletionState = 1 | undefined;

/**
 * Completion record map
 *
 * Maps assignment keys to their completion state.
 * Only stores completed assignments (value = 1) to save space.
 *
 * Key format:
 * - Native assignments: `${host}|${veracrossId}` or `${host}|${hash(text+date)}`
 * - Custom assignments: `custom-${assignmentId}`
 */
export type CompletionRecord = Record<string, CompletionState>;

/**
 * Checked assignments storage format (legacy compatible)
 */
export interface CheckedAssignmentsStore {
  /** Map of assignment keys to completion state */
  vc_checked_assignments: CompletionRecord;
}

/**
 * Check if an assignment is marked as completed
 */
export function isCompleted(
  record: CompletionRecord,
  assignmentKey: string
): boolean {
  return record[assignmentKey] === 1;
}

/**
 * Mark an assignment as completed
 */
export function markCompleted(
  record: CompletionRecord,
  assignmentKey: string
): CompletionRecord {
  return {
    ...record,
    [assignmentKey]: 1,
  };
}

/**
 * Mark an assignment as not completed
 */
export function markNotCompleted(
  record: CompletionRecord,
  assignmentKey: string
): CompletionRecord {
  const { [assignmentKey]: _, ...rest } = record;
  return rest;
}

/**
 * Toggle completion state for an assignment
 */
export function toggleCompletion(
  record: CompletionRecord,
  assignmentKey: string
): CompletionRecord {
  if (isCompleted(record, assignmentKey)) {
    return markNotCompleted(record, assignmentKey);
  }
  return markCompleted(record, assignmentKey);
}

/**
 * Generate assignment key for a custom assignment
 */
export function getCustomAssignmentKey(assignmentId: string): string {
  return `custom-${assignmentId}`;
}

/**
 * Generate assignment key for a native Veracross assignment
 *
 * @param host - Current host (e.g., "school.veracross.com")
 * @param identifier - Veracross ID or hashed content identifier
 */
export function getNativeAssignmentKey(
  host: string,
  identifier: string
): string {
  return `${host}|${identifier}`;
}

/**
 * Compact completion record by removing undefined/falsy values
 *
 * This ensures minimal storage usage by only keeping completed items.
 */
export function compactCompletionRecord(
  record: CompletionRecord
): CompletionRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value === 1)
  );
}

/**
 * Migrate legacy completion data to current format
 *
 * Legacy format may have boolean values or other formats.
 */
export function migrateLegacyCompletions(
  legacyData: Record<string, unknown>
): CompletionRecord {
  const result: CompletionRecord = {};

  for (const [key, value] of Object.entries(legacyData)) {
    // Convert any truthy value to 1
    if (value) {
      result[key] = 1;
    }
  }

  return result;
}

