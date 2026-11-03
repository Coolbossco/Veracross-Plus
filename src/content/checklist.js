import browser from "webextension-polyfill";
import { getStorage, hash, isExtensionAlive, setStorage } from "./storage.js";

let checklistSyncBound = false;

export function detectAssignmentType(typeText) {
  if (typeText.includes("homework") || typeText.includes("home work")) {
    return { type: "homework", assessment: false };
  }
  if (
    typeText.includes("classwork") ||
    typeText.includes("class work") ||
    typeText.includes("class participation") ||
    typeText.includes("participation") ||
    typeText.includes("lab")
  ) {
    return { type: "classwork", assessment: false };
  }
  if (typeText.includes("paper") || typeText.includes("essay")) {
    return { type: "paper", assessment: false };
  }
  if (typeText.includes("project")) {
    return { type: "project", assessment: true };
  }
  if (typeText.includes("quiz")) {
    return { type: "quiz", assessment: true };
  }
  if (
    typeText.includes("test") ||
    typeText.includes("exam") ||
    typeText.includes("final") ||
    typeText.includes("midterm") ||
    (typeText.includes("assessment") && !typeText.includes("paper"))
  ) {
    return { type: "test", assessment: true };
  }
  return { type: "homework", assessment: false };
}

/** portals-embed and portals must share checkbox state with the homepage widget */
export function normalizeChecklistHost(host = location.hostname) {
  return String(host || location.hostname || "")
    .toLowerCase()
    .replace(/^portals-embed\./, "portals.");
}

/**
 * Canonical checkbox key. School IDs are host-agnostic so homepage + embed iframe match.
 */
export function assignmentStorageKey({
  assignmentId,
  text = "",
  dateText = "",
  host = location.hostname,
} = {}) {
  if (assignmentId) return `id|${String(assignmentId)}`;
  const normalized = String(text).trim().replace(/\s+/g, " ");
  const nearDate = String(dateText).match(
    /\b(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})\b/,
  );
  return `text|${normalizeChecklistHost(host)}|${hash(
    normalized + (nearDate?.[0] || ""),
  )}`;
}

export function customAssignmentStorageKey(id) {
  return `custom-${id}`;
}

function keySuffix(key) {
  if (!key) return "";
  const parts = String(key).split("|");
  return parts[parts.length - 1] || "";
}

/** True if this map marks the assignment checked, including legacy host|id keys. */
export function isAssignmentChecked(checkedMap, key) {
  if (!checkedMap || !key) return false;
  if (checkedMap[key]) return true;

  // custom-* keys are exact only
  if (String(key).startsWith("custom-")) return false;

  const suffix = keySuffix(key);
  if (!suffix) return false;

  for (const [storedKey, value] of Object.entries(checkedMap)) {
    if (!value) continue;
    if (storedKey === suffix || storedKey === `id|${suffix}`) return true;
    if (storedKey.endsWith(`|${suffix}`)) return true;
  }
  return false;
}

/** Write checked state under the canonical key and drop legacy aliases. */
export function setAssignmentChecked(checkedMap, key, isChecked) {
  if (!checkedMap || !key) return checkedMap;

  if (String(key).startsWith("custom-")) {
    if (isChecked) checkedMap[key] = 1;
    else delete checkedMap[key];
    return checkedMap;
  }

  const suffix = keySuffix(key);
  for (const storedKey of Object.keys(checkedMap)) {
    if (storedKey === key) continue;
    if (
      storedKey === suffix ||
      storedKey === `id|${suffix}` ||
      storedKey.endsWith(`|${suffix}`)
    ) {
      delete checkedMap[storedKey];
    }
  }

  if (isChecked) checkedMap[key] = 1;
  else delete checkedMap[key];
  return checkedMap;
}

export function compactCheckedMap(checkedMap) {
  return Object.fromEntries(
    Object.entries(checkedMap || {}).filter(([, value]) => value),
  );
}

function extractAssignmentIdFromNode(node) {
  const stable =
    node.getAttribute?.("data-assignment-id") ||
    node
      .closest?.("[data-assignment-id]")
      ?.getAttribute("data-assignment-id");
  if (stable) return String(stable);

  const href =
    node.querySelector?.("a[href*='assignment']")?.getAttribute("href") ||
    node.closest?.("a[href*='assignment']")?.getAttribute("href") ||
    "";
  const match =
    href.match(/detail\/assignment\/([^/?#]+)/i) ||
    href.match(/\/assignments?\/([^/?#]+)/i) ||
    href.match(/[?&](?:assignment_id|id)=([^&]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function syncChecklistDom(checkedMap, root = document) {
  root.querySelectorAll(".vch-task-wrap[data-vch-storage-key]").forEach((wrap) => {
    const key = wrap.getAttribute("data-vch-storage-key");
    const cb = wrap.querySelector("input.vch-checkbox");
    if (!cb || !key) return;
    const on = isAssignmentChecked(checkedMap, key);
    cb.checked = on;
    const doneTarget =
      wrap.closest(
        ".vch-decorated, .assignment, .vch-custom-assignment, .vch-home-item, tr, li",
      ) || wrap.parentElement;
    doneTarget?.classList.toggle("vch-done", on);
  });
}

export function bindChecklistStorageSync() {
  if (checklistSyncBound) return;
  checklistSyncBound = true;

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.vc_checked_assignments || !isExtensionAlive()) {
      return;
    }
    syncChecklistDom(changes.vc_checked_assignments.newValue || {});
  });
}

export async function applyChecklist(settings = {}) {
  bindChecklistStorageSync();
  const checked = (await getStorage("vc_checked_assignments")) || {};
  applyChecklistToDocument(document, checked, settings);
}

export function applyChecklistToDocument(doc, checked, settings = {}) {
  bindChecklistStorageSync();
  const enableAssessmentCheckboxes = !!settings.enableAssessmentCheckboxes;
  // Only strip school-checklist wraps we own; leave custom/home widget alone
  doc.querySelectorAll(".vch-decorated .vch-task-wrap").forEach((wrap) => {
    if (wrap.closest(".vch-custom-assignment, .vch-home-item")) return;
    wrap.remove();
  });

  const selectors = [
    ".timeline-records > .timeline-record",
    ".timeline-records > [class*='assignment']",
    ".timeline-records > [class*='homework']",
    ".timeline-records > [class*='test']",
    ".timeline-records > [class*='paper']",
    ".timeline-records > [class*='classwork']",
    "main > [class*='assignment']",
    "main > [class*='homework']",
    "main > [class*='test']",
    "main > [class*='paper']",
    "main > [class*='classwork']",
    "[data-assignment-id]:not([class*='vch-decorated']):not(.vch-custom-assignment)",
    ".assignment-row:not([class*='vch-decorated'])",
    ".daily-schedule table.assignments td.assignment-description:not([class*='vch-decorated'])",
    ".schedule table.assignments td.assignment-description:not([class*='vch-decorated'])",
  ];

  const seen = new WeakSet();

  function keyForNode(node) {
    const stable = extractAssignmentIdFromNode(node);
    if (stable) {
      return assignmentStorageKey({ assignmentId: stable });
    }
    const text = node.textContent?.trim().replace(/\s+/g, " ") || "";
    const nearDate = node
      .closest("tr,li,div")
      ?.textContent?.match(/\b(?:\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\b/);
    return assignmentStorageKey({
      text,
      dateText: nearDate?.[0] || "",
    });
  }

  function decorate(node) {
    if (seen.has(node)) return;
    seen.add(node);

    const id = keyForNode(node);

    if (node.querySelector(".vch-task-wrap")) {
      return;
    }

    node.classList.add("vch-decorated");

    let insertTarget = node;

    if (node.classList.contains("assignment-description")) {
      const link = node.querySelector("a");
      if (link) {
        insertTarget = link;
      }
    } else {
      const firstTextElement = node.querySelector("a, span, div, p") || node;
      if (firstTextElement && firstTextElement !== node) {
        insertTarget = firstTextElement;
      }
    }

    if (insertTarget.querySelector(".vch-task-wrap")) {
      return;
    }

    const fullText = (node.textContent || "").toLowerCase();
    const nodeText = fullText.trim();

    let assignmentType = "homework";
    let shouldSkip = false;

    if (node.classList.contains("assignment-description")) {
      const row = node.closest("tr");
      if (row) {
        const typeCell = row.querySelector(".assignment-type");
        if (typeCell) {
          const detected = detectAssignmentType(typeCell.textContent.toLowerCase());
          assignmentType = detected.type;
          shouldSkip = detected.assessment && !enableAssessmentCheckboxes;
        }
      }
    } else {
      const detected = detectAssignmentType(nodeText);
      assignmentType = detected.type;
      shouldSkip = detected.assessment && !enableAssessmentCheckboxes;
    }

    if (shouldSkip) {
      return;
    }

    const isDailyScheduleAssignment = node.classList.contains(
      "assignment-description",
    );

    if (!isDailyScheduleAssignment) {
      if (nodeText.includes("summer work") && !nodeText.includes("due")) {
        return;
      }

      if (
        !nodeText.includes("due") &&
        !nodeText.includes("homework") &&
        !nodeText.includes("classwork") &&
        !nodeText.includes("paper") &&
        !nodeText.includes("assignment") &&
        !nodeText.includes("project") &&
        !nodeText.includes("test") &&
        !nodeText.includes("quiz") &&
        !nodeText.includes("exam") &&
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
    wrap.setAttribute("data-vch-storage-key", id);

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "vch-checkbox";

    let isChecked = isAssignmentChecked(checked, id);
    let isInUpcomingSection = false;

    let currentNode = node;
    for (let i = 0; i < 20 && currentNode; i++) {
      const text = currentNode.textContent?.toLowerCase() || "";
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
      currentNode =
        currentNode.parentElement || currentNode.previousElementSibling;
    }

    if (!isInUpcomingSection) {
      const allElements = document.querySelectorAll("*");
      let foundUpcoming = false;
      for (const element of allElements) {
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
      const monthNum = monthNames[month];

      if (monthNum !== undefined) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let dueDate = new Date(now.getFullYear(), monthNum, day);

        if (dueDate < today) {
          dueDate.setFullYear(now.getFullYear() + 1);
        }

        const isUpcomingByDate = dueDate >= today;

        if (
          !isAssignmentChecked(checked, id) &&
          (isUpcomingByDate || isInUpcomingSection)
        ) {
          isChecked = false;
        }
      }
    } else if (!isAssignmentChecked(checked, id) && isInUpcomingSection) {
      isChecked = false;
    }
    cb.checked = isChecked;

    if (cb.checked) {
      node.classList.add("vch-done");
    }

    cb.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    wrap.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
    });

    cb.addEventListener("change", async () => {
      try {
        setAssignmentChecked(checked, id, cb.checked);
        node.classList.toggle("vch-done", cb.checked);
        await setStorage({
          vc_checked_assignments: compactCheckedMap(checked),
        });
      } catch {
        // Silent error handling
      }
    });

    insertTarget.insertBefore(wrap, insertTarget.firstChild);
    wrap.appendChild(cb);
  }

  function scan() {
    selectors.forEach((sel) => {
      doc.querySelectorAll(sel).forEach((node) => {
        if (node.classList.contains("vch-decorated")) {
          return;
        }
        if (node.querySelector(".vch-task-wrap")) {
          return;
        }
        decorate(node);
      });
    });
  }

  scan();
  const mo = new MutationObserver(() => scan());
  mo.observe(doc.documentElement, { childList: true, subtree: true });
}
