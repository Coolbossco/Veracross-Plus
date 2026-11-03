import browser from "webextension-polyfill";

export const DEFAULT_ROW_ID = "custom-assignments";
export const DEFAULT_ROW_COLOR = "#1976d2";
export const DEFAULT_ASSIGNMENT_COLOR = "#1976d2";

export const DEFAULTS = {
  enableChecklist: false,
  enableAssessmentCheckboxes: false,
  enableEstimator: false,
  enableHomeRedirect: false,
  enableCustomAssignments: false,
  enableHomepageWidget: false,
  homepageShowCompleted: false,
  enableAssessmentReminders: false,
  enableLunchHomepage: false,
  enableLunchTimeline: false,
  selectedTheme: "none",
  homeUrl: "",
  customRows: [],
  customAssignments: [],
};

export function createDefaultRow() {
  return {
    id: DEFAULT_ROW_ID,
    name: "Custom Assignments",
    color: DEFAULT_ROW_COLOR,
  };
}

export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function isExtensionAlive() {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

function isInvalidatedContextError(error) {
  return String(error?.message || error || "").includes(
    "Extension context invalidated"
  );
}

async function withStorage(operation, fallback) {
  if (!isExtensionAlive()) {
    return fallback;
  }
  try {
    return await operation();
  } catch (error) {
    if (isInvalidatedContextError(error)) {
      return fallback;
    }
    throw error;
  }
}

export async function loadSettings() {
  return await withStorage(
    () => browser.storage.sync.get(DEFAULTS),
    { ...DEFAULTS }
  );
}

export async function saveSettings(changes) {
  await withStorage(() => browser.storage.sync.set(changes));
}

export async function getStorage(key) {
  const obj = await withStorage(() => browser.storage.sync.get(key), {});
  return obj?.[key];
}

export async function setStorage(obj) {
  await withStorage(() => browser.storage.sync.set(obj));
}

export function assignmentColor(assignment, row) {
  return assignment?.color || row?.color || DEFAULT_ASSIGNMENT_COLOR;
}

export async function loadCustomWorkspace() {
  const stored = await withStorage(
    () =>
      browser.storage.sync.get({
        customRows: [],
        customAssignments: [],
      }),
    { customRows: [], customAssignments: [] }
  );

  let rows = Array.isArray(stored.customRows) ? [...stored.customRows] : [];
  const assignments = Array.isArray(stored.customAssignments)
    ? stored.customAssignments
    : [];

  if (rows.length === 0) {
    rows = [createDefaultRow()];
  }

  let changed = !Array.isArray(stored.customRows) || stored.customRows.length === 0;
  const validRowIds = new Set(rows.map((row) => row.id));

  const migratedAssignments = assignments.map((assignment) => {
    if (assignment.rowId && validRowIds.has(assignment.rowId)) {
      return assignment;
    }
    changed = true;
    return { ...assignment, rowId: rows[0].id };
  });

  if (changed) {
    await setStorage({
      customRows: rows,
      customAssignments: migratedAssignments,
    });
  }

  return { rows, assignments: migratedAssignments };
}
