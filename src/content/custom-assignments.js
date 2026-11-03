import {
  bindChecklistStorageSync,
  compactCheckedMap,
  customAssignmentStorageKey,
  isAssignmentChecked,
  setAssignmentChecked,
} from "./checklist.js";
import {
  assignmentColor,
  createDefaultRow,
  DEFAULT_ASSIGNMENT_COLOR,
  DEFAULT_ROW_COLOR,
  getStorage,
  loadCustomWorkspace,
  setStorage,
} from "./storage.js";

// ———————————————— Feature 4: Custom Assignments ————————————————
let customAssignmentsInjected = false;
let injectionInProgress = false;
let instantUpdateInProgress = false;
let modalOpenInProgress = false;

export function resetCustomAssignmentState() {
  customAssignmentsInjected = false;
  injectionInProgress = false;
}

export function isInstantUpdateInProgress() {
  return instantUpdateInProgress;
}

function assignmentsForRow(assignments, rowId) {
  return assignments.filter((assignment) => assignment.rowId === rowId);
}

function removeInjectedCustomRows(root = document) {
  root
    .querySelectorAll(".vch-custom-class-row, .vch-custom-timeline-row")
    .forEach((el) => {
      if (el._vchObserver) {
        el._vchObserver.disconnect();
      }
      el.remove();
    });
}

function generateRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function closeAllVchModals() {
  document
    .querySelectorAll(".vch-assignment-modal, .vch-vc-overlay, .vch-modal-root")
    .forEach((el) => el.remove());
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  modalOpenInProgress = false;
  const floatingBtn = document.querySelector(".vch-floating-button");
  if (floatingBtn) {
    floatingBtn.style.visibility = "visible";
    floatingBtn.style.opacity = "0.9";
    floatingBtn.style.pointerEvents = "auto";
    floatingBtn.style.transform = "";
  }
  if (window !== window.top) {
    try {
      window.top.postMessage({ type: "VCH_SHOW_BUTTON" }, "*");
    } catch {
      // ignore
    }
  }
}

if (!window.__vchEscapeBound) {
  window.__vchEscapeBound = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (
      document.querySelector(
        ".vch-assignment-modal, .vch-vc-overlay, .vch-modal-root",
      )
    ) {
      closeAllVchModals();
      e.preventDefault();
    }
  });
}

function postToTop(type, payload) {
  if (window === window.top) {
    return false;
  }
  try {
    window.top.postMessage({ type, payload }, "*");
    return true;
  } catch {
    return false;
  }
}

function postToFrames(type, payload) {
  document.querySelectorAll("iframe").forEach((frame) => {
    try {
      frame.contentWindow?.postMessage({ type, payload }, "*");
    } catch {
      // Cross-origin frames can still receive this postMessage.
    }
  });
}

async function refreshCustomAssignmentViews() {
  if (window !== window.top) {
    await instantAssignmentUpdate();
    return;
  }
  postToFrames("VCH_REFRESH_ASSIGNMENTS");
}

window.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }

  if (data.type === "VCH_REFRESH_ASSIGNMENTS") {
    await instantAssignmentUpdate();
    return;
  }

  if (window !== window.top) {
    return;
  }

  if (data.type === "VCH_SHOW_ROW_EDITOR") {
    showRowEditorModal(data.payload || null);
  } else if (data.type === "VCH_SHOW_ASSIGNMENT_DETAILS" && data.payload) {
    showCustomAssignmentDetails(data.payload);
  } else if (data.type === "VCH_SHOW_ASSIGNMENT_FORM") {
    showCustomAssignmentModal(data.payload || {});
  }
});

// Add global event handler to prevent native Veracross modals for custom assignments
document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest(".tools, a.title, .vch-assignment-modal")) {
      return;
    }

    const assignmentDiv = e.target.closest(
      ".vch-custom-assignment[data-custom-assignment-id]",
    );
    if (assignmentDiv) {
      if (e.target.type === "checkbox" || e.target.closest(".vch-task-wrap")) {
        return;
      }

      if (e.target.classList.contains("vch-assignment-details")) {
        return;
      }

      // Only prevent default for timeline assignments (not assignments page)
      const isTimelineAssignment = assignmentDiv.closest(
        ".timeline-records, .timeline-row, .timeline-cell"
      );
      if (isTimelineAssignment) {
        // Always prevent native Veracross preview system from interfering for timeline
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }

      if (instantUpdateInProgress) {
        return;
      }

      if (document.querySelector(".vch-vc-overlay, .vch-assignment-modal")) {
        return;
      }

      const assignmentId = assignmentDiv.getAttribute(
        "data-custom-assignment-id"
      );
      if (assignmentId) {
        getStorage("customAssignments")
          .then((customAssignments) => {
            const assignment = (customAssignments || []).find(
              (a) => a.id === assignmentId
            );
            if (!assignment) {
              return;
            }
            if (!postToTop("VCH_SHOW_ASSIGNMENT_DETAILS", assignment)) {
              showCustomAssignmentDetails(assignment);
            }
          })
          .catch(() => {});
      }
    }
  },
  true
);

export async function applyCustomAssignments(settings) {
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
    injectionInProgress = false;
    return;
  }

  // If we're in the main page (not iframe), only add the floating button if on assignments page
  if (!isInIframe) {
    addFloatingAssignmentButton();

    // Set up message listener for button hide/show commands from iframe
    window.addEventListener("message", function (event) {
      if (event.data && event.data.type === "VCH_HIDE_BUTTON") {
        const floatingBtn = document.querySelector(".vch-floating-button");
        if (floatingBtn) {
          floatingBtn.style.visibility = "hidden";
          floatingBtn.style.opacity = "0";
          floatingBtn.style.pointerEvents = "none";
          floatingBtn.style.transform = "scale(0.8)";
        }
      } else if (event.data && event.data.type === "VCH_SHOW_BUTTON") {
        const floatingBtn = document.querySelector(".vch-floating-button");
        if (floatingBtn) {
          floatingBtn.style.visibility = "visible";
          floatingBtn.style.opacity = "0.9";
          floatingBtn.style.pointerEvents = "auto";
          floatingBtn.style.transform = "";
        }
      }
    });

    injectionInProgress = false;
    return;
  }

  // Add floating action button for new assignments
  addFloatingAssignmentButton();

  // Load and inject existing custom assignments
  await loadAndInjectCustomAssignments();

  injectionInProgress = false;
}

export function addFloatingAssignmentButton() {
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

  button.addEventListener("click", (e) => {
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
      showCustomAssignmentModal();
    }
  });

  document.body.appendChild(floatingButton);
}

async function loadAndInjectCustomAssignments() {
  const { assignments: customAssignments } = await loadCustomWorkspace();

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
          ".timeline-header-y-inner"
        );
        const timelineRows = document.querySelectorAll(
          ".timeline-row[data-row-id]"
        );

        if (timelineYHeader && timelineRows.length > 0) {
          injectAllCustomRows().then(() => {
            customAssignmentsInjected = true;
          });
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
      injectCustomAssignmentsToAssignmentsPage();
      customAssignmentsInjected = true;
    }
  }
}

async function showCustomAssignmentModal(prefillData = {}) {
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
  modal.className = "vch-assignment-modal vch-modal-root";
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
    background: var(--vch-surface, white);
    color: var(--vch-text, #333);
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
    <h3 style="margin: 0 0 20px 0; color: var(--vch-text, #333); font-size: 20px; word-wrap: break-word;">
      ${isEditing ? "Edit Assignment" : "Add Custom Assignment"}
    </h3>
    <form id="vch-assignment-form">
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--vch-text, #333);">Assignment Title *</label>
        <input type="text" id="vch-title" required style="width: 100%; max-width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" value="${
          prefillData.title || ""
        }">
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--vch-text, #333);">Description</label>
        <textarea id="vch-description" style="width: 100%; max-width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-height: 80px; resize: vertical; box-sizing: border-box;" placeholder="Assignment details...">${
          prefillData.description || ""
        }</textarea>
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--vch-text, #333);">Due Date *</label>
        <input type="date" id="vch-due-date" required style="width: 100%; max-width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" value="${
          prefillData.dueDate || ""
        }">
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--vch-text, #333);">Class/Subject</label>
        <input type="text" id="vch-class" style="width: 100%; max-width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" placeholder="e.g., Mathematics, English, Home" value="${
          prefillData.class || ""
        }">
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--vch-text, #333);">Row</label>
        <select id="vch-row" style="width: 100%; max-width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;"></select>
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--vch-text, #333);">Color</label>
        <input type="color" id="vch-color" style="width: 56px; height: 36px; padding: 2px; border: 1px solid #ddd; border-radius: 4px; background: var(--vch-surface, white); cursor: pointer;" value="${
          prefillData.color || DEFAULT_ASSIGNMENT_COLOR
        }">
      </div>

      <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; flex-wrap: wrap;">
        <button type="button" id="vch-cancel" class="vch-btn vch-btn-secondary">Cancel</button>
        <button type="submit" id="vch-submit" class="vch-btn vch-btn-primary"></button>
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

  const { rows } = await loadCustomWorkspace();
  const rowSelect = modalContent.querySelector("#vch-row");
  const selectedRowId = prefillData.rowId || rows[0]?.id;
  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = row.name;
    if (row.id === selectedRowId) option.selected = true;
    rowSelect.appendChild(option);
  });

  const colorInput = modalContent.querySelector("#vch-color");
  const selectedRow = rows.find((row) => row.id === selectedRowId) || rows[0];
  if (!prefillData.color && selectedRow?.color) {
    colorInput.value = selectedRow.color;
  }
  rowSelect.addEventListener("change", () => {
    const nextRow = rows.find((row) => row.id === rowSelect.value);
    if (nextRow?.color && !prefillData.color) {
      colorInput.value = nextRow.color;
    }
  });

  // Prevent multiple modals by adding a flag
  modal.setAttribute("data-modal-active", "true");

  // Hide floating button completely while modal is open
  const floatingBtn = document.querySelector(".vch-floating-button");
  if (floatingBtn) {
    floatingBtn.style.visibility = "hidden";
    floatingBtn.style.opacity = "0";
    floatingBtn.style.pointerEvents = "none";
    floatingBtn.style.transform = "scale(0.8)";
  }

  const closeModal = () => closeAllVchModals();

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Reset flag after modal is fully created and visible
  setTimeout(() => {
    modalOpenInProgress = false;
  }, 100);

  document.getElementById("vch-cancel").addEventListener("click", () => {
    closeModal();
  });

  document
    .getElementById("vch-assignment-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      const assignment = {
        id: prefillData.id || generateId(),
        title: document.getElementById("vch-title").value,
        description: document.getElementById("vch-description").value,
        dueDate: document.getElementById("vch-due-date").value,
        class: document.getElementById("vch-class").value,
        rowId: document.getElementById("vch-row").value || rows[0]?.id,
        color: document.getElementById("vch-color").value || DEFAULT_ASSIGNMENT_COLOR,
        createdAt: prefillData.createdAt || new Date().toISOString(),
      };

      await saveCustomAssignment(assignment);

      // Instantly update UI before closing modal
      const isInIframe = window !== window.top;
      if (isInIframe) {
        // We're in the iframe, directly refresh
        await instantAssignmentUpdate();
      } else {
        // We're in the main page, send message to iframe
        const iframe = document.querySelector("iframe.old-portals-iframe");
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            {
              type: "VCH_REFRESH_ASSIGNMENTS",
              assignment: assignment,
            },
            "*"
          );
        }
      }

      closeModal();
    });
}

async function refreshCustomAssignmentsWithRetry(retries = 3) {
  try {
    await refreshCustomAssignments();

    // Quick verification that assignments are visible
    setTimeout(async () => {
      const customAssignments = (await getStorage("customAssignments")) || [];
      const assignmentElements = document.querySelectorAll(
        "[data-custom-assignment-id]"
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
    ".vch-custom-class-row, .vch-custom-timeline-row, .vch-custom-assignment, .vch-custom-assignments-section, [data-vch-custom='true'], [data-custom-assignment-id]"
  );

  elementsToRemove.forEach((el) => {
    // Clean up any observers
    if (el._vchObserver) {
      el._vchObserver.disconnect();
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
    await injectCustomAssignmentsToAssignmentsPage();
    customAssignmentsInjected = true;
  }

  injectionInProgress = false;
}

async function injectCustomAssignmentsToAssignmentsPage() {
  try {
    const { rows, assignments: customAssignments } = await loadCustomWorkspace();
    if (!customAssignments || customAssignments.length === 0) {
      return;
    }

    // Find the assignments container
    let assignmentsContainer = document.querySelector(
      ".assignment-center-column, .upcoming-assignment, .assignment-list, .content-2-columns .x-column-inner"
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
          '[class*="assignment"], [class*="due"], .row, .item, .card'
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
            }
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
        assignmentsContainer.style.cssText = "margin: 20px; padding: 0;";
        // Insert as first child of body to avoid floating button area
        document.body.insertBefore(
          assignmentsContainer,
          document.body.firstChild
        );
      }
    }

    // Remove existing custom assignments section
    const existingSection = assignmentsContainer.querySelector(
      ".vch-custom-assignments-section"
    );
    if (existingSection) {
      existingSection.remove();
    }

    // Create custom assignments section with original styling
    const customSection = document.createElement("div");
    customSection.className = "vch-custom-assignments-section";
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "margin: 20px 0;";

    rows.forEach((row) => {
      const rowAssignments = assignmentsForRow(customAssignments, row.id);
      if (rowAssignments.length === 0 && rows.length > 1) {
        return;
      }

      const rowSection = document.createElement("div");
      rowSection.style.cssText = `margin: 0 0 16px 0; padding: 15px; border: 1px solid #ddd; border-left: 4px solid ${row.color || DEFAULT_ROW_COLOR}; border-radius: 8px; background-color: #f9f9f9;`;
      rowSection.innerHTML = `
      <h3 style="margin: 0 0 10px 0; color: var(--vch-text, #333); font-size: 16px;">
        ${escapeHtml(row.name)} (${rowAssignments.length})
      </h3>
      <div class="vch-custom-assignments-list"></div>
    `;

      const customList = rowSection.querySelector(".vch-custom-assignments-list");
      const sortedAssignments = [...rowAssignments].sort(
        (a, b) => new Date(a.dueDate) - new Date(b.dueDate)
      );

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
        const accent = assignmentColor(assignment, row);

        assignmentEl.innerHTML = `
      <div style="padding: 8px 12px; margin: 5px 0; border-left: 4px solid ${accent}; background-color: var(--vch-surface, white); border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="flex: 1;">
            <div style="font-weight: bold; color: var(--vch-text, #333); margin-bottom: 2px;">
              ${escapeHtml(assignment.title)}
            </div>
            <div style="font-size: 12px; color: #666;">
              Due: ${formattedDate}
            </div>
            ${
              assignment.description
                ? `<div style="font-size: 12px; color: #888; margin-top: 4px;">${escapeHtml(
                    assignment.description
                  )}</div>`
                : ""
            }
          </div>
          <div style="margin-left: 10px;">
            <button class="vch-assignment-details" data-assignment-id="${
              assignment.id
            }" style="padding: 4px 8px; background: ${accent}; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
              Details
            </button>
          </div>
        </div>
      </div>
    `;

        customList.appendChild(assignmentEl);
      });

      wrapper.appendChild(rowSection);
    });

    customSection.appendChild(wrapper);

    // Insert at the top of the assignments container
    assignmentsContainer.insertBefore(
      customSection,
      assignmentsContainer.firstChild
    );

    // Add click handlers for details buttons
    customSection.addEventListener("click", (e) => {
      if (e.target.classList.contains("vch-assignment-details")) {
        const assignmentId = e.target.getAttribute("data-assignment-id");
        const assignment = customAssignments.find((a) => a.id === assignmentId);
        if (assignment) {
          showCustomAssignmentDetails(assignment);
        }
      }
    });
  } catch (error) {
    // Silent error handling
  }
}

async function saveCustomAssignment(assignment) {
  const customAssignments = (await getStorage("customAssignments")) || [];

  // If assignment has an ID, update existing; otherwise add new
  const existingIndex = customAssignments.findIndex(
    (a) => a.id === assignment.id
  );
  if (existingIndex >= 0) {
    customAssignments[existingIndex] = assignment;
  } else {
    customAssignments.push(assignment);
  }

  await setStorage({ customAssignments });
}

async function immediatelyInjectNewAssignment(assignment) {
  await instantAssignmentUpdate();
}

export async function instantAssignmentUpdate() {
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

    await injectAllCustomRows();

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

    await injectAllCustomRows();

    customAssignmentsInjected = true;
  } catch (error) {
    // Fallback to the retry mechanism if immediate refresh fails
    setTimeout(async () => {
      await refreshCustomAssignmentsWithRetry(3);
    }, 10);
  }
}

function updateSidebarContent(sidebar, customAssignments) {
  const assignmentsList = sidebar.querySelector(".vch-assignments-list");
  if (!assignmentsList) return;

  // Clear and rebuild the assignments list
  assignmentsList.innerHTML = "";

  if (customAssignments.length === 0) {
    assignmentsList.innerHTML = `<div style="text-align: center; color: #666; font-style: italic; padding: 20px;">No custom assignments</div>`;
    return;
  }

  // Group assignments by date
  const groupedAssignments = {};
  customAssignments.forEach((assignment) => {
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

    groupedAssignments[date].forEach((assignment) => {
      const assignmentElement = createCustomAssignmentElement(assignment);
      dateSection.appendChild(assignmentElement);
    });

    assignmentsList.appendChild(dateSection);
  });

  // Update the count in the header
  const header = sidebar.querySelector("h3");
  if (header) {
    header.innerHTML = `📚 Custom Assignments (${customAssignments.length})`;
  }
}

function updateTimelineRowContent(timelineRow, customAssignments) {
  // Get timeline cells
  const timelineCells = timelineRow.querySelectorAll(".timeline-cell");

  // Create a map of existing assignments by ID for comparison
  const existingAssignments = new Map();
  timelineRow.querySelectorAll(".vch-custom-assignment").forEach((el) => {
    const id = el.getAttribute("data-custom-assignment-id");
    if (id) {
      existingAssignments.set(id, el);
    }
  });

  // Track which assignments we've processed
  const processedIds = new Set();

  customAssignments.forEach((assignment, index) => {
    // Parse date in local timezone to avoid UTC shift issues
    const dateParts = assignment.dueDate.split("-");
    const assignmentDate = new Date(
      parseInt(dateParts[0], 10), // year
      parseInt(dateParts[1], 10) - 1, // month (0-based)
      parseInt(dateParts[2], 10) // day
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
      const assignmentElement = createTimelineAssignmentElement(assignment);

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

function getColumnIndexForDate(assignmentDate) {
  // Use the exact same selector as the working initial load code
  const headerCells = document.querySelectorAll(
    ".timeline-header-x-inner .timeline-cell"
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

function parseColumnDateFormat(dateFormat) {
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
      May: 4,
      June: 5,
      July: 6,
      August: 7,
      September: 8,
      October: 9,
      November: 10,
      December: 11,
    };

    const monthNumber =
      monthMap[monthName] || monthMap[monthName.substring(0, 3)];
    if (monthNumber !== undefined) {
      const currentYear = new Date().getFullYear();
      const date = new Date(currentYear, monthNumber, parseInt(day));
      return date.toISOString().split("T")[0];
    }
  }
  return null;
}

async function deleteCustomAssignment(assignmentId) {
  const customAssignments = (await getStorage("customAssignments")) || [];
  const filteredAssignments = customAssignments.filter(
    (a) => a.id !== assignmentId
  );
  await setStorage({ customAssignments: filteredAssignments });

  // Check if we're in iframe or main page and handle accordingly
  const isInIframe = window !== window.top;
  if (isInIframe) {
    // We're in the iframe, directly refresh
    await instantAssignmentUpdate();
  } else {
    // We're in the main page, send message to iframe
    const iframe = document.querySelector("iframe.old-portals-iframe");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        {
          type: "VCH_REFRESH_ASSIGNMENTS",
        },
        "*"
      );
    }
  }
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

async function saveCustomRows(rows) {
  await setStorage({ customRows: rows.length ? rows : [createDefaultRow()] });
}

async function addOrUpdateCustomRow(nextRow, previousId) {
  const { rows, assignments } = await loadCustomWorkspace();
  const index = rows.findIndex((row) => row.id === (previousId || nextRow.id));
  if (index >= 0) {
    rows[index] = nextRow;
  } else {
    rows.push(nextRow);
  }
  await saveCustomRows(rows);
  return { rows, assignments };
}

async function deleteCustomRow(
  rowId,
  { assignmentAction = "delete", targetRowId } = {}
) {
  const { rows, assignments } = await loadCustomWorkspace();
  if (rows.length <= 1) {
    return;
  }
  const remaining = rows.filter((row) => row.id !== rowId);
  const nextAssignments =
    assignmentAction === "move"
      ? assignments.map((assignment) => {
          if (assignment.rowId !== rowId) {
            return assignment;
          }
          const fallbackId = remaining.some((row) => row.id === targetRowId)
            ? targetRowId
            : remaining[0].id;
          return { ...assignment, rowId: fallbackId };
        })
      : assignments.filter((assignment) => assignment.rowId !== rowId);

  await setStorage({
    customRows: remaining,
    customAssignments: nextAssignments,
  });
}

function showRowDeletePrompt({
  card,
  row,
  remainingRows,
  assignmentCount,
  onConfirm,
}) {
  if (card.querySelector(".vch-inline-confirm")) {
    return;
  }

  const hidden = [...card.children].filter(
    (el) => !el.classList.contains("vch-vc-header")
  );
  hidden.forEach((el) => {
    el.hidden = true;
  });

  const countLabel =
    assignmentCount === 1 ? "1 assignment" : `${assignmentCount} assignments`;
  const destinationOptions = remainingRows
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`
    )
    .join("");

  const assignmentChoices =
    assignmentCount > 0
      ? `
        <p>This row has ${countLabel}. What should happen to them?</p>
        <label class="vch-choice">
          <input type="radio" name="vch-row-delete-action" value="delete" checked>
          <span>Delete them</span>
        </label>
        <label class="vch-choice">
          <input type="radio" name="vch-row-delete-action" value="move">
          <span>Move them to</span>
          <select data-vch-move-target>${destinationOptions}</select>
        </label>
      `
      : `<p>This row has no assignments.</p>`;

  const panel = document.createElement("div");
  panel.className = "vch-inline-confirm";
  panel.innerHTML = `
    <div class="vch-inline-confirm-title">Delete "${escapeHtml(row.name)}"?</div>
    ${assignmentChoices}
    <div class="vch-vc-actions">
      <button type="button" class="vch-btn vch-btn-secondary" data-vch-confirm-cancel>Cancel</button>
      <button type="button" class="vch-btn vch-btn-danger" data-vch-confirm-ok>Delete Row</button>
    </div>
  `;
  card.appendChild(panel);

  const restore = () => {
    panel.remove();
    hidden.forEach((el) => {
      el.hidden = false;
    });
  };

  const moveSelect = panel.querySelector("[data-vch-move-target]");
  if (moveSelect) {
    const selectMove = () => {
      const moveRadio = panel.querySelector(
        'input[name="vch-row-delete-action"][value="move"]'
      );
      if (moveRadio) moveRadio.checked = true;
    };
    moveSelect.addEventListener("focus", selectMove);
    moveSelect.addEventListener("change", selectMove);
  }

  panel
    .querySelector("[data-vch-confirm-cancel]")
    .addEventListener("click", restore);
  panel
    .querySelector("[data-vch-confirm-ok]")
    .addEventListener("click", async () => {
      const action =
        panel.querySelector('input[name="vch-row-delete-action"]:checked')
          ?.value || "delete";
      panel.querySelector("[data-vch-confirm-ok]").disabled = true;
      try {
        await onConfirm({
          assignmentAction: assignmentCount > 0 ? action : "delete",
          targetRowId: moveSelect?.value,
        });
      } finally {
        if (document.body.contains(panel)) {
          restore();
        }
      }
    });
}

function showRowEditorModal(existingRow = null) {
  const existingModals = document.querySelectorAll(".vch-assignment-modal");
  existingModals.forEach((modal) => modal.remove());

  const isEditing = !!existingRow;
  const modal = document.createElement("div");
  modal.className = "vch-assignment-modal vch-modal-root";
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

  const content = document.createElement("div");
  content.className = "vch-modal-content";
  content.style.cssText = `
    background: var(--vch-surface, white);
    color: var(--vch-text, #333);
    border-radius: 8px;
    padding: 24px;
    width: 90%;
    max-width: 420px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  `;
  content.innerHTML = `
    <h3 style="margin: 0 0 20px 0; color: var(--vch-text, #333); font-size: 20px;">
      ${isEditing ? "Edit Row" : "Add Row"}
    </h3>
    <form id="vch-row-form">
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--vch-text, #333);">Row name *</label>
        <input type="text" id="vch-row-name" required placeholder="e.g., Home, Sports" value="${existingRow?.name || ""}" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--vch-text, #333);">Color</label>
        <input type="color" id="vch-row-color" value="${existingRow?.color || DEFAULT_ROW_COLOR}" style="width: 56px; height: 36px; padding: 2px; border: 1px solid #ddd; border-radius: 4px; background: var(--vch-surface, white); cursor: pointer;">
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end; flex-wrap: wrap;">
        ${isEditing ? `<button type="button" id="vch-row-delete" class="vch-btn vch-btn-danger" style="margin-right: auto;">Delete</button>` : ""}
        <button type="button" id="vch-row-cancel" class="vch-btn vch-btn-secondary">Cancel</button>
        <button type="submit" class="vch-btn vch-btn-primary">${isEditing ? "Save Row" : "Add Row"}</button>
      </div>
    </form>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  const closeModal = () => closeAllVchModals();
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  content.querySelector("#vch-row-cancel").addEventListener("click", closeModal);

  const deleteBtn = content.querySelector("#vch-row-delete");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const { rows, assignments } = await loadCustomWorkspace();
      if (rows.length <= 1) {
        showConfirmationModal(
          "Cannot delete row",
          "Keep at least one custom row. Rename this one instead.",
          "OK",
          "Close",
          closeModal
        );
        return;
      }
      showRowDeletePrompt({
        card: content,
        row: existingRow,
        remainingRows: rows.filter((row) => row.id !== existingRow.id),
        assignmentCount: assignmentsForRow(assignments, existingRow.id).length,
        onConfirm: async ({ assignmentAction, targetRowId }) => {
          await deleteCustomRow(existingRow.id, {
            assignmentAction,
            targetRowId,
          });
          closeModal();
          await refreshCustomAssignmentViews();
        },
      });
    });
  }

  content.querySelector("#vch-row-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = content.querySelector("#vch-row-name").value.trim();
    const color = content.querySelector("#vch-row-color").value || DEFAULT_ROW_COLOR;
    if (!name) return;
    await addOrUpdateCustomRow(
      {
        id: existingRow?.id || generateRowId(),
        name,
        color,
      },
      existingRow?.id
    );
    closeModal();
    await refreshCustomAssignmentViews();
  });
}

async function injectAllCustomRows() {
  try {
    const { rows, assignments } = await loadCustomWorkspace();
    const timelineYHeader = document.querySelector(".timeline-header-y-inner");
    const alternativeContainers = [
      ".timeline-header-y",
      ".timeline-left",
      ".left-panel",
      ".sidebar",
      ".timeline-table .timeline-header-y",
      "#planner .timeline-header-y",
    ];

    let container = timelineYHeader;
    if (!container) {
      for (const selector of alternativeContainers) {
        container = document.querySelector(selector);
        if (container) break;
      }
    }

    if (!container) {
      return;
    }

    removeInjectedCustomRows();

    [...rows].reverse().forEach((row, index, list) => {
      const rowAssignments = assignmentsForRow(assignments, row.id);
      injectCustomAssignmentsSidebarToContainer(container, row, rowAssignments, {
        showAddRow: index === list.length - 1,
      });
      injectCustomAssignmentsTimeline(row, rowAssignments);
    });
  } catch (error) {
    // Error injecting custom assignments
  }
}

function injectCustomAssignmentsSidebarToContainer(
  container,
  row,
  customAssignments,
  options = {}
) {
  // Validate inputs
  if (!container || !container.querySelector || !row) {
    return;
  }

  if (!Array.isArray(customAssignments)) {
    return;
  }

  // Create custom assignments timeline row that matches Veracross structure
  const customRow = document.createElement("div");

  // Copy exact structure and styling from native rows
  const firstExistingRow = document.querySelector(
    ".timeline-header-y-inner .timeline-row[data-row-id]:not(.vch-custom-class-row)"
  );
  if (firstExistingRow) {
    // Copy all classes and add our custom identifier
    customRow.className = firstExistingRow.className + " vch-custom-class-row";
    customRow.setAttribute("data-row-id", row.id);
    customRow.setAttribute("data-vch-row-id", row.id);

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
    customRow.setAttribute("data-row-id", row.id);
    customRow.setAttribute("data-vch-row-id", row.id);
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
  titleLink.setAttribute("title", `Edit ${row.name}`);
  titleLink.setAttribute("data-toggle-row", "true");
  titleLink.style.borderLeft = `4px solid ${row.color || DEFAULT_ROW_COLOR}`;
  titleLink.style.paddingLeft = "8px";

  // Create title text without expand arrow (like native classes)
  const titleText = document.createTextNode(row.name);
  titleLink.appendChild(titleText);
  titleLink.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!postToTop("VCH_SHOW_ROW_EDITOR", row)) {
      showRowEditorModal(row);
    }
  });

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

  if (options.showAddRow) {
    const addRowLink = document.createElement("a");
    addRowLink.href = "#";
    addRowLink.textContent = "add row";
    addRowLink.setAttribute("title", "Add another custom row");
    addRowLink.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (!postToTop("VCH_SHOW_ROW_EDITOR", null)) {
        showRowEditorModal();
      }
    });
    tools.appendChild(addRowLink);
  }

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
          if (target.style.display === "none") {
            target.style.display = "";
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
}

function injectCustomAssignmentsTimeline(row, customAssignments) {
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

    // Create custom assignments timeline row
    const timelineRow = document.createElement("div");
    if (!row) {
      return;
    }

    // Copy positioning and layout styles from existing timeline rows
    const firstNativeRow = timelineRecords.querySelector(
      ".timeline-row:not(.vch-custom-timeline-row)"
    );
    if (firstNativeRow) {
      // Copy all classes from native row, then add our custom classes
      timelineRow.className =
        firstNativeRow.className + " vch-custom-timeline-row";
      timelineRow.setAttribute("data-vch-custom-row", row.id);
      timelineRow.setAttribute("data-vch-row-id", row.id);

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
      timelineRow.setAttribute("data-vch-custom-row", row.id);
      timelineRow.setAttribute("data-vch-row-id", row.id);
    }

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
      true
    );

    // Detect initial closed state from other timeline rows
    const otherRows = timelineRecords.querySelectorAll(
      ".timeline-row:not(.vch-custom-timeline-row)"
    );
    const closedRowsCount = Array.from(otherRows).filter((row) =>
      row.classList.contains("closed")
    ).length;
    const shouldStartClosed = closedRowsCount > otherRows.length / 2;

    if (shouldStartClosed) {
      timelineRow.classList.add("closed");
    }

    // Closed/open layout is handled by Veracross .timeline-row.closed CSS.
    // Do not toggle .assignment-description display here — native chips leave
    // that node in the document and hide it with stylesheet rules.

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

    // Get timeline columns (dates) to create matching cells
    const headerColumns = document.querySelectorAll(
      ".timeline-header-x-inner .timeline-cell"
    );

    // Get the width of existing cells to match exactly
    const firstRowCells = timelineRecords
      .querySelector(".timeline-row:not(.vch-custom-timeline-row)")
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
          index
        );

        matchingAssignments.forEach((assignment) => {
          const assignmentEl = createTimelineAssignmentElement(
            assignment,
            timelineRow,
            row
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
      const themed = document.documentElement.hasAttribute("data-vch-theme");
      timelineRow.style.backgroundColor = themed
        ? "var(--vch-today)"
        : "#fffee0";
    }

    // Insert the timeline row at the top
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
  customAssignments,
  headerCell,
  columnIndex
) {
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
  const matchingAssignments = customAssignments.filter((assignment) => {
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
      assignmentDay
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

function parseHeaderDate(headerText) {
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

    const month = monthMap[monthStr];
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

function createTimelineAssignmentElement(assignment, parentRow, row) {
  // Create assignment div that matches Veracross timeline structure exactly
  const assignmentDiv = document.createElement("div");
  assignmentDiv.className = "assignment vch-decorated vch-custom-assignment";
  assignmentDiv.setAttribute("data-preview", "assignment");
  assignmentDiv.setAttribute("data-custom-assignment-id", assignment.id);
  assignmentDiv.setAttribute("data-vch-custom", "true");

  // Create assignment type span matching native Veracross style exactly
  const typeSpan = document.createElement("span");
  typeSpan.className = "assignment-type";
  const assignmentType = "Custom";
  const borderColor = assignmentColor(assignment, row);
  typeSpan.setAttribute("title", assignmentType);
  typeSpan.style.borderLeft = `4px solid ${borderColor}`;

  // Create task wrap with checkbox exactly like native assignments
  const taskWrap = document.createElement("span");
  taskWrap.className = "vch-task-wrap";
  taskWrap.setAttribute("data-type", "custom");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "vch-checkbox";

  // Add change event handler for strikethrough effect
  const storageKey = customAssignmentStorageKey(assignment.id);
  bindChecklistStorageSync();
  taskWrap.setAttribute("data-vch-storage-key", storageKey);
  checkbox.addEventListener("change", async () => {
    try {
      assignmentDiv.classList.toggle("vch-done", checkbox.checked);
      const checked = (await getStorage("vc_checked_assignments")) || {};
      setAssignmentChecked(checked, storageKey, checkbox.checked);
      await setStorage({
        vc_checked_assignments: compactCheckedMap(checked),
      });
    } catch {
      // Silent error handling
    }
  });

  // Load initial checkbox state from storage
  getStorage("vc_checked_assignments")
    .then((checked) => {
      if (isAssignmentChecked(checked, storageKey)) {
        checkbox.checked = true;
        assignmentDiv.classList.add("vch-done");
      }
    })
    .catch(() => {});

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

  // Native Veracross chips are pretty-printed. Those text nodes are part of
  // the collapsed inline layout (space after type, blank line before DUE).
  assignmentDiv.appendChild(document.createTextNode("\n      "));
  assignmentDiv.appendChild(typeSpan);
  assignmentDiv.appendChild(document.createTextNode("\n      "));
  assignmentDiv.appendChild(descriptionSpan);
  assignmentDiv.appendChild(document.createTextNode("\n\n      "));
  assignmentDiv.appendChild(dueBadge);
  assignmentDiv.appendChild(document.createTextNode("\n    "));

  // Click handling is now managed by the global event handler above
  // No individual click listener needed since global handler will catch it

  return assignmentDiv;
}

function createCustomAssignmentElement(assignment) {
  // This function is for sidebar assignments (currently unused)
  // Timeline assignments use createTimelineAssignmentElement
  return null;
}

function iconSvg(path) {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

export async function showCustomAssignmentDetails(assignment) {
  document.querySelectorAll(".vch-vc-overlay").forEach((el) => el.remove());

  const { rows } = await loadCustomWorkspace();
  const row = rows.find((item) => item.id === assignment.rowId);
  const accent = assignmentColor(assignment, row);
  const dueDate = assignment.dueDate
    ? new Date(
        parseInt(assignment.dueDate.slice(0, 4), 10),
        parseInt(assignment.dueDate.slice(5, 7), 10) - 1,
        parseInt(assignment.dueDate.slice(8, 10), 10),
      )
    : null;
  const dueLabel = dueDate
    ? dueDate.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "2-digit",
      })
    : "";

  const modal = document.createElement("div");
  modal.className = "vch-vc-overlay vch-modal-root";
  modal.innerHTML = `
    <div class="vch-vc-card">
      <div class="vch-vc-header" style="background: ${accent}">
        <span>CUSTOM</span>
        <button type="button" class="vch-vc-close" aria-label="Close">×</button>
      </div>
      <div class="vch-vc-body">
        <h1>${escapeHtml(assignment.title || "")}</h1>
        ${
          dueLabel
            ? `<div class="vch-vc-row">${iconSvg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>')}<strong>${escapeHtml(dueLabel)}</strong></div>`
            : ""
        }
        ${
          assignment.description
            ? `<div class="vch-vc-row">${iconSvg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>')}<span>${escapeHtml(assignment.description)}</span></div>`
            : ""
        }
        ${
          assignment.class
            ? `<div class="vch-vc-row">${iconSvg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>')}<span>${escapeHtml(assignment.class)}</span></div>`
            : ""
        }
        <div class="vch-vc-actions">
          <button type="button" class="vch-btn vch-btn-secondary" data-vch-edit>Edit</button>
          <button type="button" class="vch-btn vch-btn-danger" data-vch-delete>Delete</button>
        </div>
      </div>
    </div>
  `;

  const closeModal = () => closeAllVchModals();

  modal.querySelector(".vch-vc-close").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  modal.querySelector("[data-vch-edit]").addEventListener("click", () => {
    closeModal();
    if (!postToTop("VCH_SHOW_ASSIGNMENT_FORM", assignment)) {
      showCustomAssignmentModal(assignment);
    }
  });
  modal.querySelector("[data-vch-delete]").addEventListener("click", () => {
    showConfirmationModal(
      "Delete Assignment",
      `Are you sure you want to delete "${assignment.title}"? This action cannot be undone.`,
      "Delete",
      "Cancel",
      async () => {
        await deleteCustomAssignment(assignment.id);
        closeModal();
        await refreshCustomAssignmentViews();
      },
    );
  });

  document.body.style.overflow = "hidden";
  document.body.appendChild(modal);
}

function showConfirmationModal(
  title,
  message,
  confirmText,
  cancelText,
  onConfirm
) {
  const openModal = document.querySelector(
    ".vch-vc-overlay, .vch-assignment-modal"
  );
  const card = openModal?.querySelector(".vch-vc-card, .vch-modal-content");

  if (card) {
    if (card.querySelector(".vch-inline-confirm")) {
      return;
    }

    const hidden = [...card.children].filter(
      (el) => !el.classList.contains("vch-vc-header")
    );
    hidden.forEach((el) => {
      el.hidden = true;
    });

    const panel = document.createElement("div");
    panel.className = "vch-inline-confirm";
    panel.innerHTML = `
      <div class="vch-inline-confirm-title">${escapeHtml(title)}</div>
      <p>${escapeHtml(message)}</p>
      <div class="vch-vc-actions">
        <button type="button" class="vch-btn vch-btn-secondary" data-vch-confirm-cancel>${escapeHtml(cancelText)}</button>
        <button type="button" class="vch-btn vch-btn-danger" data-vch-confirm-ok>${escapeHtml(confirmText)}</button>
      </div>
    `;
    card.appendChild(panel);

    const restore = () => {
      panel.remove();
      hidden.forEach((el) => {
        el.hidden = false;
      });
    };

    panel
      .querySelector("[data-vch-confirm-cancel]")
      .addEventListener("click", restore);
    panel
      .querySelector("[data-vch-confirm-ok]")
      .addEventListener("click", async () => {
        panel.querySelector("[data-vch-confirm-ok]").disabled = true;
        try {
          if (onConfirm) await onConfirm();
        } finally {
          if (document.body.contains(panel)) {
            restore();
          }
        }
      });
    return;
  }

  const modal = document.createElement("div");
  modal.className = "vch-vc-overlay vch-modal-root";
  modal.innerHTML = `
    <div class="vch-vc-card">
      <div class="vch-vc-body">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        <div class="vch-vc-actions">
          <button type="button" class="vch-btn vch-btn-secondary" data-vch-confirm-cancel>${escapeHtml(cancelText)}</button>
          <button type="button" class="vch-btn vch-btn-danger" data-vch-confirm-ok>${escapeHtml(confirmText)}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  modal
    .querySelector("[data-vch-confirm-cancel]")
    .addEventListener("click", closeModal);
  modal
    .querySelector("[data-vch-confirm-ok]")
    .addEventListener("click", async () => {
      modal.querySelector("[data-vch-confirm-ok]").disabled = true;
      closeModal();
      if (onConfirm) await onConfirm();
    });
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
