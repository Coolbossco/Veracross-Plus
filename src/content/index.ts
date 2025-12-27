// Veracross Plus — content script (MVP)
// Adds: (1) homework checkboxes (2) exact % estimator (3) optional home redirect

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1: Import new abstraction layers
// These imports provide type-safe models, storage abstraction, and feature flags
// while maintaining full backwards compatibility with existing functionality.
// ═══════════════════════════════════════════════════════════════════════════════

import { getStorageProvider, getCloudStorageProvider, STORAGE_KEYS } from "../storage";
import { initializeFeatureFlags, getFeatureFlags } from "../features";
import { initializeDataVersioning } from "../migrations";
import { initializeAutoSync } from "../sync";
import type { CustomAssignment } from "../models/Assignment";
import type { CompletionRecord } from "../models/Completion";
import type { UserPreferences } from "../models/UserPreferences";
import { DEFAULT_USER_PREFERENCES } from "../models/UserPreferences";
import { canCreateCustomAssignment, createCheckoutSession, refreshEntitlementState } from "../storage/EntitlementService";

// CSS is loaded via manifest.json content_scripts.css

// ═══════════════════════════════════════════════════════════════════════════════
// Default settings (backwards compatible)
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULTS: UserPreferences = DEFAULT_USER_PREFERENCES;

// ═══════════════════════════════════════════════════════════════════════════════
// Utility functions
// ═══════════════════════════════════════════════════════════════════════════════

// Small stable hash for keys (used for assignment identification)
function hash(str: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage functions (backwards compatible, using CloudStorageProvider for sync)
// ═══════════════════════════════════════════════════════════════════════════════

async function loadSettings(): Promise<UserPreferences> {
  const storage = getStorageProvider();
  const keys = Object.keys(DEFAULTS) as (keyof UserPreferences)[];
  const stored = await storage.getMany<Record<string, unknown>>(keys) as Partial<UserPreferences>;
  return { ...DEFAULTS, ...stored };
}

async function saveSettings(changes: Partial<UserPreferences>): Promise<void> {
  // Use CloudStorageProvider to trigger sync
  const storage = getCloudStorageProvider();
  await storage.setMany(changes);
}

async function getStorage<T>(key: string): Promise<T | undefined> {
  const storage = getStorageProvider();
  return storage.get<T>(key);
}

async function setStorage(obj: Record<string, unknown>): Promise<void> {
  // Use CloudStorageProvider to trigger sync
  const storage = getCloudStorageProvider();
  await storage.setMany(obj);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Initialize Phase 1 systems (runs before features are applied)
// ═══════════════════════════════════════════════════════════════════════════════

async function initializePhase1Systems(): Promise<void> {
  try {
    // Run any pending data migrations
    await initializeDataVersioning();

    // Initialize feature flags system
    await initializeFeatureFlags();

    // Initialize auto-sync for content script (registers SyncManager)
    initializeAutoSync();
  } catch (error) {
    // Non-critical: continue with legacy behavior
  }
}

// ———————————————— Fix clipping issues ————————————————
function fixClippingIssues() {
  // Target timeline-cell divs specifically
  const timelineCells = document.querySelectorAll(".timeline-cell");

  let cellsFixed = 0;

  timelineCells.forEach((cell, index) => {
    const assignments = cell.querySelectorAll(".assignment");
    const assignmentCount = assignments.length;

    // If cell has 3 or more assignments, make it scrollable instead of expanding
    if (assignmentCount >= 3) {
      // Calculate the actual content height needed for all assignments
      let totalContentHeight = 0;
      assignments.forEach((assignment) => {
        // Get the computed height of each assignment element
        const assignmentEl = assignment as HTMLElement;
        const assignmentHeight =
          assignmentEl.offsetHeight || assignmentEl.scrollHeight || 40; // fallback to 40px
        totalContentHeight += assignmentHeight;
      });

      // Add some padding for better spacing
      totalContentHeight += 16; // 8px top + 8px bottom padding

      // Set cell height to accommodate 2 assignments plus some space for scrolling
      const visibleHeight = Math.min(100, totalContentHeight - 15); // Show most content but leave room to scroll
      const maxHeight = Math.max(100, totalContentHeight); // Allow full content height

      // Make scrollable with proper height calculations - keep width minimal
      const cellEl = cell as HTMLElement;
      cellEl.style.height = `${visibleHeight}px`;
      cellEl.style.maxHeight = `${maxHeight}px`;
      cellEl.style.overflowY = "auto";
      cellEl.style.overflowX = "hidden";
      cellEl.style.verticalAlign = "top";
      // Remove all width and padding styling - let cell size naturally
      cell.classList.add("scrollable");

      // Don't expand parent row - keep table layout consistent
      const parentRow = cell.closest("tr") as HTMLElement | null;
      if (parentRow) {
        parentRow.style.height = `${visibleHeight}px`;
      }

      cellsFixed++;
    }
  });

  // Also try to find assignment containers more directly
  const assignmentElements = document.querySelectorAll("[data-assignment-id]");

  // Legacy fallback: expand row heights to show all assignments
  const timelineRows = document.querySelectorAll(
    ".timeline-records tr, .timeline-table tr, tr",
  );

  let processedRows = 0;
  let rowsWithAssignments = 0;

  timelineRows.forEach((row, index) => {
    // Check if this row has cells with assignment content
    const cells = row.querySelectorAll("td");

    let hasAssignments = false;
    let cellsWithAssignments = 0;

    cells.forEach((cell, cellIndex) => {
      const hasAssignmentElements = cell.querySelector(
        '[class*="assignment"], .homework, .test, .paper, .quiz, .classwork, [data-assignment-id]',
      );
      const text = cell.textContent || "";
      const hasAssignmentText =
        text.includes("HOMEWORK") ||
        text.includes("TEST") ||
        text.includes("PAPER") ||
        text.includes("QUIZ") ||
        text.includes("CLASSWORK") ||
        text.includes("DUE") ||
        text.includes("Homework") ||
        text.includes("Classwork") ||
        text.includes("Paper") ||
        text.includes("Test") ||
        text.includes("Quiz") ||
        cell.querySelector("[data-assignment-id]"); // Check for Veracross assignment elements

      if (hasAssignmentElements || hasAssignmentText) {
        hasAssignments = true;
        cellsWithAssignments++;

        // Ensure cell can expand
        const cellEl = cell as HTMLElement;
        cellEl.style.height = "auto";
        cellEl.style.minHeight = "120px";
        cellEl.style.verticalAlign = "top";
        cellEl.style.padding = "8px";
      }
    });

    // If row has assignments, ensure it can expand
    if (hasAssignments) {
      rowsWithAssignments++;
      const rowEl = row as HTMLElement;
      rowEl.style.height = "auto";
      rowEl.style.minHeight = "120px";
    }

    processedRows++;
  });
}

// Enhanced scrolling function specifically for timeline cells
function enhanceTimelineScrolling() {
  // Find all scrollable timeline cells
  const scrollableCells = document.querySelectorAll(
    ".timeline-cell.scrollable",
  );

  scrollableCells.forEach((cell, index) => {
    const assignments = cell.querySelectorAll(".assignment");
    if (assignments.length >= 3) {
      // Recalculate heights to ensure proper scrolling
      let totalContentHeight = 0;
      assignments.forEach((assignment) => {
        const assignmentEl = assignment as HTMLElement;
        const assignmentHeight =
          assignmentEl.offsetHeight || assignmentEl.scrollHeight || 40;
        totalContentHeight += assignmentHeight;
      });

      // Ensure there's enough scrollable content
      const visibleHeight = Math.min(100, totalContentHeight - 15);
      const maxHeight = Math.max(100, totalContentHeight);

      // Update cell dimensions for better scrolling - keep width minimal
      const cellEl = cell as HTMLElement;
      cellEl.style.height = `${visibleHeight}px`;
      cellEl.style.maxHeight = `${maxHeight}px`;
      cellEl.style.overflowY = "auto";
      cellEl.style.overflowX = "hidden";
      // Remove all width and padding styling - let cell size naturally
    }
  });
}

// Handle window resize events to recalculate scrolling
function handleWindowResize() {
  setTimeout(() => {
    fixClippingIssues();
    enhanceTimelineScrolling();
  }, 100);
}

// ———————————————— Feature 1: Homework checklist ————————————————
async function applyChecklist() {
  const checked = (await getStorage("vc_checked_assignments")) || {};

  // Apply checklist directly to the current document
  // This avoids iframe communication issues and works on all Veracross pages
  const checkedRecord = checked as CompletionRecord;
  applyChecklistToDocument(document, checkedRecord);
}

function applyChecklistToDocument(doc: Document, checked: CompletionRecord) {
  // Clear any existing checkboxes first to prevent duplicates
  const existingCheckboxes = doc.querySelectorAll(".vch-task-wrap");
  if (existingCheckboxes.length > 0) {
    existingCheckboxes.forEach((cb: Element) => cb.remove());
  }

  // Much more specific selectors to avoid multiple checkboxes per assignment
  const selectors = [
    // Only target the main assignment containers, not nested elements
    ".timeline-records > .timeline-record",
    ".timeline-records > [class*='assignment']",
    ".timeline-records > [class*='homework']",
    ".timeline-records > [class*='test']",
    ".timeline-records > [class*='paper']",
    ".timeline-records > [class*='classwork']",
    // Fallback for other layouts - only direct children
    "main > [class*='assignment']",
    "main > [class*='homework']",
    "main > [class*='test']",
    "main > [class*='paper']",
    "main > [class*='classwork']",
    // Very specific - only elements with assignment-like text that aren't nested
    "[data-assignment-id]:not([class*='vch-decorated'])",
    ".assignment-row:not([class*='vch-decorated'])",
    // Daily schedule page - assignment description cells specifically
    ".daily-schedule table.assignments td.assignment-description:not([class*='vch-decorated'])",
    ".schedule table.assignments td.assignment-description:not([class*='vch-decorated'])",
  ];

  const seen = new WeakSet();

  function keyForNode(node: Element): string {
    const stable = node.getAttribute?.("data-assignment-id");
    if (stable) return `${location.host}|${stable}`;
    const text = node.textContent?.trim().replace(/\s+/g, " ") || "";
    const nearDate = node
      .closest("tr,li,div")
      ?.textContent?.match(/\b(?:\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\b/);
    return `${location.host}|${hash(text + (nearDate?.[0] || ""))}`;
  }

  function decorate(node: Element): void {
    if (seen.has(node)) return;
    seen.add(node);

    const id = keyForNode(node);

    // Check if this node already has a checkbox to avoid duplicates
    if (node.querySelector(".vch-task-wrap")) {
      return;
    }

    // Mark this node as decorated immediately to prevent re-processing
    node.classList.add("vch-decorated");

    // Find the best place to insert the checkbox - prefer the first text node or link
    let insertTarget = node;

    // Special handling for daily schedule assignment tables
    if (node.classList.contains("assignment-description")) {
      // For daily schedule, insert before the link in the assignment-description cell
      const link = node.querySelector("a");
      if (link) {
        insertTarget = link;
      }
    } else {
      // Look for the first meaningful text element or link
      const firstTextElement = node.querySelector("a, span, div, p") || node;
      if (firstTextElement && firstTextElement !== node) {
        insertTarget = firstTextElement;
      }
    }

    // If the insert target already has a checkbox, skip this node
    if (insertTarget.querySelector(".vch-task-wrap")) {
      return;
    }

    // Get the full text content for better assignment type detection
    const fullText = (node.textContent || "").toLowerCase();
    const nodeText = fullText.trim();

    // More comprehensive assignment type detection
    let assignmentType = "homework"; // default
    let shouldSkip = false;

    // For daily schedule, check the assignment-type cell in the same row
    if (node.classList.contains("assignment-description")) {
      const row = node.closest("tr");
      if (row) {
        const typeCell = row.querySelector(".assignment-type");
        if (typeCell) {
          const typeText = typeCell.textContent.toLowerCase();
          if (typeText.includes("homework")) {
            assignmentType = "homework";
          } else if (typeText.includes("classwork")) {
            assignmentType = "classwork";
          } else if (typeText.includes("paper") || typeText.includes("essay")) {
            assignmentType = "paper";
          } else if (
            typeText.includes("test") ||
            typeText.includes("exam") ||
            typeText.includes("quiz")
          ) {
            assignmentType = "test";
            shouldSkip = true;
          }
        }
      }
    } else {
      // Check for test-related assignments first - be more specific
      if (
        nodeText.includes("test") ||
        nodeText.includes("exam") ||
        (nodeText.includes("assessment") && !nodeText.includes("paper")) || // Only skip assessment if it's NOT a paper
        nodeText.includes("quiz") ||
        nodeText.includes("final") ||
        nodeText.includes("midterm")
      ) {
        assignmentType = "test";
        shouldSkip = true;
      } else if (nodeText.includes("paper") || nodeText.includes("essay")) {
        assignmentType = "paper";
      } else if (
        nodeText.includes("classwork") ||
        nodeText.includes("class work")
      ) {
        assignmentType = "classwork";
      } else if (
        nodeText.includes("homework") ||
        nodeText.includes("home work")
      ) {
        assignmentType = "homework";
      }
    }

    // Skip test assignments and any assignments that don't need checkboxes
    if (shouldSkip) {
      return;
    }

    // For daily schedule assignments in tables, skip the additional filtering
    // since they're always valid assignments from the schedule
    const isDailyScheduleAssignment = node.classList.contains(
      "assignment-description",
    );

    if (!isDailyScheduleAssignment) {
      // Additional filtering: skip assignments that are just informational or don't need tracking
      if (nodeText.includes("summer work") && !nodeText.includes("due")) {
        return;
      }

      // Skip assignments that are just informational text without due dates or specific actions
      if (
        !nodeText.includes("due") &&
        !nodeText.includes("homework") &&
        !nodeText.includes("classwork") &&
        !nodeText.includes("paper") &&
        !nodeText.includes("assignment") &&
        !nodeText.includes("bring") &&
        !nodeText.includes("complete") &&
        !nodeText.includes("finish")
      ) {
        return;
      }
    }

    const wrap = document.createElement("span");
    wrap.className = "vch-task-wrap";
    wrap.setAttribute("data-type", assignmentType);

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "vch-checkbox";

    // Parse date to determine if upcoming and force unchecked
    let isChecked = !!checked[id];
    let isInUpcomingSection = false;

    // Method 1: Check for "Upcoming" header in surrounding elements
    let currentNode = node;
    for (let i = 0; i < 20 && currentNode; i++) {
      const text = currentNode.textContent?.toLowerCase() || "";
      // Look for "Upcoming" text that appears before our assignment
      if (
        text.includes("upcoming") &&
        !text.includes("past") &&
        !text.includes("completed")
      ) {
        const upcomingIndex = text.indexOf("upcoming");
        const assignmentIndex = text.indexOf(nodeText);
        if (
          upcomingIndex >= 0 &&
          (assignmentIndex < 0 || upcomingIndex < assignmentIndex)
        ) {
          isInUpcomingSection = true;
          break;
        }
      }
      const nextNode = currentNode.parentElement || currentNode.previousElementSibling;
      if (!nextNode) break;
      currentNode = nextNode;
    }

    // Method 2: Look for "Upcoming" in preceding DOM elements
    if (!isInUpcomingSection) {
      const allElements = document.querySelectorAll("*");
      let foundUpcoming = false;
      for (let element of Array.from(allElements)) {
        const elementText = element.textContent?.trim().toLowerCase() || "";
        if (
          elementText === "upcoming" ||
          (elementText.includes("upcoming") && elementText.length < 30)
        ) {
          foundUpcoming = true;
        }
        if (foundUpcoming && element.contains(node)) {
          isInUpcomingSection = true;
          break;
        }
      }
    }

    // Method 3: Improved date parsing with better regex
    const dateMatch = nodeText.match(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[\s\u00A0]*(\d{1,2})\b/i,
    );

    if (dateMatch) {
      const month = dateMatch[1].toLowerCase();
      const day = parseInt(dateMatch[2], 10);
      const monthNames = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11,
      };
      const monthNum = monthNames[month as keyof typeof monthNames];

      if (monthNum !== undefined) {
        const now = new Date();
        const today = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        let dueDate = new Date(now.getFullYear(), monthNum, day);

        // If date appears to be in the past, it's probably next year
        if (dueDate < today) {
          dueDate.setFullYear(now.getFullYear() + 1);
        }

        // Consider assignments due today or in the future as "upcoming"
        const isUpcomingByDate = dueDate >= today;

        if (isUpcomingByDate || isInUpcomingSection) {
          isChecked = false;
        }
      }
    } else if (isInUpcomingSection) {
      // Force unchecked if in upcoming section even without date match
      isChecked = false;
    }
    cb.checked = isChecked;

    if (cb.checked) {
      node.classList.add("vch-done");
    }

    // Prevent clicks on the checkbox from propagating to parent elements
    cb.addEventListener("click", (event) => {
      // Don't prevent default - let the checkbox change state
      event.stopPropagation();
    });

    // Also prevent clicks on the wrapper from propagating
    wrap.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
    });

    // Add a simple test click handler to see if anything works
    cb.addEventListener("mousedown", (event) => {
      // Mouse down event
    });

    cb.addEventListener("mouseup", (event) => {
      // Mouse up event
    });

    // Test if the checkbox can be focused
    cb.addEventListener("focus", (event) => {
      // Focus event
    });

    // Add input event listener as backup
    cb.addEventListener("input", (event) => {
      // Input event
    });

    // Add error handling to the change event
    cb.addEventListener("change", async (event) => {
      try {
        checked[id] = cb.checked ? 1 : undefined;

        node.classList.toggle("vch-done", cb.checked);

        // prune undefineds
        const compact = Object.fromEntries(
          Object.entries(checked).filter(([, v]) => v),
        );

        await setStorage({ vc_checked_assignments: compact });
      } catch (error) {
        // Silent error handling
      }
    });

    // Insert checkbox at the beginning of the insert target
    insertTarget.insertBefore(wrap, insertTarget.firstChild);
    wrap.appendChild(cb);
  }

  function scan() {
    let totalFound = 0;
    let totalDecorated = 0;

    selectors.forEach((sel, index) => {
      const elements = doc.querySelectorAll(sel);

      elements.forEach((node: Element) => {
        // Skip if already decorated
        if (node.classList.contains("vch-decorated")) {
          return;
        }

        // Skip if node already has a checkbox
        if (node.querySelector(".vch-task-wrap")) {
          return;
        }

        totalFound++;
        decorate(node);
        totalDecorated++;
      });
    });
  }

  scan();
  const mo = new MutationObserver(() => scan());
  mo.observe(doc.documentElement, { childList: true, subtree: true });
}

// ———————————————— Feature 2: Exact % estimator ————————————————
function parseScores(root: HTMLElement) {
  // Finds fragments like "8/10" or "75%" inside tables/lists.
  const text = root.innerText || "";
  const byFraction = [
    ...text.matchAll(/(\b\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g),
  ].map((m) => ({ earned: +m[1], possible: +m[2] }));
  const byPercent = [...text.matchAll(/(\b\d+(?:\.\d+)?)\s*%/g)].map((m) => ({
    percent: +m[1],
  }));
  return { byFraction, byPercent };
}

function estimatePercent({ byFraction, byPercent }: { byFraction: Array<{ earned: number; possible: number }>; byPercent: Array<{ percent: number }> }) {
  let earned = 0,
    possible = 0;
  byFraction.forEach(({ earned: e, possible: p }: { earned: number; possible: number }) => {
    if (!isNaN(e) && !isNaN(p) && p > 0) {
      earned += e;
      possible += p;
    }
  });

  // If we only have percents, average them (unweighted) as a fallback.
  if (possible === 0 && byPercent.length) {
    const avg = byPercent.reduce((s: number, r: { percent: number }) => s + r.percent, 0) / byPercent.length;
    return { percent: avg, method: "avg of visible %" };
  }
  if (possible > 0) {
    return { percent: (earned / possible) * 100, method: "sum of points" };
  }
  return { percent: null, method: "no data" };
}

function ensurePanel() {
  let panel = document.querySelector(".vch-grade-panel");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.className = "vch-grade-panel";
  panel.innerHTML = `
      <div class="vch-grade-row">
        <strong>Estimated Grade</strong>
        <span class="vch-grade-value">—</span>
      </div>
      <div class="vch-grade-note">Based on visible scores only · unofficial</div>
    `;
  document.body.appendChild(panel);
  return panel;
}

function applyEstimator() {
  const panel = ensurePanel();

  function recalc() {
    // Heuristic: prefer the main content region
    const main =
      (document.querySelector("main, #main, .main-content") as HTMLElement) || document.body;
    const data = parseScores(main);
    const est = estimatePercent(data);
    const val = panel.querySelector(".vch-grade-value");
    if (val) {
      if (est.percent == null) {
        val.textContent = "—";
      } else {
        val.textContent = `${est.percent.toFixed(1)}%`;
      }
    }
    const panelEl = panel as HTMLElement;
    panelEl.title = `Method: ${est.method}`;
  }

  recalc();
  const mo = new MutationObserver(() => recalc());
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

// ———————————————— Feature 3: Home redirect ————————————————
function maybeRedirectHome(settings: UserPreferences): void {
  try {
    if (!settings.enableHomeRedirect) return;
    if (!settings.homeUrl) return;

    const isRootish =
      /\/student\/?$/.test(location.pathname) ||
      /\/portal\/?$/.test(location.pathname);
    if (isRootish) {
      // Support relative or absolute
      const target = settings.homeUrl.startsWith("http")
        ? settings.homeUrl
        : new URL(settings.homeUrl, location.origin).toString();
      if (location.toString() !== target) {
        location.replace(target);
      }
    }
  } catch (e) {
    // no-op
  }
}

// ———————————————— Feature 4: Custom Assignments ————————————————
let customAssignmentsInjected = false;
let injectionInProgress = false;
let instantUpdateInProgress = false;
let modalOpenInProgress = false;

// Add global event handler to prevent native Veracross modals for custom assignments
document.addEventListener(
  "click",
  (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Check if clicking on our custom assignment
    const assignmentDiv = target.closest('[data-vch-custom="true"]') as HTMLElement | null;
    if (assignmentDiv) {
      // Don't show modal if clicking on checkbox - let checkbox function normally
      if ((target as HTMLInputElement).type === "checkbox" || target.closest(".vch-task-wrap")) {
        return;
      }

      // Don't interfere with Details button clicks - let them handle themselves
      if (target.classList.contains("vch-assignment-details")) {
        return;
      }

      // Only prevent default for timeline assignments (not assignments page)
      const isTimelineAssignment = assignmentDiv.closest(
        ".timeline-records, .timeline-row, .timeline-cell",
      );
      if (isTimelineAssignment) {
        // Always prevent native Veracross preview system from interfering for timeline
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }

      // Show details modal when clicking on assignment (but not checkbox or details button)
      if (modalOpenInProgress || instantUpdateInProgress) {
        return;
      }

      const existingModals = document.querySelectorAll(".vch-assignment-modal");
      if (existingModals.length === 0) {
        modalOpenInProgress = true;
        // Get assignment ID and show our modal
        const assignmentId = assignmentDiv.getAttribute(
          "data-custom-assignment-id",
        );
        if (assignmentId) {
          // Find assignment data and show details
          getStorage<CustomAssignment[]>("customAssignments").then((customAssignments) => {
            const assignment = (customAssignments || []).find(
              (a: CustomAssignment) => a.id === assignmentId,
            );
            if (assignment) {
              showCustomAssignmentDetails(assignment);
            }
          });
        }
      }
    }
  },
  true,
);

async function applyCustomAssignments(settings: UserPreferences): Promise<void> {
  if (!settings.enableCustomAssignments) {
    return;
  }

  if (injectionInProgress) {
    return;
  }

  injectionInProgress = true;

  // Check if we're in an iframe context
  const isInIframe = window !== window.top;
  const isTimelineIframe =
    isInIframe &&
    (location.href.includes("planner") ||
      document.querySelector("#planner") ||
      document.querySelector(".timeline-header-y-inner"));

  // Only run assignment functionality in the timeline iframe context
  if (!isTimelineIframe && isInIframe) {
    return;
  }

  // If we're in the main page (not iframe), only add the floating button if on assignments page
  if (!isInIframe) {
    addFloatingAssignmentButton();

    // Set up message listener for button hide/show commands from iframe
    window.addEventListener("message", function (event) {
      if (event.data && event.data.type === "VCH_HIDE_BUTTON") {
        const floatingBtn = document.querySelector(".vch-floating-button") as HTMLElement | null;
        if (floatingBtn) {
          floatingBtn.style.visibility = "hidden";
          floatingBtn.style.opacity = "0";
          floatingBtn.style.pointerEvents = "none";
          floatingBtn.style.transform = "scale(0.8)";
        }
      } else if (event.data && event.data.type === "VCH_SHOW_BUTTON") {
        const floatingBtn = document.querySelector(".vch-floating-button") as HTMLElement | null;
        if (floatingBtn) {
          floatingBtn.style.visibility = "visible";
          floatingBtn.style.opacity = "0.9";
          floatingBtn.style.pointerEvents = "auto";
          floatingBtn.style.transform = "";
        }
      }
    });

    return;
  }

  // Set up message listener for cross-frame communication
  window.addEventListener("message", async function (event) {
    if (event.data && event.data.type === "VCH_REFRESH_ASSIGNMENTS") {
      await instantAssignmentUpdate();
    }
  });

  // Add floating action button for new assignments
  addFloatingAssignmentButton();

  // Load and inject existing custom assignments
  await loadAndInjectCustomAssignments();

  injectionInProgress = false;
}

function addFloatingAssignmentButton() {
  // Only show on assignments page, not everywhere
  const isAssignmentsPage =
    location.pathname.includes("upcoming-assignments") ||
    location.pathname.includes("assignments");

  if (!isAssignmentsPage) {
    // Remove button if it exists and we're not on assignments page
    const existingButton = document.querySelector(".vch-floating-button");
    if (existingButton) {
      existingButton.remove();
    }
    return;
  }

  // Remove existing button if present
  const existingButton = document.querySelector(".vch-floating-button");
  if (existingButton) {
    existingButton.remove();
  }

  // Create floating action button
  const floatingButton = document.createElement("div");
  floatingButton.className = "vch-floating-button";
  floatingButton.innerHTML = `
    <button class="vch-add-assignment-btn" title="Add Custom Assignment">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      Add Assignment
    </button>
  `;

  // Add styles directly to the element
  floatingButton.style.cssText = `
    position: fixed;
    bottom: 30px;
    right: 30px;
    z-index: 9999;
    opacity: 0.9;
    transition: opacity 0.3s ease, transform 0.2s ease;
  `;

  const button = floatingButton.querySelector(".vch-add-assignment-btn") as HTMLButtonElement | null;
  if (!button) return;
  button.style.cssText = `
    background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 12px 20px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3);
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s ease;
    font-family: inherit;
  `;

  button.addEventListener("mouseover", () => {
    button.style.transform = "translateY(-2px)";
    button.style.boxShadow = "0 6px 20px rgba(25, 118, 210, 0.4)";
    floatingButton.style.opacity = "1";
  });

  button.addEventListener("mouseout", () => {
    button.style.transform = "translateY(0)";
    button.style.boxShadow = "0 4px 12px rgba(25, 118, 210, 0.3)";
    floatingButton.style.opacity = "0.9";
  });

  button.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if button is currently hidden (modal open)
    const isHidden =
      floatingButton.style.visibility === "hidden" ||
      floatingButton.style.opacity === "0";
    if (isHidden) {
      return;
    }

    // Prevent rapid clicks and multiple modals
    if (modalOpenInProgress) {
      return;
    }

    const existingModals = document.querySelectorAll(".vch-assignment-modal");
    if (existingModals.length === 0) {
      modalOpenInProgress = true;

      // Force refresh entitlement state from backend before checking
      // This ensures we don't show upgrade modal for subscribed users
      await refreshEntitlementState();

      // Check entitlement before showing assignment modal
      const entitlementResult = await canCreateCustomAssignment();

      if (!entitlementResult.allowed) {
        // Show upgrade modal instead
        showUpgradeModal(entitlementResult.reason, entitlementResult.message);
        return;
      }

      showCustomAssignmentModal();
    }
  });

  document.body.appendChild(floatingButton);
}

async function loadAndInjectCustomAssignments(): Promise<void> {
  const customAssignments = (await getStorage<CustomAssignment[]>("customAssignments")) || [];

  if (!customAssignmentsInjected || customAssignments.length > 0) {
    // Check if we're on the right page type (timeline/planner page or assignments page)
    const isTimelinePage =
      location.pathname.includes("planner") ||
      location.pathname.includes("timeline") ||
      document.querySelector("#planner") ||
      document.querySelector(".timeline-header-y-inner") ||
      document.querySelector(".timeline-records-inner");

    const isAssignmentsPage =
      location.pathname.includes("upcoming-assignments") ||
      location.pathname.includes("assignments");

    if (isTimelinePage) {
      // Wait for timeline to be fully loaded with more attempts
      let attempts = 0;
      const maxAttempts = 10;

      const waitForTimeline = () => {
        const timelineYHeader = document.querySelector(
          ".timeline-header-y-inner",
        );
        const timelineRows = document.querySelectorAll(
          ".timeline-row[data-row-id]",
        );

        if (timelineYHeader && timelineRows.length > 0) {
          injectCustomAssignmentsSidebar(customAssignments as CustomAssignment[]);
          customAssignmentsInjected = true;
        } else {
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(waitForTimeline, 300);
          } else {
            // Timeline wait timed out
          }
        }
      };

      waitForTimeline();
    } else if (isAssignmentsPage) {
      injectCustomAssignmentsToAssignmentsPage(customAssignments as CustomAssignment[]);
      customAssignmentsInjected = true;
    }
  }
}

/**
 * Show upgrade modal when user tries to create custom assignment without entitlement
 * Follows Phase 5 guidelines: calm, informational, optional, non-urgent
 */
function showUpgradeModal(reason: string, message?: string): void {
  // Remove any existing modals
  const existingModals = document.querySelectorAll(".vch-assignment-modal, .vch-upgrade-modal");
  existingModals.forEach((modal) => modal.remove());

  const modal = document.createElement("div");
  modal.className = "vch-upgrade-modal";
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
  `;

  const modalContent = document.createElement("div");
  modalContent.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 32px;
    width: 90%;
    max-width: 420px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
    text-align: center;
  `;

  // Calm, non-urgent messaging (from PHASE 5.md)
  modalContent.innerHTML = `
    <div style="margin-bottom: 24px;">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#1976d2" stroke-width="1.5" style="margin-bottom: 16px;">
        <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
        <path d="M2 17l10 5 10-5"></path>
        <path d="M2 12l10 5 10-5"></path>
      </svg>
      <h3 style="margin: 0 0 12px 0; color: #333; font-size: 20px; font-weight: 600;">
        Custom Assignments
      </h3>
      <p style="margin: 0 0 8px 0; color: #666; font-size: 15px; line-height: 1.5;">
        Custom assignments are part of Veracross Plus Cloud.
      </p>
      <p style="margin: 0; color: #666; font-size: 14px; line-height: 1.5;">
        They let you add personal tasks that sync across devices and are safely backed up.
      </p>
    </div>

    <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: center; gap: 24px; margin-bottom: 8px;">
        <div>
          <div style="font-size: 20px; font-weight: 600; color: #333;">$2.99</div>
          <div style="font-size: 12px; color: #666;">/month</div>
        </div>
        <div style="border-left: 1px solid #ddd;"></div>
        <div>
          <div style="font-size: 20px; font-weight: 600; color: #333;">$24.99</div>
          <div style="font-size: 12px; color: #666;">/year</div>
          <div style="font-size: 10px; color: #4caf50; font-weight: 500;">Save 30%</div>
        </div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 12px;">
      <button id="vch-upgrade-yearly" style="
        background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 14px 24px;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
        font-family: inherit;
      ">
        Enable Cloud Features — Yearly
      </button>
      <button id="vch-upgrade-monthly" style="
        background: white;
        color: #1976d2;
        border: 1px solid #1976d2;
        border-radius: 8px;
        padding: 12px 24px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
      ">
        Enable Cloud Features — Monthly
      </button>
      <button id="vch-upgrade-cancel" style="
        background: transparent;
        color: #666;
        border: none;
        padding: 12px 24px;
        font-size: 14px;
        cursor: pointer;
        font-family: inherit;
      ">
        Keep using local mode
      </button>
    </div>

    <p style="margin: 16px 0 0 0; color: #999; font-size: 12px;">
      You can keep using all existing assignments for free.
    </p>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  const closeModal = () => {
    modal.remove();
    modalOpenInProgress = false;

    // Show floating button again
    const floatingBtn = document.querySelector(".vch-floating-button") as HTMLElement | null;
    if (floatingBtn) {
      floatingBtn.style.visibility = "visible";
      floatingBtn.style.opacity = "0.9";
      floatingBtn.style.pointerEvents = "auto";
    }
  };

  // Handle click outside
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Cancel button
  const cancelBtn = document.getElementById("vch-upgrade-cancel");
  cancelBtn?.addEventListener("click", closeModal);

  // Upgrade buttons
  const yearlyBtn = document.getElementById("vch-upgrade-yearly");
  yearlyBtn?.addEventListener("click", async () => {
    yearlyBtn.textContent = "Loading...";
    yearlyBtn.setAttribute("disabled", "true");

    const result = await createCheckoutSession("yearly");
    if (result.success && result.checkoutUrl) {
      window.open(result.checkoutUrl, "_blank");
      closeModal();
    } else {
      yearlyBtn.textContent = "Enable Cloud Features — Yearly";
      yearlyBtn.removeAttribute("disabled");
      alert(result.error || "Failed to start checkout. Please try again.");
    }
  });

  const monthlyBtn = document.getElementById("vch-upgrade-monthly");
  monthlyBtn?.addEventListener("click", async () => {
    monthlyBtn.textContent = "Loading...";
    monthlyBtn.setAttribute("disabled", "true");

    const result = await createCheckoutSession("monthly");
    if (result.success && result.checkoutUrl) {
      window.open(result.checkoutUrl, "_blank");
      closeModal();
    } else {
      monthlyBtn.textContent = "Enable Cloud Features — Monthly";
      monthlyBtn.removeAttribute("disabled");
      alert(result.error || "Failed to start checkout. Please try again.");
    }
  });
}

function showCustomAssignmentModal(prefillData: Partial<CustomAssignment> = {}): void {
  // Remove any existing modals first
  const existingModals = document.querySelectorAll(".vch-assignment-modal");
  existingModals.forEach((modal) => modal.remove());

  // Clean up body overflow
  document.body.style.overflow = "";

  // Set flag to indicate modal is being opened
  modalOpenInProgress = true;

  const isEditing = !!prefillData.id;

  // Create modal
  const modal = document.createElement("div");
  modal.className = "vch-assignment-modal";
  modal.setAttribute("data-vch-modal", "true");
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
    overflow: hidden;
  `;

  // Prevent body scrolling when modal is open
  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";

  const modalContent = document.createElement("div");
  modalContent.className = "vch-modal-content";
  modalContent.setAttribute("data-vch-modal-content", "true");
  modalContent.style.cssText = `
    background: white;
    border-radius: 8px;
    padding: 24px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    position: relative;
    box-sizing: border-box;
    margin: 20px;
  `;

  modalContent.innerHTML = `
    <h3 style="margin: 0 0 20px 0; color: #333; font-size: 20px; word-wrap: break-word;">
      ${isEditing ? "Edit Assignment" : "Add Custom Assignment"}
    </h3>
    <form id="vch-assignment-form">
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: #333;">Assignment Title *</label>
        <input type="text" id="vch-title" required style="width: 100%; max-width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" value="${prefillData.title || ""}">
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: #333;">Description</label>
        <textarea id="vch-description" style="width: 100%; max-width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-height: 80px; resize: vertical; box-sizing: border-box;" placeholder="Assignment details...">${prefillData.description || ""}</textarea>
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: #333;">Due Date *</label>
        <input type="date" id="vch-due-date" required style="width: 100%; max-width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" value="${prefillData.dueDate || ""}">
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: #333;">Class/Subject</label>
        <input type="text" id="vch-class" style="width: 100%; max-width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" placeholder="e.g., Mathematics, English" value="${prefillData.className || ""}">
      </div>



      <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; flex-wrap: wrap;">
        <button type="button" id="vch-cancel" style="padding: 10px 20px; background: #f8f9fa; color: #6c757d; border: 1px solid #dee2e6; border-radius: 4px; cursor: pointer; font-size: 14px; flex-shrink: 0; font-family: inherit; text-transform: none; font-weight: normal; letter-spacing: normal;">Cancel</button>
        <button type="submit" id="vch-submit" style="padding: 10px 20px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; flex-shrink: 0; font-family: inherit; text-transform: none; font-weight: normal; letter-spacing: normal; text-shadow: none; font-variant: normal;"></button>
      </div>
    </form>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Immediately mark as protected to prevent any interference
  modal.classList.add("vch-protected");
  modalContent.classList.add("vch-protected");

  // Set button text cleanly
  const submitButton = modalContent.querySelector("#vch-submit");
  if (submitButton) {
    submitButton.textContent = isEditing
      ? "Update Assignment"
      : "Save Assignment";
  }

  // Prevent multiple modals by adding a flag
  modal.setAttribute("data-modal-active", "true");

  // Hide floating button completely while modal is open
  const floatingBtn = document.querySelector(".vch-floating-button") as HTMLElement | null;
  if (floatingBtn) {
    floatingBtn.style.visibility = "hidden";
    floatingBtn.style.opacity = "0";
    floatingBtn.style.pointerEvents = "none";
    floatingBtn.style.transform = "scale(0.8)";
  }

  // Event handlers
  const closeModal = () => {
    // Show floating button using postMessage if in iframe
    if (window !== window.top && window.top) {
      try {
        window.top.postMessage({ type: "VCH_SHOW_BUTTON" }, "*");
      } catch (e) {
        // Silent error handling
      }
    } else {
      // If not in iframe, show directly
      const floatingBtn = document.querySelector(".vch-floating-button") as HTMLElement | null;
      if (floatingBtn) {
        floatingBtn.style.visibility = "visible";
        floatingBtn.style.opacity = "0.9";
        floatingBtn.style.pointerEvents = "auto";
        floatingBtn.style.transform = "";
      }
    }
    modal.remove();
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    // Reset the flag to allow new modals
    modalOpenInProgress = false;
  };

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Reset flag after modal is fully created and visible
  setTimeout(() => {
    modalOpenInProgress = false;
  }, 100);

  const cancelBtn = document.getElementById("vch-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      closeModal();
    });
  }

  const form = document.getElementById("vch-assignment-form");
  if (form) {
    form.addEventListener("submit", async (e: Event) => {
      e.preventDefault();

      const titleEl = document.getElementById("vch-title") as HTMLInputElement | null;
      const descriptionEl = document.getElementById("vch-description") as HTMLTextAreaElement | null;
      const dueDateEl = document.getElementById("vch-due-date") as HTMLInputElement | null;
      const classEl = document.getElementById("vch-class") as HTMLInputElement | null;

      if (!titleEl || !dueDateEl) return;

      const assignment: CustomAssignment = {
        id: prefillData.id || generateId(),
        title: titleEl.value,
        description: descriptionEl?.value || "",
        dueDate: dueDateEl.value,
        className: classEl?.value || "",
        assignmentType: "custom",
        source: "custom",
        createdAt: prefillData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveCustomAssignment(assignment);

      // Instantly update UI before closing modal
      const isInIframe = window !== window.top;
      if (isInIframe) {
        // We're in the iframe, directly refresh
        await instantAssignmentUpdate();
      } else {
        // We're in the main page, send message to iframe
        const iframe = document.querySelector("iframe.old-portals-iframe") as HTMLIFrameElement | null;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(
            {
              type: "VCH_REFRESH_ASSIGNMENTS",
              assignment: assignment,
            },
            "*",
          );
        }
      }

    });
  }
}

async function refreshCustomAssignmentsWithRetry(retries = 3): Promise<void> {
  try {
    await refreshCustomAssignments();

    // Quick verification that assignments are visible
    setTimeout(async () => {
      const customAssignments = (await getStorage<CustomAssignment[]>("customAssignments")) || ([] as CustomAssignment[]);
      const assignmentElements = document.querySelectorAll(
        "[data-custom-assignment-id]",
      );

      if (
        customAssignments.length > 0 &&
        assignmentElements.length === 0 &&
        retries > 0
      ) {
        await refreshCustomAssignmentsWithRetry(retries - 1);
      } else if (assignmentElements.length > 0) {
        // Success - assignments are now visible
      } else if (customAssignments.length === 0) {
        // No assignments in storage to display
      } else {
        // No more retries left
      }
    }, 500);
  } catch (error) {
    if (retries > 0) {
      setTimeout(() => refreshCustomAssignmentsWithRetry(retries - 1), 1000);
    }
  }
}

async function refreshCustomAssignments() {
  if (injectionInProgress || instantUpdateInProgress) {
    return;
  }

  injectionInProgress = true;

  // Get fresh data from storage
  const customAssignments = (await getStorage("customAssignments")) || [];

  // Reset injection state completely
  customAssignmentsInjected = false;

  // Remove all existing custom assignment elements with more thorough cleanup
  const elementsToRemove = document.querySelectorAll(
    ".vch-custom-class-row, .vch-custom-timeline-row, .vch-custom-assignment, .vch-custom-assignments-section, [data-vch-custom='true'], [data-custom-assignment-id]",
  );

  elementsToRemove.forEach((el: Element) => {
    // Clean up any observers
    const elWithObserver = el as Element & { _vchObserver?: MutationObserver };
    if (elWithObserver._vchObserver) {
      elWithObserver._vchObserver.disconnect();
    }
    el.remove();
  });

  // Quick DOM cleanup - no delay needed for instant updates
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Check if we're still on a supported page (use same logic as initial detection)

  const isTimelinePage =
    location.pathname.includes("planner") ||
    location.pathname.includes("timeline") ||
    document.querySelector("#planner") ||
    document.querySelector(".timeline-header-y-inner") ||
    document.querySelector(".timeline-records-inner");

  const isAssignmentsPage =
    location.pathname.includes("upcoming-assignments") ||
    location.pathname.includes("assignments");

  if (isTimelinePage) {
    // Use the more robust injection method that waits for elements
    await loadAndInjectCustomAssignments();
  } else if (isAssignmentsPage) {
    injectCustomAssignmentsToAssignmentsPage(customAssignments as CustomAssignment[]);
    customAssignmentsInjected = true;
  }

  injectionInProgress = false;
}

function injectCustomAssignmentsToAssignmentsPage(customAssignments: CustomAssignment[]): void {
  try {
    if (!customAssignments || customAssignments.length === 0) {
      return;
    }

    // Find the assignments container
    let assignmentsContainer = document.querySelector(
      ".assignment-center-column, .upcoming-assignment, .assignment-list, .content-2-columns .x-column-inner",
    );

    if (!assignmentsContainer) {
      const alternativeSelectors = [
        "main",
        ".main",
        ".main-content",
        ".content-area",
        ".content-2-columns",
        ".x-column-inner",
        ".assignment-center-column",
        ".upcoming-assignment",
        ".assignment-list",
        ".content-2-columns .x-column-inner",
        "[class*='content']:not([class*='vch']):not(button)",
        "[class*='assignment']:not([class*='vch']):not(button)",
        "section:not([class*='vch'])",
        "article:not([class*='vch'])",
      ];

      for (const selector of alternativeSelectors) {
        const container = document.querySelector(selector);
        if (
          container &&
          !container.closest(".vch-floating-add-btn") &&
          !container.classList.contains("vch-floating-add-btn") &&
          !container.classList.contains("vch-add-assignment-btn")
        ) {
          // Use this container and continue with injection
          assignmentsContainer = container;
          break;
        }
      }

      // Final fallback: try to find any existing assignment-like elements and inject near them
      if (!assignmentsContainer) {
        const existingAssignments = document.querySelectorAll(
          '[class*="assignment"], [class*="due"], .row, .item, .card',
        );

        if (existingAssignments.length > 0) {
          // Filter out elements that are inside the floating button or other unwanted containers
          const validAssignments = Array.from(existingAssignments).filter(
            (el) => {
              return (
                !el.closest(".vch-floating-add-btn") &&
                !el.closest(".vch-assignment-modal") &&
                !el.closest("button") &&
                !el.classList.contains("vch-add-assignment-btn")
              );
            },
          );

          if (validAssignments.length > 0) {
            // Find the parent container of the first valid assignment-like element
            let parentContainer = validAssignments[0].parentElement;
            while (parentContainer && parentContainer.tagName !== "BODY") {
              // Look for a good parent that's not too specific and not the floating button
              if (
                !parentContainer.closest(".vch-floating-add-btn") &&
                !parentContainer.classList.contains("vch-floating-add-btn") &&
                (parentContainer.children.length > 1 ||
                  parentContainer.classList.contains("content") ||
                  parentContainer.classList.contains("main") ||
                  parentContainer.tagName === "MAIN")
              ) {
                assignmentsContainer = parentContainer;
                break;
              }
              parentContainer = parentContainer.parentElement;
            }
          }
        }
      }

      // If we still don't have a container, try to find the main page content
      if (!assignmentsContainer) {
        // Look for common page structure elements
        const mainContentSelectors = [
          "main",
          ".main",
          "#main",
          ".page-content",
          ".main-content",
          ".content",
          "[role='main']",
          "body > div:not(.vch-floating-add-btn)",
          "body > *:not(script):not(style):not(.vch-floating-add-btn)",
        ];

        for (const selector of mainContentSelectors) {
          const element = document.querySelector(selector);
          if (element && !element.closest(".vch-floating-add-btn")) {
            assignmentsContainer = element;
            break;
          }
        }
      }

      // Final fallback: create a container in body but not as last child (avoid button area)
      if (!assignmentsContainer) {
        assignmentsContainer = document.createElement("div");
        (assignmentsContainer as HTMLElement).style.cssText = "margin: 20px; padding: 0;";
        // Insert as first child of body to avoid floating button area
        document.body.insertBefore(
          assignmentsContainer,
          document.body.firstChild,
        );
      }
    }

    // Remove existing custom assignments section
    const existingSection = assignmentsContainer.querySelector(
      ".vch-custom-assignments-section",
    );
    if (existingSection) {
      existingSection.remove();
    }

    // Create custom assignments section with original styling
    const customSection = document.createElement("div");
    customSection.className = "vch-custom-assignments-section";
    customSection.innerHTML = `
    <div style="margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">
        📚 Custom Assignments (${customAssignments.length})
      </h3>
      <div class="vch-custom-assignments-list"></div>
    </div>
  `;

    const customList = customSection.querySelector(
      ".vch-custom-assignments-list",
    );

    if (!customList) return;

    // Sort assignments by due date
    const sortedAssignments = [...customAssignments].sort(
      (a: CustomAssignment, b: CustomAssignment) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
    );

    // Create assignment elements
    sortedAssignments.forEach((assignment) => {
      const assignmentEl = document.createElement("div");
      assignmentEl.className = "vch-custom-assignment";
      assignmentEl.setAttribute("data-custom-assignment-id", assignment.id);
      assignmentEl.setAttribute("data-vch-custom", "true");

      const dueDate = new Date(assignment.dueDate);
      const formattedDate = dueDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });

      assignmentEl.innerHTML = `
      <div style="padding: 8px 12px; margin: 5px 0; border-left: 4px solid #007cba; background-color: white; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: between; align-items: center;">
          <div style="flex: 1;">
            <div style="font-weight: bold; color: #333; margin-bottom: 2px;">
              ${escapeHtml(assignment.title)}
            </div>
            <div style="font-size: 12px; color: #666;">
              Due: ${formattedDate}
            </div>
            ${assignment.description ? `<div style="font-size: 12px; color: #888; margin-top: 4px;">${escapeHtml(assignment.description)}</div>` : ""}
          </div>
          <div style="margin-left: 10px;">
            <button class="vch-assignment-details" data-assignment-id="${assignment.id}" style="padding: 4px 8px; background: #007cba; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
              Details
            </button>
          </div>
        </div>
      </div>
    `;

      if (customList) {
        customList.appendChild(assignmentEl);
      }
    });

    // Insert at the top of the assignments container
    assignmentsContainer.insertBefore(
      customSection,
      assignmentsContainer.firstChild,
    );

    // Add click handlers for details buttons
    customSection.addEventListener("click", (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.classList.contains("vch-assignment-details")) {
        const assignmentId = target.getAttribute("data-assignment-id");
        const assignment = customAssignments.find((a: CustomAssignment) => a.id === assignmentId);
        if (assignment) {
          showCustomAssignmentDetails(assignment);
        }
      }
    });
  } catch (error) {
    // Silent error handling
  }
}

async function saveCustomAssignment(assignment: CustomAssignment): Promise<void> {
  const customAssignments = (await getStorage<CustomAssignment[]>("customAssignments")) || [];

  // If assignment has an ID, update existing; otherwise add new
  const existingIndex = customAssignments.findIndex(
    (a: CustomAssignment) => a.id === assignment.id,
  );
  if (existingIndex >= 0) {
    customAssignments[existingIndex] = assignment;
  } else {
    customAssignments.push(assignment);
  }

  await setStorage({ customAssignments });
}

async function immediatelyInjectNewAssignment(assignment: CustomAssignment): Promise<void> {
  await instantAssignmentUpdate();
}

async function instantAssignmentUpdate() {
  if (injectionInProgress || instantUpdateInProgress) {
    return;
  }

  instantUpdateInProgress = true;

  // Check if we're in the correct context (timeline iframe)
  const isInIframe = window !== window.top;
  const isTimelineIframe =
    isInIframe &&
    (location.href.includes("planner") ||
      document.querySelector("#planner") ||
      document.querySelector(".timeline-header-y-inner"));

  if (!isTimelineIframe) {
    instantUpdateInProgress = false;
    return;
  }

  try {
    const customAssignments = (await getStorage("customAssignments")) || [];

    // Check if timeline elements exist
    const timelineElementsExist = !!(
      document.querySelector(".timeline-row") ||
      document.querySelector(".timeline-cell") ||
      document.querySelector(".timeline-header-y-inner") ||
      document.querySelector(".timeline-records-inner") ||
      document.querySelector("#planner")
    );

    if (!timelineElementsExist) {
      instantUpdateInProgress = false;
      return;
    }

    // Update existing elements without removing them first (no flicker)
    const existingSidebar = document.querySelector(
      ".vch-custom-assignments-sidebar",
    );
    const existingTimelineRow = document.querySelector(
      ".vch-custom-timeline-row",
    );

    // Update sidebar content instantly
    if (existingSidebar) {
      updateSidebarContent(existingSidebar, customAssignments as CustomAssignment[]);
    }

    // Update timeline row content instantly
    if (existingTimelineRow) {
      updateTimelineRowContent(existingTimelineRow, customAssignments as CustomAssignment[]);
    }

    // Only create new elements if neither exists (initial load scenario)
    if (!existingSidebar && !existingTimelineRow) {
      injectCustomAssignmentsSidebar(customAssignments as CustomAssignment[]);
      injectCustomAssignmentsTimeline(customAssignments as CustomAssignment[]);
    }

    // Add persistence check - verify timeline row still exists after a brief delay
    setTimeout(() => {
      const timelineRowCheck = document.querySelector(
        ".vch-custom-timeline-row",
      );
      const assignmentsArray = customAssignments as CustomAssignment[];
      if (!timelineRowCheck && assignmentsArray.length > 0) {
        injectCustomAssignmentsTimeline(assignmentsArray);
      }
    }, 50);

    customAssignmentsInjected = true;
    instantUpdateInProgress = false;
  } catch (error) {
    instantUpdateInProgress = false;
    // Fallback to standard refresh
    setTimeout(async () => {
      await immediatelyRefreshAssignments();
    }, 10);
  }
}

async function immediatelyRefreshAssignments() {
  if (injectionInProgress || instantUpdateInProgress) {
    return;
  }

  // Check if we're in the correct context (timeline iframe)
  const isInIframe = window !== window.top;
  const isTimelineIframe =
    isInIframe &&
    (location.href.includes("planner") ||
      document.querySelector("#planner") ||
      document.querySelector(".timeline-header-y-inner"));

  if (!isTimelineIframe) {
    return;
  }

  try {
    const customAssignments = (await getStorage("customAssignments")) || [];

    // Check if timeline elements exist
    const timelineElementsExist = !!(
      document.querySelector(".timeline-row") ||
      document.querySelector(".timeline-cell") ||
      document.querySelector(".timeline-header-y-inner") ||
      document.querySelector(".timeline-records-inner") ||
      document.querySelector("#planner")
    );

    if (!timelineElementsExist) {
      return;
    }

    // Always try to update existing elements first, only create if none exist
    const existingSidebar = document.querySelector(
      ".vch-custom-assignments-sidebar",
    );
    const existingTimelineRow = document.querySelector(
      ".vch-custom-timeline-row",
    );

    // Update sidebar content
    if (existingSidebar) {
      updateSidebarContent(existingSidebar, customAssignments as CustomAssignment[]);
    }

    // Update timeline row content
    if (existingTimelineRow) {
      updateTimelineRowContent(existingTimelineRow, customAssignments as CustomAssignment[]);
    }

    // Only create new elements if neither exists (initial load scenario)
    if (!existingSidebar && !existingTimelineRow) {
      injectCustomAssignmentsSidebar(customAssignments as CustomAssignment[]);
      injectCustomAssignmentsTimeline(customAssignments as CustomAssignment[]);
    }

    customAssignmentsInjected = true;
  } catch (error) {
    // Fallback to the retry mechanism if immediate refresh fails
    setTimeout(async () => {
      await refreshCustomAssignmentsWithRetry(3);
    }, 10);
  }
}

function updateSidebarContent(sidebar: Element, customAssignments: CustomAssignment[]): void {
  const assignmentsList = sidebar.querySelector(".vch-assignments-list");
  if (!assignmentsList) return;

  // Clear and rebuild the assignments list
  assignmentsList.innerHTML = "";

  if (customAssignments.length === 0) {
    assignmentsList.innerHTML = `<div style="text-align: center; color: #666; font-style: italic; padding: 20px;">No custom assignments</div>`;
    return;
  }

  // Group assignments by date
  const groupedAssignments: Record<string, CustomAssignment[]> = {};
  customAssignments.forEach((assignment: CustomAssignment) => {
    const dateKey = assignment.dueDate;
    if (!groupedAssignments[dateKey]) {
      groupedAssignments[dateKey] = [];
    }
    groupedAssignments[dateKey].push(assignment);
  });

  // Sort dates and create sections
  const sortedDates = Object.keys(groupedAssignments).sort();
  sortedDates.forEach((date) => {
    const dateSection = document.createElement("div");
    dateSection.className = "vch-date-section";

    const dateHeader = document.createElement("h4");
    dateHeader.textContent = formatDate(date);
    dateHeader.style.cssText = `
      margin: 12px 0 6px 0;
      font-size: 12px;
      font-weight: 600;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    dateSection.appendChild(dateHeader);

    groupedAssignments[date].forEach((assignment: CustomAssignment) => {
      const assignmentElement = createCustomAssignmentElement(assignment);
      if (assignmentElement) {
        dateSection.appendChild(assignmentElement);
      }
    });

    assignmentsList.appendChild(dateSection);
  });

  // Update the count in the header
  const header = sidebar.querySelector("h3");
  if (header) {
    header.innerHTML = `📚 Custom Assignments (${customAssignments.length})`;
  }
}

function updateTimelineRowContent(timelineRow: Element, customAssignments: CustomAssignment[]): void {
  // Get timeline cells
  const timelineCells = timelineRow.querySelectorAll(".timeline-cell");

  // Create a map of existing assignments by ID for comparison
  const existingAssignments = new Map<string, Element>();
  timelineRow.querySelectorAll(".vch-custom-assignment").forEach((el: Element) => {
    const id = el.getAttribute("data-custom-assignment-id");
    if (id) {
      existingAssignments.set(id, el);
    }
  });

  // Track which assignments we've processed
  const processedIds = new Set<string>();

  customAssignments.forEach((assignment: CustomAssignment, index: number) => {
    // Parse date in local timezone to avoid UTC shift issues
    const dateParts = assignment.dueDate.split("-");
    const assignmentDate = new Date(
      parseInt(dateParts[0], 10), // year
      parseInt(dateParts[1], 10) - 1, // month (0-based)
      parseInt(dateParts[2], 10), // day
    );

    const columnIndex = getColumnIndexForDate(assignmentDate);

    processedIds.add(assignment.id);

    // If assignment already exists in the right place, skip it
    const existingElement = existingAssignments.get(assignment.id);
    if (
      existingElement &&
      columnIndex >= 0 &&
      columnIndex < timelineCells.length
    ) {
      const existingCell = existingElement.closest(".timeline-cell");
      const targetCell = columnIndex >= 0 ? timelineCells[columnIndex] : null;

      if (existingCell === targetCell) {
        return;
      } else {
        // Move it to the correct cell
        existingElement.remove();
      }
    }

    if (columnIndex >= 0 && columnIndex < timelineCells.length) {
      const cell = timelineCells[columnIndex];
      const assignmentElement = createTimelineAssignmentElement(assignment, timelineRow);

      cell.appendChild(assignmentElement);
    }
  });

  // Remove any assignments that are no longer in the customAssignments array
  existingAssignments.forEach((element, id) => {
    if (!processedIds.has(id)) {
      element.remove();
    }
  });
}

function getColumnIndexForDate(assignmentDate: Date): number {
  // Use the exact same selector as the working initial load code
  const headerCells = document.querySelectorAll(
    ".timeline-header-x-inner .timeline-cell",
  );

  // Parse assignment date components in local timezone
  const assignmentYear = assignmentDate.getFullYear();
  const assignmentMonth = assignmentDate.getMonth();
  const assignmentDay = assignmentDate.getDate();

  for (let i = 0; i < headerCells.length; i++) {
    const headerCell = headerCells[i];

    // Extract header text using the same logic as getCustomAssignmentsForDate
    let headerText = headerCell.querySelector("h4")?.textContent?.trim();

    // If h4 doesn't exist or doesn't contain a date, try other selectors
    if (!headerText || !headerText.includes(",")) {
      headerText = headerCell.querySelector("div")?.textContent?.trim();
      if (!headerText || !headerText.includes(",")) {
        headerText = headerCell.textContent?.trim();
      }
    }

    // Additional cleanup for header text
    if (headerText) {
      headerText = headerText.replace(/\s+/g, " ").trim();
    }

    // Skip invalid headers
    if (
      !headerText ||
      !headerText.includes(",") ||
      headerText.includes("ASSIGNMENTS DUE") ||
      headerText.match(/^\d+\s+ASSIGNMENTS DUE/)
    ) {
      continue;
    }

    // Parse the date from header text using the same logic as parseHeaderDate
    const headerDate = parseHeaderDate(headerText);
    if (!headerDate) {
      continue;
    }

    // Direct date comparison - now that parseHeaderDate handles years correctly
    const matches =
      headerDate.getFullYear() === assignmentYear &&
      headerDate.getMonth() === assignmentMonth &&
      headerDate.getDate() === assignmentDay;

    if (matches) {
      return i;
    }
  }

  return -1;
}

function parseColumnDateFormat(dateFormat: string): string | null {
  // Parse date_format like "Wednesday, Sep 03" to YYYY-MM-DD
  const dateMatch = dateFormat.match(/(\w+),?\s+(\w+)\s+(\d+)/);
  if (dateMatch) {
    const [, , monthName, day] = dateMatch;
    const monthMap = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
      January: 0,
      February: 1,
      March: 2,
      April: 3,
      // May is already defined above (same in abbreviated and full form)
      June: 5,
      July: 6,
      August: 7,
      September: 8,
      October: 9,
      November: 10,
      December: 11,
    };

    const monthNumber =
      monthMap[monthName as keyof typeof monthMap] || monthMap[monthName.substring(0, 3) as keyof typeof monthMap];
    if (monthNumber !== undefined) {
      const currentYear = new Date().getFullYear();
      const date = new Date(currentYear, monthNumber, parseInt(day));
      return date.toISOString().split("T")[0];
    }
  }
  return null;
}

async function deleteCustomAssignment(assignmentId: string): Promise<void> {
  const customAssignments = (await getStorage<CustomAssignment[]>("customAssignments")) || [];
  const filteredAssignments = customAssignments.filter(
    (a: CustomAssignment) => a.id !== assignmentId,
  );
  await setStorage({ customAssignments: filteredAssignments });

  // Check if we're in iframe or main page and handle accordingly
  const isInIframe = window !== window.top;
  if (isInIframe) {
    // We're in the iframe, directly refresh
    await instantAssignmentUpdate();
  } else {
    // We're in the main page, send message to iframe
    const iframe = document.querySelector("iframe.old-portals-iframe") as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        {
          type: "VCH_REFRESH_ASSIGNMENTS",
        },
        "*",
      );
    }
  }
}

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function injectCustomAssignmentsSidebar(customAssignments: CustomAssignment[]): void {
  try {
    // Validate that customAssignments is an array
    if (!Array.isArray(customAssignments)) {
      return;
    }

    // Find the Veracross timeline Y-axis header (sidebar with class names)
    const timelineYHeader = document.querySelector(".timeline-header-y-inner");

    if (!timelineYHeader) {
      // Try to find other possible containers
      const alternativeContainers = [
        ".timeline-header-y",
        ".timeline-left",
        ".left-panel",
        ".sidebar",
        ".timeline-table .timeline-header-y",
        "#planner .timeline-header-y",
      ];

      let container = null;
      for (const selector of alternativeContainers) {
        container = document.querySelector(selector);
        if (container) {
          break;
        }
      }

      if (container) {
        injectCustomAssignmentsSidebarToContainer(container, customAssignments);
        // Always inject timeline row when sidebar is injected to maintain alignment
        injectCustomAssignmentsTimeline(customAssignments);
      }
      return;
    }

    injectCustomAssignmentsSidebarToContainer(
      timelineYHeader,
      customAssignments,
    );
    injectCustomAssignmentsTimeline(customAssignments);
  } catch (error) {
    // Error injecting custom assignments
  }
}

function injectCustomAssignmentsSidebarToContainer(
  container: Element,
  customAssignments: CustomAssignment[],
): void {
  // Validate inputs
  if (!container || !container.querySelector) {
    return;
  }

  if (!Array.isArray(customAssignments)) {
    return;
  }

  // Remove existing custom assignments row and its observer
  const existingRow = container.querySelector(".vch-custom-class-row") as Element & { _vchObserver?: MutationObserver } | null;
  if (existingRow) {
    // Clean up any existing mutation observers
    if (existingRow._vchObserver) {
      existingRow._vchObserver.disconnect();
    }
    existingRow.remove();
  }

  // Create custom assignments timeline row that matches Veracross structure
  const customRow = document.createElement("div");

  // Copy exact structure and styling from native rows
  const firstExistingRow = document.querySelector(
    ".timeline-header-y-inner .timeline-row[data-row-id]:not(.vch-custom-class-row)",
  );
  if (firstExistingRow) {
    // Copy all classes and add our custom identifier
    customRow.className = firstExistingRow.className + " vch-custom-class-row";
    customRow.setAttribute("data-row-id", "custom-assignments");

    // Copy all positioning and layout styles
    const computedStyle = window.getComputedStyle(firstExistingRow);
    customRow.style.height = computedStyle.height;
    customRow.style.margin = computedStyle.margin;
    customRow.style.padding = computedStyle.padding;
    customRow.style.border = computedStyle.border;
    customRow.style.position = computedStyle.position;
    customRow.style.left = computedStyle.left;
    customRow.style.right = computedStyle.right;
    customRow.style.display = computedStyle.display;
    customRow.style.boxSizing = computedStyle.boxSizing;
  } else {
    customRow.className = "timeline-row vch-custom-class-row";
    customRow.setAttribute("data-row-id", "custom-assignments");
    customRow.style.cssText = `
      height: auto;
      min-height: 60px;
    `;
  }

  // Create timeline cell to match Veracross structure
  const timelineCell = document.createElement("div");

  // Copy cell styling from native cells
  if (firstExistingRow) {
    const firstExistingCell = firstExistingRow.querySelector(".timeline-cell");
    if (firstExistingCell) {
      timelineCell.className = firstExistingCell.className;
      const cellStyle = window.getComputedStyle(firstExistingCell);
      timelineCell.style.margin = cellStyle.margin;
      timelineCell.style.padding = cellStyle.padding;
      timelineCell.style.border = cellStyle.border;
      timelineCell.style.position = cellStyle.position;
      timelineCell.style.textAlign = cellStyle.textAlign;
      timelineCell.style.verticalAlign = cellStyle.verticalAlign;
    } else {
      timelineCell.className = "timeline-cell";
    }
  } else {
    timelineCell.className = "timeline-cell";
  }

  // Create expand/collapse title link (matching Veracross structure)
  const titleLink = document.createElement("a");

  // Copy title link styling from native rows
  if (firstExistingRow) {
    const nativeTitleLink = firstExistingRow.querySelector("a.title");
    if (nativeTitleLink) {
      titleLink.className = nativeTitleLink.className;
      const titleStyle = window.getComputedStyle(nativeTitleLink);
      titleLink.style.margin = titleStyle.margin;
      titleLink.style.padding = titleStyle.padding;
      titleLink.style.fontSize = titleStyle.fontSize;
      titleLink.style.fontWeight = titleStyle.fontWeight;
      titleLink.style.color = titleStyle.color;
      titleLink.style.textDecoration = titleStyle.textDecoration;
      titleLink.style.display = titleStyle.display;
      titleLink.style.textAlign = titleStyle.textAlign;
    } else {
      titleLink.className = "title";
    }
  } else {
    titleLink.className = "title";
  }

  titleLink.href = "#";
  titleLink.setAttribute("title", "Custom Assignments");
  titleLink.setAttribute("data-toggle-row", "true");

  // Create title text without expand arrow (like native classes)
  const titleText = document.createTextNode("Custom Assignments");
  titleLink.appendChild(titleText);

  // Create subtitle (teacher info)
  const subtitle = document.createElement("p");

  // Copy subtitle styling from native rows
  if (firstExistingRow) {
    const nativeSubtitle = firstExistingRow.querySelector("p.subtitle");
    if (nativeSubtitle) {
      subtitle.className = nativeSubtitle.className;
      const subtitleStyle = window.getComputedStyle(nativeSubtitle);
      subtitle.style.margin = subtitleStyle.margin;
      subtitle.style.padding = subtitleStyle.padding;
      subtitle.style.fontSize = subtitleStyle.fontSize;
      subtitle.style.fontWeight = subtitleStyle.fontWeight;
      subtitle.style.color = subtitleStyle.color;
      subtitle.style.fontStyle = subtitleStyle.fontStyle;
    } else {
      subtitle.className = "subtitle";
    }
  } else {
    subtitle.className = "subtitle";
  }

  subtitle.textContent = "Student Created";

  // Create tools section with view all link
  const tools = document.createElement("div");
  tools.className = "tools";

  const viewAllLink = document.createElement("a");
  viewAllLink.href = "#";
  viewAllLink.textContent = "view all assignments";
  viewAllLink.setAttribute("title", "Open All Custom Assignments");
  viewAllLink.addEventListener("click", (e) => {
    e.preventDefault();
    // Could implement a modal or detailed view here
  });

  tools.appendChild(viewAllLink);

  // Make this row immune to native Veracross show/hide
  customRow.setAttribute("data-vch-custom", "true");

  // Prevent native Veracross show/hide from affecting our custom row
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "style"
      ) {
        const target = mutation.target as HTMLElement;
        if (target === customRow && target.hasAttribute("data-vch-custom")) {
          // Keep our custom row always visible and at fixed height
          if (target.style.display === "none") {
            target.style.display = "";
          }
          // Prevent height changes from native Veracross
          if (target.style.height !== "90px") {
            target.style.height = "90px";
            target.style.minHeight = "90px";
            target.style.maxHeight = "90px";

            // Also fix divider cell heights
            const dividerCells = target.querySelectorAll(
              ".timeline-cell.divider",
            );
            dividerCells.forEach((cell: Element) => {
              (cell as HTMLElement).style.height = "90px";
            });
          }
        }
      }
    });
  });

  observer.observe(customRow, {
    attributes: true,
    attributeFilter: ["style"],
    subtree: true,
  });

  // Store observer reference for cleanup
  (customRow as HTMLDivElement & { _vchObserver?: MutationObserver })._vchObserver = observer;

  // Assemble the timeline cell
  timelineCell.appendChild(titleLink);
  timelineCell.appendChild(subtitle);
  timelineCell.appendChild(tools);

  // Assemble the row
  customRow.appendChild(timelineCell);

  // Insert at the top of the container
  if (container.firstChild) {
    container.insertBefore(customRow, container.firstChild);
  } else {
    container.appendChild(customRow);
  }
}

function injectCustomAssignmentsTimeline(customAssignments: CustomAssignment[]): void {
  try {
    // Find the timeline records container (main grid)
    let timelineRecords = document.querySelector(".timeline-records-inner");

    // Try alternative selectors if main one doesn't work
    if (!timelineRecords) {
      const alternativeSelectors = [
        ".timeline-records",
        ".timeline-content",
        ".timeline-table .timeline-body",
        "[class*='timeline'][class*='record']",
        ".timeline-container .timeline-rows",
      ];

      for (const selector of alternativeSelectors) {
        timelineRecords = document.querySelector(selector);
        if (timelineRecords) {
          break;
        }
      }
    }

    if (!timelineRecords) {
      // Last resort - find any element that might contain timeline rows
      const allTimelineRows = document.querySelectorAll(".timeline-row");
      if (allTimelineRows.length > 0) {
        timelineRecords = allTimelineRows[0].parentElement;
      } else {
        return;
      }
    }

    if (!timelineRecords) return;

    // Remove existing custom assignments timeline row
    const existingTimelineRow = timelineRecords.querySelector(
      ".vch-custom-timeline-row",
    );
    if (existingTimelineRow) {
      existingTimelineRow.remove();
    }

    // Always create timeline row to maintain alignment, even if empty

    // Create custom assignments timeline row
    const timelineRow = document.createElement("div");

    // Copy positioning and layout styles from existing timeline rows
    const firstNativeRow = timelineRecords?.querySelector(
      ".timeline-row:not(.vch-custom-timeline-row)",
    );
    if (firstNativeRow) {
      // Copy all classes from native row, then add our custom classes
      timelineRow.className =
        firstNativeRow.className + " vch-custom-timeline-row";
      timelineRow.setAttribute("data-vch-custom-row", "custom-assignments");

      // Copy ALL computed styles from native row
      const nativeStyle = window.getComputedStyle(firstNativeRow);

      // Copy positioning and layout
      timelineRow.style.cssText = "";
      timelineRow.style.margin = nativeStyle.margin;
      timelineRow.style.padding = nativeStyle.padding;
      timelineRow.style.border = nativeStyle.border;
      timelineRow.style.position = nativeStyle.position;
      timelineRow.style.left = nativeStyle.left;
      timelineRow.style.right = nativeStyle.right;
      timelineRow.style.top = nativeStyle.top;
      timelineRow.style.bottom = nativeStyle.bottom;
      timelineRow.style.width = nativeStyle.width;
      timelineRow.style.height = nativeStyle.height;
      timelineRow.style.display = nativeStyle.display;
      timelineRow.style.boxSizing = nativeStyle.boxSizing;
      timelineRow.style.transform = nativeStyle.transform;
      timelineRow.style.textIndent = nativeStyle.textIndent;
    } else {
      // Fallback if no native row found
      timelineRow.className = "timeline-row vch-custom-timeline-row";
      timelineRow.setAttribute("data-vch-custom-row", "custom-assignments");
    }

    // Add comprehensive event blocking to prevent native Veracross interference
    timelineRow.addEventListener(
      "click",
      (e: Event) => {
        const target = e.target as HTMLElement | null;
        // Block all clicks that aren't on assignments themselves
        if (target && !target.closest("[data-vch-custom='true']")) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      },
      true,
    );

    // Detect initial closed state from other timeline rows
    const otherRows = timelineRecords?.querySelectorAll(
      ".timeline-row:not(.vch-custom-timeline-row)",
    ) || [];
    const closedRowsCount = Array.from(otherRows).filter((row) =>
      row.classList.contains("closed"),
    ).length;
    const shouldStartClosed = closedRowsCount > otherRows.length / 2;

    if (shouldStartClosed) {
      timelineRow.classList.add("closed");
    }

    // Add mutation observer to watch for closed class changes on this row
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          const isClosed = timelineRow.classList.contains("closed");
          const assignments = timelineRow.querySelectorAll(".assignment");

          assignments.forEach((assignment: Element) => {
            const assignmentEl = assignment as HTMLElement & { _descriptionSpan?: HTMLElement; _descriptionWhitespace?: Node[] };
            const descriptionSpan = assignmentEl._descriptionSpan;
            const whitespace = assignmentEl._descriptionWhitespace;

            if (isClosed) {
              // Hide description and whitespace when closed
              if (descriptionSpan) descriptionSpan.style.display = "none";
              if (whitespace) {
                whitespace.forEach((node: Node) => {
                  if (node && node.nodeType === Node.TEXT_NODE) {
                    node.textContent = "";
                  }
                });
              }
            } else {
              // Show description and whitespace when not closed
              if (descriptionSpan) descriptionSpan.style.display = "";
              if (whitespace) {
                whitespace.forEach((node: Node, index: number) => {
                  if (node && node.nodeType === Node.TEXT_NODE) {
                    node.textContent = index === 0 ? "\n      " : "\n\n      ";
                  }
                });
              }
            }
          });
        }
      });
    });

    observer.observe(timelineRow, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Store observer reference for cleanup
    (timelineRow as HTMLDivElement & { _vchObserver?: MutationObserver })._vchObserver = observer;

    // Remove timeline row toggle functionality to prevent interference
    // timelineRow.addEventListener("click", (e) => {
    //   // Only toggle if clicking on empty space in timeline cells, not on assignments
    //   if (
    //     e.target.classList.contains("timeline-cell") &&
    //     e.target.children.length === 0 // Only empty cells
    //   ) {
    //     timelineRow.classList.toggle("closed");
    //     e.preventDefault();
    //     e.stopPropagation();
    //   }
    // });

    // Set fixed height to prevent native Veracross show/hide from affecting our row
    timelineRow.style.height = "90px"; // Fixed height matching collapsed native rows
    timelineRow.style.minHeight = "90px";
    timelineRow.style.maxHeight = "90px";

    // Remove the fixed positioning - let native styles handle it

    // Get timeline columns (dates) to create matching cells
    const headerColumns = document.querySelectorAll(
      ".timeline-header-x-inner .timeline-cell",
    ) || [];

    // Get the width of existing cells to match exactly
    const firstRowCells = timelineRecords
      ?.querySelector(".timeline-row:not(.vch-custom-timeline-row)")
      ?.querySelectorAll(".timeline-cell");

    // Check if any column represents today for row-level highlighting
    let hasTodayColumn = false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Create timeline cells for each date column
    let dateColumnCount = 0;
    headerColumns.forEach((headerCell, index) => {
      try {
        // Check if this header contains date information
        const headerText =
          headerCell.querySelector("h4")?.textContent?.trim() ||
          headerCell.querySelector("div")?.textContent?.trim() ||
          headerCell.textContent?.trim();

        // Stop processing if we encounter non-date headers (like "X ASSIGNMENTS DUE")
        if (
          !headerText ||
          headerText.includes("ASSIGNMENTS DUE") ||
          headerText.match(/^\d+\s+ASSIGNMENTS DUE/) ||
          (!headerText.includes(",") &&
            headerText.length > 0 &&
            !headerText.match(/^\s*$/))
        ) {
          return;
        }

        dateColumnCount++;

        const timelineCell = document.createElement("div");
        timelineCell.className = "timeline-cell";

        // Copy ALL styling from corresponding native cell
        if (firstRowCells && firstRowCells[index]) {
          const existingCell = firstRowCells[index];
          const computedStyle = window.getComputedStyle(existingCell);

          // Copy all positioning and appearance properties
          timelineCell.style.cssText = "";
          timelineCell.className =
            existingCell.className + " vch-custom-timeline-cell";
          timelineCell.style.width = computedStyle.width;
          timelineCell.style.minWidth = computedStyle.minWidth;
          timelineCell.style.maxWidth = computedStyle.maxWidth;
          timelineCell.style.height = computedStyle.height;
          timelineCell.style.margin = computedStyle.margin;
          timelineCell.style.padding = computedStyle.padding;
          timelineCell.style.border = computedStyle.border;
          timelineCell.style.borderLeft = computedStyle.borderLeft;
          timelineCell.style.borderRight = computedStyle.borderRight;
          timelineCell.style.borderTop = computedStyle.borderTop;
          timelineCell.style.borderBottom = computedStyle.borderBottom;
          timelineCell.style.backgroundColor = computedStyle.backgroundColor;
          timelineCell.style.position = computedStyle.position;
          timelineCell.style.left = computedStyle.left;
          timelineCell.style.right = computedStyle.right;
          timelineCell.style.top = computedStyle.top;
          timelineCell.style.bottom = computedStyle.bottom;
          timelineCell.style.display = computedStyle.display;
          timelineCell.style.boxSizing = computedStyle.boxSizing;
          timelineCell.style.verticalAlign = computedStyle.verticalAlign;
          timelineCell.style.textAlign = computedStyle.textAlign;
          timelineCell.style.textIndent = computedStyle.textIndent;
          timelineCell.style.transform = computedStyle.transform;

          // Current day highlighting is already copied via backgroundColor above
          // Just ensure we preserve any special classes
          if (existingCell.classList.contains("today")) {
            timelineCell.classList.add("today");
          }
          if (existingCell.classList.contains("current")) {
            timelineCell.classList.add("current");
          }
          if (existingCell.classList.contains("active")) {
            timelineCell.classList.add("active");
          }

          // If this cell is marked as today, mark the row as having today
          if (timelineCell.classList.contains("today")) {
            hasTodayColumn = true;
          }
        }

        // Check if this is a weekend divider cell
        if (headerCell.classList.contains("divider")) {
          timelineCell.classList.add("divider");
        }

        // Find assignments for this date
        const matchingAssignments = getCustomAssignmentsForDate(
          customAssignments,
          headerCell,
          index,
        );

        matchingAssignments.forEach((assignment: CustomAssignment) => {
          const assignmentEl = createTimelineAssignmentElement(
            assignment,
            timelineRow,
          );
          timelineCell.appendChild(assignmentEl);
        });

        // Empty cells are left empty for clean interface

        timelineRow.appendChild(timelineCell);
      } catch (error) {
        // Skip problematic cells silently
      }
    });

    // If row contains today's date, add today class to entire row
    if (hasTodayColumn) {
      timelineRow.classList.add("today");
      timelineRow.style.backgroundColor = "#fffee0";
    }

    // Insert the timeline row at the top
    if (!timelineRecords) return;

    if (timelineRecords.firstChild) {
      timelineRecords.insertBefore(timelineRow, timelineRecords.firstChild);
    } else {
      timelineRecords.appendChild(timelineRow);
    }
  } catch (error) {
    // Silent error handling
  }
}

function getCustomAssignmentsForDate(
  customAssignments: CustomAssignment[],
  headerCell: Element,
  columnIndex: number,
): CustomAssignment[] {
  // Extract date from header cell - try multiple selectors
  let headerText = headerCell.querySelector("h4")?.textContent?.trim();

  // If h4 doesn't exist or doesn't contain a date, try other selectors
  if (!headerText || !headerText.includes(",")) {
    headerText = headerCell.querySelector("div")?.textContent?.trim();
    if (!headerText || !headerText.includes(",")) {
      headerText = headerCell.textContent?.trim();
    }
  }

  // Additional cleanup for header text
  if (headerText) {
    headerText = headerText.replace(/\s+/g, " ").trim();
  }

  // More specific checks for valid date headers
  if (
    !headerText ||
    !headerText.includes(",") ||
    headerText.includes("ASSIGNMENTS DUE") ||
    headerText.match(/^\d+\s+ASSIGNMENTS DUE/)
  ) {
    return [];
  }

  // Parse the date from header text (e.g., "Wednesday, Sep 03")
  const headerDate = parseHeaderDate(headerText);
  if (!headerDate) {
    return [];
  }

  // Find assignments due on this date
  const matchingAssignments = customAssignments.filter((assignment: CustomAssignment) => {
    if (!assignment.dueDate) {
      return false;
    }

    // Parse assignment date in local timezone to avoid UTC shift issues
    const dateParts = assignment.dueDate.split("-");
    if (dateParts.length !== 3) {
      return false;
    }

    const assignmentYear = parseInt(dateParts[0], 10);
    const assignmentMonth = parseInt(dateParts[1], 10) - 1; // month (0-based)
    const assignmentDay = parseInt(dateParts[2], 10);

    // Create date in local timezone to avoid UTC shift
    const assignmentDate = new Date(
      assignmentYear,
      assignmentMonth,
      assignmentDay,
    );

    // Direct date comparison - parseHeaderDate now handles years correctly
    const matches =
      assignmentDate.getFullYear() === headerDate.getFullYear() &&
      assignmentDate.getMonth() === headerDate.getMonth() &&
      assignmentDate.getDate() === headerDate.getDate();

    return matches;
  });

  return matchingAssignments;
}

function parseHeaderDate(headerText: string): Date | null {
  try {
    // Parse dates like "Wednesday, Sep 03" or "Monday, Oct 06"
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();

    // Clean up the header text and extract month and day
    const cleanedText = headerText.replace(/\s+/g, " ").trim();
    const parts = cleanedText.split(", ");
    if (parts.length !== 2) {
      return null;
    }

    const datePart = parts[1]; // "Sep 03"

    // Parse month and day separately to avoid timezone issues
    const [monthStr, dayStr] = datePart.split(" ");
    const monthMap = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };

    const month = monthMap[monthStr as keyof typeof monthMap];
    const day = parseInt(dayStr, 10);

    if (month === undefined || isNaN(day)) {
      return null;
    }

    // Smart year detection: if we're in late year (Nov/Dec) and seeing early months (Jan/Feb/Mar),
    // it's probably next year. If we're in early year and seeing late months, it's probably last year.
    let year = currentYear;

    if (currentMonth >= 10 && month <= 2) {
      // We're in Nov/Dec looking at Jan/Feb/Mar - probably next year
      year = currentYear + 1;
    } else if (currentMonth <= 2 && month >= 10) {
      // We're in Jan/Feb/Mar looking at Nov/Dec - probably last year
      year = currentYear - 1;
    }

    // Create date in local timezone to avoid timezone shift issues
    const parsed = new Date(year, month, day);

    // Check if date is valid
    if (isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
}

function createTimelineAssignmentElement(assignment: CustomAssignment, parentRow: Element): HTMLElement {
  // Create assignment div that matches Veracross timeline structure exactly
  const assignmentDiv = document.createElement("div");
  assignmentDiv.className = "assignment vch-decorated vch-custom-assignment";
  assignmentDiv.setAttribute("data-custom-assignment-id", assignment.id);
  assignmentDiv.setAttribute("data-vch-custom", "true");

  // Create assignment type span matching native Veracross style exactly
  const typeSpan = document.createElement("span");
  typeSpan.className = "assignment-type";
  const assignmentType = "Custom";
  const borderColor = "#007bff";
  typeSpan.setAttribute("title", assignmentType);
  typeSpan.style.cssText = `border-left: 4px solid ${borderColor};`;

  // Create task wrap with checkbox exactly like native assignments
  const taskWrap = document.createElement("span");
  taskWrap.className = "vch-task-wrap";
  taskWrap.setAttribute("data-type", "custom");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "vch-checkbox";

  // Add change event handler for strikethrough effect
  const assignmentId = `custom-${assignment.id}`;
  checkbox.addEventListener("change", async (event) => {
    try {
      // Toggle the vch-done class on the assignment element
      assignmentDiv.classList.toggle("vch-done", checkbox.checked);

      // Store checkbox state in storage
      const checked = (await getStorage<CompletionRecord>("vc_checked_assignments")) || {};
      if (checkbox.checked) {
        checked[assignmentId] = 1;
      } else {
        delete checked[assignmentId];
      }

      // Remove undefined values and save
      const compact = Object.fromEntries(
        Object.entries(checked).filter(([, v]) => v),
      );
      await setStorage({ vc_checked_assignments: compact });
    } catch (error) {
      // Silent error handling
    }
  });

  // Load initial checkbox state from storage
  getStorage<CompletionRecord>("vc_checked_assignments").then((checked) => {
    if (checked && checked[assignmentId]) {
      checkbox.checked = true;
      assignmentDiv.classList.add("vch-done");
    }
  });

  taskWrap.appendChild(checkbox);
  typeSpan.appendChild(taskWrap);
  typeSpan.appendChild(document.createTextNode(assignmentType));

  // Create description span exactly like native
  const descriptionSpan = document.createElement("span");
  descriptionSpan.className = "assignment-description";
  descriptionSpan.textContent = assignment.title;

  // Create due badge exactly like native
  const dueBadge = document.createElement("span");
  dueBadge.className = "badge due";
  dueBadge.textContent = "DUE";

  // Assemble the assignment in the exact same order as native
  assignmentDiv.appendChild(typeSpan);
  assignmentDiv.appendChild(document.createTextNode("\n      "));
  assignmentDiv.appendChild(descriptionSpan);
  assignmentDiv.appendChild(document.createTextNode("\n\n      "));
  assignmentDiv.appendChild(dueBadge);

  // Store reference to description for closed state management
  const assignmentDivWithProps = assignmentDiv as HTMLDivElement & { _descriptionSpan?: HTMLElement; _descriptionWhitespace?: Node[] };
  assignmentDivWithProps._descriptionSpan = descriptionSpan;
  assignmentDivWithProps._descriptionWhitespace = [
    assignmentDiv.childNodes[1], // whitespace before description
    assignmentDiv.childNodes[3], // whitespace after description
  ];

  // Apply initial closed state if parent row is closed
  setTimeout(() => {
    if (parentRow && parentRow.classList.contains("closed")) {
      descriptionSpan.style.display = "none";
      if (assignmentDiv.childNodes[1])
        assignmentDiv.childNodes[1].textContent = ""; // Hide whitespace
      if (assignmentDiv.childNodes[3])
        assignmentDiv.childNodes[3].textContent = ""; // Hide whitespace
    }
  }, 0);

  // Click handling is now managed by the global event handler above
  // No individual click listener needed since global handler will catch it

  return assignmentDiv;
}

function createCustomAssignmentElement(assignment: CustomAssignment): HTMLElement | null {
  // This function is for sidebar assignments (currently unused)
  // Timeline assignments use createTimelineAssignmentElement
  return null;
}

function showCustomAssignmentDetails(assignment: CustomAssignment): void {
  // Create modal similar to Veracross assignment popups
  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    pointer-events: auto;
    opacity: 0;
    transition: opacity 0.2s ease-out;
  `;

  // Prevent body scrolling when modal is open
  document.body.style.overflow = "hidden";

  // Details modal should NOT hide the button - only hide for edit forms

  const popup = document.createElement("div");
  popup.style.cssText = `
    background: white;
    border-radius: 8px;
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    position: relative;
    pointer-events: auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    transform: scale(0.9);
    transition: all 0.2s ease-out;
  `;

  // Header
  const header = document.createElement("div");
  header.style.cssText = `
    background: #2c3e50;
    color: white;
    padding: 15px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 8px 8px 0 0;
  `;

  const headerTitle = document.createElement("h2");
  headerTitle.style.cssText = `
    margin: 0;
    font-size: 18px;
    font-weight: normal;
  `;
  headerTitle.textContent = "CUSTOM ASSIGNMENT";

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "✕";
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: white;
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  // Define event handlers first
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeModal();
    }
  };

  const closeModal = () => {
    // Details modal doesn't need to restore button since it never hid it
    // Restore body scrolling
    document.body.style.overflow = "";
    modal.style.opacity = "0";
    popup.style.transform = "scale(0.9)";
    setTimeout(() => {
      modal.remove();
      document.removeEventListener("keydown", handleEscape);
      // Reset the flag to allow new modals
      modalOpenInProgress = false;
    }, 200);
  };

  closeBtn.addEventListener("click", closeModal);

  header.appendChild(headerTitle);
  header.appendChild(closeBtn);

  // Content
  const content = document.createElement("div");
  content.style.cssText = `
    padding: 20px;
  `;

  // Title
  const title = document.createElement("h1");
  title.style.cssText = `
    margin: 0 0 20px 0;
    font-size: 24px;
    color: #333;
  `;
  title.textContent = assignment.title;

  // Due date
  const dueDateDiv = document.createElement("div");
  dueDateDiv.style.cssText = `
    display: flex;
    align-items: center;
    margin-bottom: 20px;
    font-size: 16px;
  `;

  const calendarIcon = document.createElement("span");
  calendarIcon.innerHTML = "📅";
  calendarIcon.style.marginRight = "10px";

  const dueDateText = document.createElement("span");
  const dueDate = new Date(assignment.dueDate);
  const options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  dueDateText.textContent = dueDate.toLocaleDateString("en-US", options);

  dueDateDiv.appendChild(calendarIcon);
  dueDateDiv.appendChild(dueDateText);

  // Description
  if (assignment.description) {
    const descIcon = document.createElement("span");
    descIcon.innerHTML = "📋";
    descIcon.style.cssText = `
      margin-right: 10px;
      vertical-align: top;
    `;

    const descDiv = document.createElement("div");
    descDiv.style.cssText = `
      display: flex;
      margin-bottom: 20px;
      font-size: 14px;
    `;

    const descText = document.createElement("div");
    descText.style.cssText = `
      flex: 1;
      line-height: 1.4;
    `;
    descText.textContent = assignment.description;

    descDiv.appendChild(descIcon);
    descDiv.appendChild(descText);
    content.appendChild(descDiv);
  }

  // Class info
  if (assignment.className) {
    const classInfo = document.createElement("div");
    classInfo.style.cssText = `
      display: flex;
      align-items: center;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 14px;
      color: #666;
      font-style: italic;
    `;

    const infoIcon = document.createElement("span");
    infoIcon.innerHTML = "ℹ️";
    infoIcon.style.marginRight = "10px";

    classInfo.appendChild(infoIcon);
    classInfo.appendChild(document.createTextNode(assignment.className || ""));
    content.appendChild(classInfo);
  }

  // Action buttons
  const actionButtons = document.createElement("div");
  actionButtons.style.cssText = `
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid #eee;
  `;

  const editBtn = document.createElement("button");
  editBtn.innerHTML = "✏️ Edit";
  editBtn.style.cssText = `
    padding: 10px 18px;
    background: #ffffff;
    color: #007bff;
    border: 2px solid #007bff;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s ease;
  `;
  editBtn.addEventListener("mouseover", () => {
    editBtn.style.background = "#007bff";
    editBtn.style.color = "white";
  });
  editBtn.addEventListener("mouseout", () => {
    editBtn.style.background = "#ffffff";
    editBtn.style.color = "#007bff";
  });
  editBtn.addEventListener("click", () => {
    closeModal();
    // Hide button before opening edit modal since edit modal should hide it
    if (window !== window.top && window.top) {
      try {
        window.top.postMessage({ type: "VCH_HIDE_BUTTON" }, "*");
      } catch (e) {
        // Silent error handling
      }
    } else {
      const floatingBtn = document.querySelector(".vch-floating-button") as HTMLElement | null;
      if (floatingBtn) {
        floatingBtn.style.visibility = "hidden";
        floatingBtn.style.opacity = "0";
        floatingBtn.style.pointerEvents = "none";
        floatingBtn.style.transform = "scale(0.8)";
      }
    }
    showCustomAssignmentModal(assignment);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.innerHTML = "🗑️ Delete";
  deleteBtn.style.cssText = `
    padding: 10px 18px;
    background: #ffffff;
    color: #dc3545;
    border: 2px solid #dc3545;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s ease;
  `;
  deleteBtn.addEventListener("mouseover", () => {
    deleteBtn.style.background = "#dc3545";
    deleteBtn.style.color = "white";
  });
  deleteBtn.addEventListener("mouseout", () => {
    deleteBtn.style.background = "#ffffff";
    deleteBtn.style.color = "#dc3545";
  });
  deleteBtn.addEventListener("click", async () => {
    showConfirmationModal(
      `Delete Assignment`,
      `Are you sure you want to delete "${assignment.title}"? This action cannot be undone.`,
      "Delete",
      "Cancel",
      async () => {
        await deleteCustomAssignment(assignment.id);
        closeModal();
      },
    );
  });

  actionButtons.appendChild(editBtn);
  actionButtons.appendChild(deleteBtn);

  content.insertBefore(title, content.firstChild);
  content.insertBefore(dueDateDiv, title.nextSibling);
  content.appendChild(actionButtons);

  popup.appendChild(header);
  popup.appendChild(content);
  modal.appendChild(popup);

  // Close on outside click
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Add Escape key listener
  document.addEventListener("keydown", handleEscape);

  document.body.appendChild(modal);

  // Trigger opening animation
  setTimeout(() => {
    modal.style.opacity = "1";
    popup.style.transform = "scale(1)";
  }, 10);
}

function showConfirmationModal(
  title: string,
  message: string,
  confirmText: string,
  cancelText: string,
  onConfirm: () => void | Promise<void>,
): void {
  // Create confirmation modal
  const confirmModal = document.createElement("div");
  confirmModal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  const confirmContent = document.createElement("div");
  confirmContent.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 0;
    width: 90%;
    max-width: 420px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    animation: confirmSlideIn 0.3s ease-out;
  `;

  confirmContent.innerHTML = `
    <style>
      @keyframes confirmSlideIn {
        from { transform: scale(0.9) translateY(-20px); opacity: 0; }
        to { transform: scale(1) translateY(0); opacity: 1; }
      }
    </style>
    <div style="padding: 24px 24px 16px 24px;">
      <h3 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600; color: #333;">${title}</h3>
      <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #666;">${message}</p>
    </div>
    <div style="display: flex; gap: 0; border-top: 1px solid #eee;">
      <button id="confirm-cancel" style="
        flex: 1;
        padding: 16px;
        background: none;
        border: none;
        font-size: 16px;
        font-weight: 500;
        color: #666;
        cursor: pointer;
        border-right: 1px solid #eee;
        transition: background-color 0.2s ease;
      ">${cancelText}</button>
      <button id="confirm-ok" style="
        flex: 1;
        padding: 16px;
        background: none;
        border: none;
        font-size: 16px;
        font-weight: 600;
        color: #dc3545;
        cursor: pointer;
        transition: background-color 0.2s ease;
      ">${confirmText}</button>
    </div>
  `;

  confirmModal.appendChild(confirmContent);
  document.body.appendChild(confirmModal);

  // Add hover effects
  const cancelBtn = confirmContent.querySelector("#confirm-cancel") as HTMLButtonElement | null;
  const okBtn = confirmContent.querySelector("#confirm-ok") as HTMLButtonElement | null;

  if (cancelBtn) {
    cancelBtn.addEventListener("mouseover", () => {
      cancelBtn.style.backgroundColor = "#f8f9fa";
    });
    cancelBtn.addEventListener("mouseout", () => {
      cancelBtn.style.backgroundColor = "transparent";
    });
  }

  if (okBtn) {
    okBtn.addEventListener("mouseover", () => {
      okBtn.style.backgroundColor = "#f8f9fa";
    });
    okBtn.addEventListener("mouseout", () => {
      okBtn.style.backgroundColor = "transparent";
    });
  }

  // Event handlers
  const closeConfirmModal = () => {
    confirmModal.remove();
  };

  if (cancelBtn) {
    cancelBtn.addEventListener("click", closeConfirmModal);
  }

  if (okBtn) {
    okBtn.addEventListener("click", () => {
      closeConfirmModal();
      if (onConfirm) onConfirm();
    });
  }

  // Close on background click
  confirmModal.addEventListener("click", (e) => {
    if (e.target === confirmModal) {
      closeConfirmModal();
    }
  });

  // Close on escape key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeConfirmModal();
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

// Legacy functions - keeping for potential future use but not actively used

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString();
}

// Listen for messages from popup/window
chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
  if (message.type === "refreshCustomAssignments") {
    setTimeout(() => {
      instantAssignmentUpdate();
    }, 10);
    sendResponse({ success: true });
  }
});

// ———————————————— Init ————————————————
(async function init() {
  try {
    // Initialize Phase 1 systems (migrations, feature flags)
    await initializePhase1Systems();

    const settings = await loadSettings();

    maybeRedirectHome(settings);

    // Fix clipping issues first
    fixClippingIssues();
    // Also enhance scrolling for timeline cells
    setTimeout(() => enhanceTimelineScrolling(), 100);

    // For Veracross timeline, wait for the timeline to be rendered
    if (
      location.hostname.includes("veracross") ||
      location.hostname.includes("portals")
    ) {
      let timelineCheckCount = 0;
      const maxChecks = 50; // Prevent infinite polling

      // Wait for timeline to be created
      const waitForTimeline = () => {
        timelineCheckCount++;
        const timeline = document.querySelector(
          ".timeline-records, .timeline-table",
        );

        if (timeline) {
          // Apply fixes when timeline is found
          setTimeout(() => {
            fixClippingIssues();
            enhanceTimelineScrolling();
          }, 500);
          setTimeout(() => {
            fixClippingIssues();
            enhanceTimelineScrolling();
          }, 1000);
          setTimeout(() => {
            fixClippingIssues();
            enhanceTimelineScrolling();
          }, 2000);
        } else if (timelineCheckCount < maxChecks) {
          setTimeout(waitForTimeline, 100);
        }
      };
      waitForTimeline();
    }

    // Monitor for dynamic content changes and reapply fixes
    const clipObserver = new MutationObserver((mutations) => {
      fixClippingIssues();
      // Also enhance scrolling for any new scrollable cells
      setTimeout(() => enhanceTimelineScrolling(), 100);

      // Check if timeline structure changed and re-inject assignments if needed
      const hasTimelineChanges = mutations.some((mutation) => {
        return Array.from(mutation.addedNodes).some((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            // Don't re-inject if we're just adding our own custom elements
            if (
              element.matches &&
              (element.matches("[data-vch-custom]") ||
                element.querySelector("[data-vch-custom]") ||
                element.matches(".vch-custom-timeline-row") ||
                element.matches(".vch-custom-assignment"))
            ) {
              return false;
            }
            return (
              element.matches &&
              (element.matches(".timeline-row") ||
                element.matches(".timeline-cell") ||
                element.matches(".timeline-records-inner") ||
                element.querySelector(
                  ".timeline-row, .timeline-cell, .timeline-records-inner",
                ))
            );
          }
          return false;
        });
      });

      if (
        hasTimelineChanges &&
        settings.enableCustomAssignments &&
        !instantUpdateInProgress
      ) {
        setTimeout(async () => {
          customAssignmentsInjected = false;
          injectionInProgress = false;
          await instantAssignmentUpdate();
        }, 100);
      }
    });
    clipObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Add window resize listener for responsive scrolling
    window.addEventListener("resize", handleWindowResize);

    // Add scroll event listener to fix alignment issues during horizontal scrolling
    const scrollContainer =
      document.querySelector(
        ".timeline-table-wrapper, .timeline-records-wrapper, .timeline-wrapper, .timeline-table, .timeline-records",
      ) || document;
    scrollContainer.addEventListener("scroll", () => {
      // Debounce the scroll event to avoid excessive calls
      const scrollEl = scrollContainer as HTMLElement & { scrollTimeout?: number };
      if (scrollEl.scrollTimeout) {
        clearTimeout(scrollEl.scrollTimeout);
      }
      scrollEl.scrollTimeout = window.setTimeout(() => {
        // fixTableAlignment(); // This function is removed
      }, 100);
    });

    if (settings.enableChecklist) {
      // Apply checklist directly to the current page
      // This works on all Veracross pages without iframe communication issues
      const checked = (await getStorage<CompletionRecord>("vc_checked_assignments")) || ({} as CompletionRecord);

      // Wait for DOM to be ready
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          applyChecklistToDocument(document, checked);
          // Recalculate scrolling after checkboxes are added
          setTimeout(() => enhanceTimelineScrolling(), 200);
        });
      } else {
        applyChecklistToDocument(document, checked);
        // Recalculate scrolling after checkboxes are added
        setTimeout(() => enhanceTimelineScrolling(), 200);
      }
    }

    if (settings.enableEstimator) {
      applyEstimator();
    }

    // Apply custom assignments if enabled
    await applyCustomAssignments(settings);

    // Set up URL change detection for single-page app navigation
    let currentUrl = location.href;
    const checkForUrlChange = () => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;

        // Reset injection state and re-apply assignments after navigation
        customAssignmentsInjected = false;
        setTimeout(async () => {
          if (settings.enableCustomAssignments) {
            customAssignmentsInjected = false;
            injectionInProgress = false;
            await instantAssignmentUpdate();
          }
        }, 100);
      }

      // Continue checking
      setTimeout(checkForUrlChange, 1000);
    };

    // Start URL monitoring
    setTimeout(checkForUrlChange, 1000);

    // Also check for floating button visibility on URL changes
    let lastUrl = location.href;
    const checkButtonVisibility = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Re-evaluate if button should be shown on new page
        setTimeout(() => {
          addFloatingAssignmentButton();
        }, 500);
      }
      setTimeout(checkButtonVisibility, 1000);
    };
    setTimeout(checkButtonVisibility, 1000);
  } catch (error) {
    // Silent error handling
  }
})();

