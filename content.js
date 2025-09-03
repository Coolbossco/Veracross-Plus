// Veracross Plus — content script (MVP)
// Adds: (1) homework checkboxes (2) exact % estimator (3) optional home redirect

// Debug logging prefix for easy identification
const DEBUG_PREFIX = "[Veracross Plus]";

// Add global error handling to catch any JavaScript errors

const DEFAULTS = {
  enableChecklist: false,
  enableEstimator: false,
  enableHomeRedirect: false,
  enableCustomAssignments: false,
  homeUrl: "", // e.g., "/student/schedule/weekly" or a full URL
};

// Small stable hash for keys
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (result) => {
      resolve(result);
    });
  });
}

function saveSettings(changes) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(changes, () => {
      resolve();
    });
  });
}

function getStorage(key) {
  return new Promise((resolve) =>
    chrome.storage.sync.get(key, (obj) => {
      resolve(obj[key]);
    }),
  );
}

function setStorage(obj) {
  return new Promise((resolve) =>
    chrome.storage.sync.set(obj, () => {
      resolve();
    }),
  );
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
        const assignmentHeight =
          assignment.offsetHeight || assignment.scrollHeight || 40; // fallback to 40px
        totalContentHeight += assignmentHeight;
      });

      // Add some padding for better spacing
      totalContentHeight += 16; // 8px top + 8px bottom padding

      // Set cell height to accommodate 2 assignments plus some space for scrolling
      const visibleHeight = Math.min(100, totalContentHeight - 15); // Show most content but leave room to scroll
      const maxHeight = Math.max(100, totalContentHeight); // Allow full content height

      // Make scrollable with proper height calculations - keep width minimal
      cell.style.height = `${visibleHeight}px`;
      cell.style.maxHeight = `${maxHeight}px`;
      cell.style.overflowY = "auto";
      cell.style.overflowX = "hidden";
      cell.style.verticalAlign = "top";
      // Remove all width and padding styling - let cell size naturally
      cell.classList.add("scrollable");

      // Don't expand parent row - keep table layout consistent
      const parentRow = cell.closest("tr");
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
        cell.style.height = "auto";
        cell.style.minHeight = "120px";
        cell.style.verticalAlign = "top";
        cell.style.padding = "8px";
      }
    });

    // If row has assignments, ensure it can expand
    if (hasAssignments) {
      rowsWithAssignments++;
      row.style.height = "auto";
      row.style.minHeight = "120px";
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
        const assignmentHeight =
          assignment.offsetHeight || assignment.scrollHeight || 40;
        totalContentHeight += assignmentHeight;
      });

      // Ensure there's enough scrollable content
      const visibleHeight = Math.min(100, totalContentHeight - 15);
      const maxHeight = Math.max(100, totalContentHeight);

      // Update cell dimensions for better scrolling - keep width minimal
      cell.style.height = `${visibleHeight}px`;
      cell.style.maxHeight = `${maxHeight}px`;
      cell.style.overflowY = "auto";
      cell.style.overflowX = "hidden";
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
  applyChecklistToDocument(document, checked);
}

function applyChecklistToDocument(doc, checked) {
  // Clear any existing checkboxes first to prevent duplicates
  const existingCheckboxes = doc.querySelectorAll(".vch-task-wrap");
  if (existingCheckboxes.length > 0) {
    existingCheckboxes.forEach((cb) => cb.remove());
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
  ];

  const seen = new WeakSet();

  function keyForNode(node) {
    const stable = node.getAttribute?.("data-assignment-id");
    if (stable) return `${location.host}|${stable}`;
    const text = node.textContent?.trim().replace(/\s+/g, " ") || "";
    const nearDate = node
      .closest("tr,li,div")
      ?.textContent?.match(/\b(?:\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\b/);
    return `${location.host}|${hash(text + (nearDate?.[0] || ""))}`;
  }

  function decorate(node) {
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

    // Look for the first meaningful text element or link
    const firstTextElement = node.querySelector("a, span, div, p") || node;
    if (firstTextElement && firstTextElement !== node) {
      insertTarget = firstTextElement;
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

    // Skip test assignments and any assignments that don't need checkboxes
    if (shouldSkip) {
      return;
    }

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

    const wrap = document.createElement("span");
    wrap.className = "vch-task-wrap";
    wrap.setAttribute("data-type", assignmentType);

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "vch-checkbox";
    cb.checked = !!checked[id];

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
        console.error(
          "Veracross Plus: Error in checkbox change handler:",
          error,
        );
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

      elements.forEach((node) => {
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
function parseScores(root) {
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

function estimatePercent({ byFraction, byPercent }) {
  let earned = 0,
    possible = 0;
  byFraction.forEach(({ earned: e, possible: p }) => {
    if (!isNaN(e) && !isNaN(p) && p > 0) {
      earned += e;
      possible += p;
    }
  });

  // If we only have percents, average them (unweighted) as a fallback.
  if (possible === 0 && byPercent.length) {
    const avg = byPercent.reduce((s, r) => s + r.percent, 0) / byPercent.length;
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
      document.querySelector("main, #main, .main-content") || document.body;
    const data = parseScores(main);
    const est = estimatePercent(data);
    const val = panel.querySelector(".vch-grade-value");
    if (est.percent == null) {
      val.textContent = "—";
    } else {
      val.textContent = `${est.percent.toFixed(1)}%`;
    }
    panel.title = `Method: ${est.method}`;
  }

  recalc();
  const mo = new MutationObserver(() => recalc());
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

// ———————————————— Feature 3: Home redirect ————————————————
function maybeRedirectHome(settings) {
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

// Add global event handler to prevent native Veracross modals for custom assignments
document.addEventListener(
  "click",
  (e) => {
    // Only block native handlers if clicking on assignment but not checkboxes
    const assignmentDiv = e.target.closest('[data-vch-custom="true"]');
    if (
      assignmentDiv &&
      !e.target.classList.contains("vch-checkbox") &&
      e.target.tagName !== "INPUT" &&
      !e.target.closest(".vch-task-wrap")
    ) {
      // Only prevent default to stop native Veracross, but allow our handlers
      e.preventDefault();
    }
  },
  true,
);

async function applyCustomAssignments(settings) {
  if (!settings.enableCustomAssignments) {
    return;
  }

  console.log(`${DEBUG_PREFIX} Custom assignments feature is ENABLED`);

  // Add floating action button for new assignments
  addFloatingAssignmentButton();

  // Add buttons to assignment detail popups
  addAssignmentDetailButtons();

  // Load and inject existing custom assignments
  await loadAndInjectCustomAssignments();

  // Watch for assignment popup changes (but not timeline changes)
  watchAssignmentPopups();
}

function addFloatingAssignmentButton() {
  // Remove existing button if present
  const existingButton = document.querySelector(".vch-floating-add-btn");
  if (existingButton) {
    existingButton.remove();
  }

  // Create floating action button
  const floatingButton = document.createElement("div");
  floatingButton.className = "vch-floating-add-btn";
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
    z-index: 1000;
    opacity: 0.9;
    transition: opacity 0.3s ease;
  `;

  const button = floatingButton.querySelector(".vch-add-assignment-btn");
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

  button.addEventListener("click", () => {
    showCustomAssignmentModal();
  });

  document.body.appendChild(floatingButton);
}

function addAssignmentDetailButtons() {
  // Watch for assignment detail popups
  const observer = new MutationObserver(() => {
    const assignmentPopups = document.querySelectorAll(
      '[class*="assignment"]:not(.vch-enhanced)',
    );
    assignmentPopups.forEach((popup) => {
      if (
        popup.textContent &&
        popup.textContent.includes("Due") &&
        popup.querySelector("h1, h2, h3, .title") &&
        !popup.querySelector(".vch-past-due-btn")
      ) {
        addPastDueButton(popup);
        popup.classList.add("vch-enhanced");
      }
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function addPastDueButton(popup) {
  // Find a good place to insert the button
  const titleElement =
    popup.querySelector("h1, h2, h3, .title") || popup.firstElementChild;
  if (!titleElement) return;

  const buttonContainer = document.createElement("div");
  buttonContainer.style.cssText = `
    margin: 10px 0;
    display: flex;
    gap: 10px;
  `;

  const pastDueButton = document.createElement("button");
  pastDueButton.className = "vch-past-due-btn";
  pastDueButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12,6 12,12 16,14"></polyline>
    </svg>
    Create Past Due Reminder
  `;

  // Style to match Veracross buttons
  pastDueButton.style.cssText = `
    background: #dc3545;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px 16px;
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: background-color 0.2s ease;
    font-family: inherit;
  `;

  pastDueButton.addEventListener("mouseover", () => {
    pastDueButton.style.backgroundColor = "#c82333";
  });

  pastDueButton.addEventListener("mouseout", () => {
    pastDueButton.style.backgroundColor = "#dc3545";
  });

  pastDueButton.addEventListener("click", () => {
    createPastDueReminder(popup);
  });

  buttonContainer.appendChild(pastDueButton);
  titleElement.parentNode.insertBefore(
    buttonContainer,
    titleElement.nextSibling,
  );
}

function createPastDueReminder(popup) {
  // Extract assignment details
  const title = (
    popup.querySelector("h1, h2, h3, .title")?.textContent || "Assignment"
  ).trim();
  const classInfo =
    popup.querySelector('[class*="class"], [class*="course"]')?.textContent ||
    "";
  const description = popup.querySelector("p, .description")?.textContent || "";

  showCustomAssignmentModal({
    title: title + " (Past Due Reminder)",
    description: description,
    class: classInfo,
    isPastDue: true,
    originalDueDate: new Date().toISOString().split("T")[0], // Today's date as fallback
  });
}

async function loadAndInjectCustomAssignments() {
  const customAssignments = (await getStorage("customAssignments")) || [];
  if (customAssignments.length > 0 && !customAssignmentsInjected) {
    // Check if we're on the right page type (timeline/planner page)
    const isTimelinePage =
      location.pathname.includes("planner") ||
      location.pathname.includes("timeline") ||
      document.querySelector("#planner");

    if (!isTimelinePage) {
      console.log(
        `${DEBUG_PREFIX} Not on a timeline page, skipping custom assignments`,
      );
      return;
    }

    // Wait for timeline to be fully loaded
    const waitForTimeline = () => {
      const timelineYHeader = document.querySelector(
        ".timeline-header-y-inner",
      );
      const timelineRows = document.querySelectorAll(
        ".timeline-row[data-row-id]",
      );

      if (timelineYHeader && timelineRows.length > 0) {
        console.log(
          `${DEBUG_PREFIX} Timeline detected, injecting custom assignments`,
        );
        injectCustomAssignmentsSidebar(customAssignments);
        customAssignmentsInjected = true;
      } else {
        console.log(`${DEBUG_PREFIX} Timeline not ready, retrying in 500ms`);
        setTimeout(waitForTimeline, 500);
      }
    };

    waitForTimeline();
  }
}

function watchAssignmentPopups() {
  const observer = new MutationObserver((mutations) => {
    // Only watch for assignment popups, not timeline changes
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (
          node.nodeType === 1 &&
          node.querySelector &&
          (node.querySelector('[class*="modal"], [class*="popup"]') ||
            node.classList.contains("modal") ||
            node.classList.contains("popup"))
        ) {
          addAssignmentDetailButtons();
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function showCustomAssignmentModal(prefillData = {}) {
  // Remove existing modal
  const existingModal = document.querySelector(".vch-assignment-modal");
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal
  const modal = document.createElement("div");
  modal.className = "vch-assignment-modal";
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
    z-index: 10000;
  `;

  const modalContent = document.createElement("div");
  modalContent.style.cssText = `
    background: white;
    border-radius: 8px;
    padding: 24px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  `;

  modalContent.innerHTML = `
    <h3 style="margin: 0 0 20px 0; color: #333; font-size: 20px;">
      ${prefillData.isPastDue ? "Create Past Due Reminder" : "Add Custom Assignment"}
    </h3>
    <form id="vch-assignment-form">
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: #333;">Assignment Title *</label>
        <input type="text" id="vch-title" required style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" value="${prefillData.title || ""}">
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: #333;">Description</label>
        <textarea id="vch-description" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-height: 80px; resize: vertical;" placeholder="Assignment details...">${prefillData.description || ""}</textarea>
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: #333;">Due Date *</label>
        <input type="date" id="vch-due-date" required style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" value="${prefillData.dueDate || ""}">
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: #333;">Class/Subject</label>
        <input type="text" id="vch-class" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" placeholder="e.g., Mathematics, English" value="${prefillData.class || ""}">
      </div>

      ${
        prefillData.isPastDue
          ? `
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 4px; font-weight: 500; color: #333;">Original Due Date</label>
          <input type="date" id="vch-original-date" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" value="${prefillData.originalDueDate || ""}">
        </div>
      `
          : ""
      }

      <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
        <button type="button" id="vch-cancel" style="padding: 10px 20px; background: #f8f9fa; color: #6c757d; border: 1px solid #dee2e6; border-radius: 4px; cursor: pointer; font-size: 14px;">Cancel</button>
        <button type="submit" style="padding: 10px 20px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">Save Assignment</button>
      </div>
    </form>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Event handlers
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  document.getElementById("vch-cancel").addEventListener("click", () => {
    modal.remove();
  });

  document
    .getElementById("vch-assignment-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      const assignment = {
        id: generateId(),
        title: document.getElementById("vch-title").value,
        description: document.getElementById("vch-description").value,
        dueDate: document.getElementById("vch-due-date").value,
        class: document.getElementById("vch-class").value,
        isPastDue: prefillData.isPastDue || false,
        originalDueDate: document.getElementById("vch-original-date")?.value,
        createdAt: new Date().toISOString(),
      };

      await saveCustomAssignment(assignment);
      modal.remove();

      // Refresh both sidebar and timeline
      customAssignmentsInjected = false;

      // Clear existing custom assignment elements
      const existingSidebarRow = document.querySelector(
        ".vch-custom-class-row",
      );
      if (existingSidebarRow) {
        existingSidebarRow.remove();
      }

      const existingTimelineRow = document.querySelector(
        ".vch-custom-timeline-row",
      );
      if (existingTimelineRow) {
        existingTimelineRow.remove();
      }

      setTimeout(() => {
        loadAndInjectCustomAssignments();
      }, 100);
    });
}

async function saveCustomAssignment(assignment) {
  const customAssignments = (await getStorage("customAssignments")) || [];
  customAssignments.push(assignment);
  await setStorage({ customAssignments });

  console.log(`${DEBUG_PREFIX} Saved custom assignment:`, assignment.title);
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function injectCustomAssignmentsSidebar(customAssignments) {
  try {
    console.log(
      `${DEBUG_PREFIX} Injecting ${customAssignments.length} custom assignments into sidebar`,
    );

    // Validate that customAssignments is an array
    if (!Array.isArray(customAssignments)) {
      console.error(
        `${DEBUG_PREFIX} customAssignments is not an array:`,
        customAssignments,
      );
      return;
    }

    // Find the Veracross timeline Y-axis header (sidebar with class names)
    const timelineYHeader = document.querySelector(".timeline-header-y-inner");

    if (!timelineYHeader) {
      console.log(
        `${DEBUG_PREFIX} Timeline Y-axis header not found, trying alternative selectors`,
      );
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
          console.log(
            `${DEBUG_PREFIX} Found alternative container: ${selector}`,
          );
          break;
        }
      }

      if (container) {
        injectCustomAssignmentsSidebarToContainer(container, customAssignments);
      } else {
        console.log(
          `${DEBUG_PREFIX} No suitable container found for custom assignments. Available containers:`,
          Array.from(
            document.querySelectorAll(
              '.timeline-header-y, .timeline-header-y-inner, [class*="timeline"]',
            ),
          ).map((el) => el.className),
        );
      }
      return;
    }

    injectCustomAssignmentsSidebarToContainer(
      timelineYHeader,
      customAssignments,
    );
    injectCustomAssignmentsTimeline(customAssignments);
  } catch (error) {
    console.error(`${DEBUG_PREFIX} Error injecting custom assignments:`, error);
  }
}

function injectCustomAssignmentsSidebarToContainer(
  container,
  customAssignments,
) {
  // Validate inputs
  if (!container || !container.querySelector) {
    console.error(`${DEBUG_PREFIX} Invalid container provided:`, container);
    return;
  }

  if (!Array.isArray(customAssignments)) {
    console.error(
      `${DEBUG_PREFIX} customAssignments is not an array:`,
      customAssignments,
    );
    return;
  }

  // Remove existing custom assignments row and its observer
  const existingRow = container.querySelector(".vch-custom-class-row");
  if (existingRow) {
    // Clean up any existing mutation observers
    if (existingRow._vchObserver) {
      existingRow._vchObserver.disconnect();
    }
    existingRow.remove();
  }

  // Create custom assignments timeline row that matches Veracross structure
  const customRow = document.createElement("div");
  customRow.className = "timeline-row vch-custom-class-row";
  customRow.setAttribute("data-row-id", "custom-assignments");

  // Get height from existing timeline rows to match exactly
  const firstExistingRow = document.querySelector(
    ".timeline-header-y-inner .timeline-row[data-row-id]:not(.vch-custom-class-row)",
  );
  if (firstExistingRow) {
    const computedStyle = window.getComputedStyle(firstExistingRow);
    customRow.style.height = computedStyle.height;
  } else {
    customRow.style.cssText = `
      height: auto;
      min-height: 60px;
    `;
  }

  // Create timeline cell to match Veracross structure
  const timelineCell = document.createElement("div");
  timelineCell.className = "timeline-cell";

  // Create expand/collapse title link (matching Veracross structure)
  const titleLink = document.createElement("a");
  titleLink.className = "title";
  titleLink.href = "#";
  titleLink.setAttribute("title", "Custom Assignments");
  titleLink.setAttribute("data-toggle-row", "true");

  // Create title text without expand arrow (like native classes)
  const titleText = document.createTextNode("Custom Assignments");
  titleLink.appendChild(titleText);

  // Create subtitle (teacher info)
  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
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
    console.log("View all custom assignments clicked");
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
        const target = mutation.target;
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
            dividerCells.forEach((cell) => {
              cell.style.height = "90px";
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
  customRow._vchObserver = observer;

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

  console.log(
    `${DEBUG_PREFIX} Added custom assignments row with ${customAssignments.length} assignments`,
  );
}

function injectCustomAssignmentsTimeline(customAssignments) {
  try {
    // Find the timeline records container (main grid)
    const timelineRecords = document.querySelector(".timeline-records-inner");
    if (!timelineRecords) {
      console.log(`${DEBUG_PREFIX} Timeline records container not found`);
      return;
    }

    // Remove existing custom assignments timeline row
    const existingTimelineRow = timelineRecords.querySelector(
      ".vch-custom-timeline-row",
    );
    if (existingTimelineRow) {
      existingTimelineRow.remove();
    }

    // Create custom assignments timeline row
    const timelineRow = document.createElement("div");
    timelineRow.className = "timeline-row vch-custom-timeline-row";
    timelineRow.setAttribute("data-vch-custom-row", "custom-assignments");

    // Add comprehensive event blocking to prevent native Veracross interference
    timelineRow.addEventListener(
      "click",
      (e) => {
        // Block all clicks that aren't on assignments themselves
        if (!e.target.closest("[data-vch-custom='true']")) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      },
      true,
    );

    // Detect initial closed state from other timeline rows
    const otherRows = timelineRecords.querySelectorAll(
      ".timeline-row:not(.vch-custom-timeline-row)",
    );
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

          assignments.forEach((assignment) => {
            const descriptionSpan = assignment._descriptionSpan;
            const whitespace = assignment._descriptionWhitespace;

            if (isClosed) {
              // Hide description and whitespace when closed
              if (descriptionSpan) descriptionSpan.style.display = "none";
              if (whitespace) {
                whitespace.forEach((node) => {
                  if (node && node.nodeType === Node.TEXT_NODE) {
                    node.textContent = "";
                  }
                });
              }
            } else {
              // Show description and whitespace when not closed
              if (descriptionSpan) descriptionSpan.style.display = "";
              if (whitespace) {
                whitespace.forEach((node, index) => {
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
    timelineRow._vchObserver = observer;

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

    // Get timeline columns (dates) to create matching cells
    const headerColumns = document.querySelectorAll(
      ".timeline-header-x-inner .timeline-cell",
    );

    // Get the width of existing cells to match exactly
    const firstRowCells = timelineRecords
      .querySelector(".timeline-row:not(.vch-custom-timeline-row)")
      ?.querySelectorAll(".timeline-cell");

    // Create timeline cells for each date column
    headerColumns.forEach((headerCell, index) => {
      const timelineCell = document.createElement("div");
      timelineCell.className = "timeline-cell";

      // Match the styling of existing cells
      if (firstRowCells && firstRowCells[index]) {
        const existingCell = firstRowCells[index];
        const computedStyle = window.getComputedStyle(existingCell);
        timelineCell.style.width = computedStyle.width;
        timelineCell.style.minWidth = computedStyle.minWidth;
        timelineCell.style.maxWidth = computedStyle.maxWidth;
      }

      // Check if this is a divider column (weekend)
      if (headerCell.classList.contains("divider")) {
        timelineCell.classList.add("divider");
        timelineCell.style.height = "90px"; // Fixed height for divider cells
      }

      // Add custom assignments to appropriate date cells
      const assignmentsForThisDate = getCustomAssignmentsForDate(
        customAssignments,
        headerCell,
        index,
      );

      assignmentsForThisDate.forEach((assignment) => {
        const assignmentElement = createTimelineAssignmentElement(
          assignment,
          timelineRow,
        );
        timelineCell.appendChild(assignmentElement);
      });

      timelineRow.appendChild(timelineCell);
    });

    // Insert the timeline row at the top
    if (timelineRecords.firstChild) {
      timelineRecords.insertBefore(timelineRow, timelineRecords.firstChild);
    } else {
      timelineRecords.appendChild(timelineRow);
    }

    console.log(`${DEBUG_PREFIX} Added custom assignments timeline row`);
  } catch (error) {
    console.error(`${DEBUG_PREFIX} Error injecting timeline row:`, error);
  }
}

function getCustomAssignmentsForDate(
  customAssignments,
  headerCell,
  columnIndex,
) {
  // Extract date from header cell
  const headerText = headerCell.querySelector("h4")?.textContent;
  if (!headerText) return [];

  // Parse the date from header text (e.g., "Wednesday, Sep 03")
  const headerDate = parseHeaderDate(headerText);
  if (!headerDate) return [];

  // Find assignments due on this date
  return customAssignments.filter((assignment) => {
    if (!assignment.dueDate) return false;

    const assignmentDate = new Date(assignment.dueDate);
    return (
      assignmentDate.getFullYear() === headerDate.getFullYear() &&
      assignmentDate.getMonth() === headerDate.getMonth() &&
      assignmentDate.getDate() === headerDate.getDate()
    );
  });
}

function parseHeaderDate(headerText) {
  try {
    // Parse dates like "Wednesday, Sep 03" or "Monday, Oct 06"
    const currentYear = new Date().getFullYear();

    // Extract month and day from text like "Wednesday, Sep 03"
    const parts = headerText.split(", ");
    if (parts.length !== 2) return null;

    const datePart = parts[1]; // "Sep 03"
    const dateStr = `${datePart}, ${currentYear}`; // "Sep 03, 2024"

    const parsed = new Date(dateStr);

    // Check if date is valid
    if (isNaN(parsed.getTime())) return null;

    return parsed;
  } catch (error) {
    console.warn(
      `${DEBUG_PREFIX} Error parsing header date: ${headerText}`,
      error,
    );
    return null;
  }
}

function createTimelineAssignmentElement(assignment, parentRow) {
  // Create assignment div that matches Veracross timeline structure exactly
  const assignmentDiv = document.createElement("div");
  assignmentDiv.className = "assignment vch-decorated vch-custom-assignment";
  assignmentDiv.setAttribute("data-preview", "custom-assignment");
  assignmentDiv.setAttribute("data-custom-assignment-id", assignment.id);
  assignmentDiv.setAttribute("data-vch-custom", "true");

  // Create assignment type span matching native Veracross style exactly
  const typeSpan = document.createElement("span");
  typeSpan.className = "assignment-type";
  const assignmentType = assignment.isPastDue ? "Homework" : "Custom";
  const borderColor = assignment.isPastDue ? "#dc3545" : "#007bff";
  typeSpan.setAttribute("title", assignmentType);
  typeSpan.style.cssText = `border-left: 4px solid ${borderColor};`;

  // Create task wrap with checkbox exactly like native assignments
  const taskWrap = document.createElement("span");
  taskWrap.className = "vch-task-wrap";
  taskWrap.setAttribute(
    "data-type",
    assignment.isPastDue ? "homework" : "custom",
  );

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "vch-checkbox";

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
  assignmentDiv._descriptionSpan = descriptionSpan;
  assignmentDiv._descriptionWhitespace = [
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

  // Add click handler
  assignmentDiv.addEventListener("click", (e) => {
    // Don't show modal if clicking on checkbox or task wrap
    if (
      !e.target.classList.contains("vch-checkbox") &&
      e.target.tagName !== "INPUT" &&
      !e.target.closest(".vch-task-wrap")
    ) {
      e.stopPropagation();
      showCustomAssignmentDetails(assignment);
    }
  });

  return assignmentDiv;
}

function createCustomAssignmentElement(assignment) {
  // This function is for sidebar assignments (currently unused)
  // Timeline assignments use createTimelineAssignmentElement
  return null;
}

function showCustomAssignmentDetails(assignment) {
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
    background: ${assignment.isPastDue ? "#856404" : "#2c3e50"};
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
  headerTitle.textContent = assignment.isPastDue
    ? "PAST DUE REMINDER"
    : "CUSTOM ASSIGNMENT";

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
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      closeModal();
    }
  };

  const closeModal = () => {
    modal.style.opacity = "0";
    popup.style.transform = "scale(0.9)";
    setTimeout(() => {
      modal.remove();
      document.removeEventListener("keydown", handleEscape);
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
  const options = { weekday: "short", month: "short", day: "numeric" };
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
  if (assignment.class) {
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
    classInfo.appendChild(document.createTextNode(assignment.class));
    content.appendChild(classInfo);
  }

  // Original due date for past due assignments
  if (assignment.isPastDue && assignment.originalDueDate) {
    const originalDiv = document.createElement("div");
    originalDiv.style.cssText = `
      margin-top: 10px;
      font-size: 12px;
      color: #dc3545;
    `;
    originalDiv.textContent = `Originally due: ${new Date(assignment.originalDueDate).toLocaleDateString()}`;
    content.appendChild(originalDiv);
  }

  content.insertBefore(title, content.firstChild);
  content.insertBefore(dueDateDiv, title.nextSibling);

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

// Legacy functions - keeping for potential future use but not actively used

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString();
}

// Listen for messages from popup/window
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "refreshCustomAssignments") {
    setTimeout(() => {
      loadAndInjectCustomAssignments();
    }, 100);
    sendResponse({ success: true });
  }
});

// ———————————————— Init ————————————————
(async function init() {
  try {
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
      clearTimeout(scrollContainer.scrollTimeout);
      scrollContainer.scrollTimeout = setTimeout(() => {
        // fixTableAlignment(); // This function is removed
      }, 100);
    });

    if (settings.enableChecklist) {
      // Apply checklist directly to the current page
      // This works on all Veracross pages without iframe communication issues
      const checked = (await getStorage("vc_checked_assignments")) || {};

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
  } catch (error) {
    console.error(`${DEBUG_PREFIX} INITIALIZATION ERROR:`, error);
    console.error(`${DEBUG_PREFIX} Error stack:`, error.stack);
  }
})();
