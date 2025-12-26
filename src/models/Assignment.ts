/**
 * Veracross Plus — Assignment Model
 *
 * Canonical data model for assignments (both native Veracross and custom).
 * This model supports versioning for future cloud sync compatibility.
 *
 * @version 1
 */

/**
 * Assignment type classification
 */
export type AssignmentType =
  | "homework"
  | "classwork"
  | "test"
  | "quiz"
  | "paper"
  | "project"
  | "custom";

/**
 * Source of the assignment (for distinguishing native vs custom)
 */
export type AssignmentSource = "veracross" | "custom";

/**
 * Custom Assignment — user-created assignments stored locally
 *
 * These are assignments created by the user through the extension,
 * displayed alongside native Veracross assignments.
 */
export interface CustomAssignment {
  /** Unique identifier (UUID v4 format recommended) */
  id: string;

  /** Assignment title/name */
  title: string;

  /** Due date in ISO format (YYYY-MM-DD) */
  dueDate: string;

  /** Associated class/course name */
  className: string;

  /** Optional detailed description */
  description?: string;

  /** Assignment type classification */
  assignmentType: AssignmentType;

  /** Source identifier — always 'custom' for user-created */
  source: AssignmentSource;

  /** Creation timestamp (ISO 8601) */
  createdAt: string;

  /** Last modification timestamp (ISO 8601) */
  updatedAt: string;
}

/**
 * Veracross Native Assignment Reference
 *
 * Reference to a native Veracross assignment, used for tracking
 * completion state without storing the full assignment data.
 */
export interface NativeAssignmentRef {
  /** Stable key derived from assignment data or Veracross ID */
  key: string;

  /** Original Veracross assignment ID if available */
  veracrossId?: string;

  /** Source identifier — always 'veracross' for native */
  source: AssignmentSource;
}

/**
 * Type guard to check if an assignment is a CustomAssignment
 */
export function isCustomAssignment(
  assignment: CustomAssignment | NativeAssignmentRef
): assignment is CustomAssignment {
  return assignment.source === "custom" && "title" in assignment;
}

/**
 * Type guard to check if an assignment reference is native
 */
export function isNativeAssignmentRef(
  assignment: CustomAssignment | NativeAssignmentRef
): assignment is NativeAssignmentRef {
  return assignment.source === "veracross";
}

/**
 * Create a new CustomAssignment with default values
 */
export function createCustomAssignment(
  data: Omit<CustomAssignment, "source" | "createdAt" | "updatedAt"> &
    Partial<Pick<CustomAssignment, "createdAt" | "updatedAt">>
): CustomAssignment {
  const now = new Date().toISOString();
  return {
    ...data,
    source: "custom",
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
  };
}

/**
 * Migrate legacy assignment data to current model format
 *
 * @param legacyData - Assignment data from older versions
 * @returns Properly formatted CustomAssignment
 */
export function migrateLegacyAssignment(
  legacyData: Record<string, unknown>
): CustomAssignment {
  const now = new Date().toISOString();

  return {
    id: (legacyData.id as string) ?? crypto.randomUUID(),
    title: (legacyData.title as string) ?? "Untitled Assignment",
    dueDate: (legacyData.dueDate as string) ?? new Date().toISOString().split("T")[0],
    className: (legacyData.className as string) ?? "Unknown Class",
    description: legacyData.description as string | undefined,
    assignmentType: validateAssignmentType(legacyData.assignmentType) ?? "custom",
    source: "custom",
    createdAt: (legacyData.createdAt as string) ?? now,
    updatedAt: now,
  };
}

/**
 * Validate and normalize assignment type
 */
function validateAssignmentType(
  type: unknown
): AssignmentType | undefined {
  const validTypes: AssignmentType[] = [
    "homework",
    "classwork",
    "test",
    "quiz",
    "paper",
    "project",
    "custom",
  ];

  if (typeof type === "string" && validTypes.includes(type as AssignmentType)) {
    return type as AssignmentType;
  }

  return undefined;
}

