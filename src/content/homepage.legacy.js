import browser from "webextension-polyfill";
import {
  assignmentStorageKey,
  bindChecklistStorageSync,
  compactCheckedMap,
  customAssignmentStorageKey,
  detectAssignmentType,
  isAssignmentChecked,
  setAssignmentChecked,
} from "./checklist.js";
import { showCustomAssignmentDetails } from "./custom-assignments.js";
import {
  applyOverlayPosition,
  bindOverlayDrag,
  bindResponsivePanel,
  clampOverlayPosition,
  restoreOverlayPosition,
  setPanelManualCollapse,
} from "./overlay-layout.js";
import {
  assignmentColor,
  getStorage,
  isExtensionAlive,
  loadCustomWorkspace,
  setStorage,
} from "./storage.js";

const DEFAULT_CLASS_LIST_COMPONENT_ID = "1308";
const EMBED_HOST = "https://portals-embed.veracross.com";
const SCHOOL_CACHE_KEY = "vch_school_assignment_cache";
const ASSESSMENT_CACHE_KEY = "vch_assessment_cache";
const WIDGET_POS_KEY = "vch_home_widget_pos";
const WIDGET_COLLAPSE_KEY = "vch_home_widget_collapsed";


const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

let homepageSettings = {};
let homepageBound = false;
let homepageRefreshTimer = 0;
let homepageRequestId = 0;
let memorySchoolItems = null;

/**
 * Compact assignment list for the what's-new tour. Prefers live/cached school
 * data (plus customs); returns [] so the tour can fall back to sample items.
 * Demo-only — does not write storage.
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<{
 *   title: string,
 *   className: string,
 *   dueLabel: string,
 *   type: string,
 *   checked: boolean
 * }>>}
 */
export async function loadTourHomeworkItems({ limit = 5 } = {}) {
  const cap = Math.max(1, Math.min(20, Number(limit) || 5));
  try {
    const [{ rows, assignments }, checked, cachedSchool] = await Promise.all([
      loadCustomWorkspace(),
      getStorage("vc_checked_assignments").then((value) => value || {}),
      memorySchoolItems
        ? Promise.resolve(memorySchoolItems)
        : readSchoolCache(),
    ]);

    let schoolItems = Array.isArray(cachedSchool) ? cachedSchool : [];
    if (!schoolItems.length) {
      try {
        const school = await loadSchoolAssignments();
        schoolItems = school.items || [];
        if (schoolItems.length) memorySchoolItems = schoolItems;
      } catch {
        schoolItems = [];
      }
    }

    const items = [
      ...schoolItems.map((item) => ({
        ...item,
        dueDate: item.dueDate ? new Date(item.dueDate) : null,
        checked: isAssignmentChecked(checked, item.storageKey),
      })),
      ...assignments.map((assignment) => {
        const row = rows.find((item) => item.id === assignment.rowId);
        return customToWidgetItem(assignment, row, checked);
      }),
    ];

    if (!items.length) return [];

    const open = sortGroup(items.filter((item) => !item.checked));
    const done = sortGroup(items.filter((item) => item.checked));
    return [...open, ...done].slice(0, cap).map((item) => ({
      title: item.title || "Untitled",
      className: item.className || "",
      dueLabel: formatDue(item),
      type: item.type || "homework",
      checked: !!item.checked,
    }));
  } catch {
    return [];
  }
}

export async function applyHomepageWidget(settings = {}) {
  homepageSettings = { ...homepageSettings, ...settings };
  bindHomepageListeners();
  bindChecklistStorageSync();

  if (!homepageSettings.enableHomepageWidget || window !== window.top) {
    removeHomepageWidget();
    return;
  }

  if (!isStudentHomePage()) {
    removeHomepageWidget();
    return;
  }

  const existing = document.querySelector(".vch-home-widget");
  const showLoading = !existing?.querySelector(".vch-home-item");
  await renderHomepageWidget({ showLoading });
}

function bindHomepageListeners() {
  if (homepageBound) return;
  homepageBound = true;

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !isExtensionAlive()) return;

    if (changes.enableHomepageWidget) {
      homepageSettings.enableHomepageWidget =
        !!changes.enableHomepageWidget.newValue;
    }
    if (changes.enableAssessmentCheckboxes) {
      homepageSettings.enableAssessmentCheckboxes =
        !!changes.enableAssessmentCheckboxes.newValue;
    }
    if (changes.homepageShowCompleted) {
      homepageSettings.homepageShowCompleted =
        !!changes.homepageShowCompleted.newValue;
    }

    if (changes.enableHomepageWidget) {
      scheduleHomepageRefresh({ reuseSchool: false });
      return;
    }

    if (
      changes.enableAssessmentCheckboxes ||
      changes.homepageShowCompleted ||
      changes.vc_checked_assignments ||
      changes.customAssignments ||
      changes.customRows
    ) {
      scheduleHomepageRefresh({ reuseSchool: true });
    }
  });
}

function scheduleHomepageRefresh({ reuseSchool = false } = {}) {
  clearTimeout(homepageRefreshTimer);
  homepageRefreshTimer = setTimeout(() => {
    renderHomepageWidget({
      showLoading: false,
      reuseSchool,
    });
  }, 80);
}

export function isStudentHomePage() {
  if (window !== window.top) return false;

  // Only the student portal home: /{tenant}/student (e.g. /ccds/student)
  const path = location.pathname.replace(/\/+$/, "") || "/";
  return /^\/[^/]+\/student$/i.test(path);
}

function findHomeMount() {
  return document.querySelector(".app-container") || document.body;
}

function placeWidget(widget) {
  document.body.appendChild(widget);
  bindWidgetDrag(widget);
  restoreWidgetPosition(widget);
}

async function waitForHomeMount(timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isStudentHomePage()) return null;
    const mount = document.querySelector(".app-container");
    if (mount) return mount;
    await delay(200);
  }
  return findHomeMount();
}

function defaultWidgetPosition(widget) {
  const toolbar = document.querySelector(".screen-toolbar, .app-container");
  const app = document.querySelector(".app-container");
  const width = widget.offsetWidth || 340;
  const top = Math.max(
    16,
    Math.round((toolbar?.getBoundingClientRect().top || 72) + 8),
  );
  let left = 16;
  if (app) {
    const appLeft = app.getBoundingClientRect().left;
    if (appLeft >= width + 28) {
      left = Math.round(appLeft - width - 12);
    }
  }
  return { left, top };
}

function applyWidgetPosition(widget, pos) {
  applyOverlayPosition(widget, pos);
}

function clampWidgetPosition(widget, pos) {
  return clampOverlayPosition(widget, pos);
}

async function restoreWidgetPosition(widget) {
  await restoreOverlayPosition(
    widget,
    WIDGET_POS_KEY,
    (pos) => applyWidgetPosition(widget, pos),
    (pos) => clampWidgetPosition(widget, pos),
    () => defaultWidgetPosition(widget),
  );
}

function bindWidgetDrag(widget) {
  bindOverlayDrag({
    panel: widget,
    headerSelector: ".vch-home-widget-header",
    storageKey: WIDGET_POS_KEY,
    applyPosition: (pos) => applyWidgetPosition(widget, pos),
    clampPosition: (pos) => clampWidgetPosition(widget, pos),
    onExpand: () => expandHomepageWidget(widget),
  });
}

function removeHomepageWidget() {
  document.querySelectorAll(".vch-home-widget").forEach((el) => el.remove());
}

function ensureWidgetShell(mount, { loading = false } = {}) {
  let widget = document.querySelector(".vch-home-widget");
  const manualCollapse = widget?.dataset?.vchManualCollapse || "";
  if (!widget) {
    widget = document.createElement("section");
    widget.className = "vch-home-widget";
    placeWidget(widget);
  } else if (widget.parentElement !== document.body) {
    placeWidget(widget);
  }

  widget.innerHTML = `
    <header class="vch-home-widget-header" title="Drag to move">
      <span class="vch-panel-title">Upcoming &amp; past due</span>
      <button type="button" class="vch-panel-toggle" data-vch-panel-toggle aria-label="Hide panel" title="Hide panel">Hide</button>
    </header>
    <button type="button" class="vch-panel-chip" data-vch-panel-chip aria-label="Open upcoming assignments" title="Drag to move · click to open">
      <span class="vch-panel-chip-label">Due</span>
      <span class="vch-panel-chip-action" aria-hidden="true">▸</span>
    </button>
    <div class="vch-home-widget-body">
      ${
        loading
          ? `<div class="vch-home-loading"><span class="vch-home-spinner" aria-hidden="true"></span><span>Loading assignments…</span></div>`
          : ""
      }
    </div>
  `;
  if (manualCollapse) widget.dataset.vchManualCollapse = manualCollapse;
  widget._vchDragBound = false;
  widget._vchResponsiveBound = false;
  bindWidgetDrag(widget);
  bindResponsivePanel({
    panel: widget,
    side: "left",
    collapsedClass: "vch-home-widget--collapsed",
    collapseStorageKey: WIDGET_COLLAPSE_KEY,
    onPlace: () => {
      if (widget.dataset.vchUserMoved === "1") {
        applyWidgetPosition(
          widget,
          clampWidgetPosition(widget, {
            left: parseFloat(widget.style.left) || 16,
            top: parseFloat(widget.style.top) || 80,
          }),
        );
      } else {
        applyWidgetPosition(widget, defaultWidgetPosition(widget));
      }
    },
  });
  widget.querySelector("[data-vch-panel-chip]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (widget._vchSkipChipExpand) {
      widget._vchSkipChipExpand = false;
      return;
    }
    expandHomepageWidget(widget);
  });
  return widget;
}

function expandHomepageWidget(widget) {
  setPanelManualCollapse(widget, false, "vch-home-widget--collapsed");
}

async function renderHomepageWidget({
  showLoading = true,
  reuseSchool = false,
} = {}) {
  const requestId = ++homepageRequestId;
  let mount = findHomeMount();
  if (!homepageSettings.enableHomepageWidget || !isStudentHomePage()) {
    removeHomepageWidget();
    return;
  }

  const hasItems = document.querySelector(".vch-home-widget .vch-home-item");
  let widget =
    document.querySelector(".vch-home-widget") ||
    ensureWidgetShell(mount, { loading: showLoading && !hasItems });

  if (showLoading && !hasItems && !reuseSchool) {
    ensureWidgetShell(mount, { loading: true });
    widget = document.querySelector(".vch-home-widget");
  }

  const resolvedMount = await waitForHomeMount();
  if (requestId !== homepageRequestId) return;
  if (!resolvedMount || !homepageSettings.enableHomepageWidget || !isStudentHomePage()) {
    removeHomepageWidget();
    return;
  }
  mount = resolvedMount;
  if (widget.parentElement !== document.body) {
    placeWidget(widget);
  } else {
    await restoreWidgetPosition(widget);
  }

  try {
    const [{ rows, assignments }, checked, cachedSchool] = await Promise.all([
      loadCustomWorkspace(),
      getStorage("vc_checked_assignments").then((value) => value || {}),
      reuseSchool && memorySchoolItems
        ? Promise.resolve(memorySchoolItems)
        : readSchoolCache(),
    ]);

    const toCustomItems = () =>
      assignments.map((assignment) => {
        const row = rows.find((item) => item.id === assignment.rowId);
        return customToWidgetItem(assignment, row, checked);
      });

    const mergeItems = (schoolItems) => [
      ...schoolItems.map((item) => ({
        ...item,
        checked: isAssignmentChecked(checked, item.storageKey),
      })),
      ...toCustomItems(),
    ];

    if (cachedSchool.length) {
      memorySchoolItems = cachedSchool;
      renderWidgetLists(widget, mergeItems(cachedSchool), "", {
        loading: !reuseSchool,
      });
    }

    if (reuseSchool && memorySchoolItems) {
      renderWidgetLists(widget, mergeItems(memorySchoolItems), "");
      return;
    }

    let schoolItems = cachedSchool;
    let warning = "";
    try {
      const school = await loadSchoolAssignments({
        onPartial: (partial) => {
          if (requestId !== homepageRequestId) return;
          renderWidgetLists(widget, mergeItems(partial), "", { loading: true });
        },
      });
      schoolItems = school.items;
      warning = school.warning;
      memorySchoolItems = schoolItems;
      writeSchoolCache(schoolItems);
    } catch (error) {
      warning = `Could not load school assignments: ${error?.message || "unknown error"}`;
      if (!schoolItems.length) {
        throw error;
      }
    }

    if (requestId !== homepageRequestId) return;

    const items = mergeItems(schoolItems);
    if (items.length === 0 && warning.startsWith("Could not load")) {
      renderWidgetError(widget);
      return;
    }

    renderWidgetLists(widget, items, warning);
  } catch (error) {
    if (requestId !== homepageRequestId) return;
    if (document.querySelector(".vch-home-item")) {
      return;
    }
    renderWidgetError(widget, error);
  }
}

function renderWidgetError(widget, _error) {
  const body = widget.querySelector(".vch-home-widget-body");
  body.innerHTML = `
    <p class="vch-home-status vch-home-error">Could not load upcoming assignments.</p>
    <button type="button" class="vch-btn vch-btn-secondary" data-vch-home-retry>Retry</button>
  `;
  body.querySelector("[data-vch-home-retry]").addEventListener("click", () => {
    renderHomepageWidget();
  });
  void error;
}

function renderWidgetLists(widget, items, warning, { loading = false } = {}) {
  const showCompleted = !!homepageSettings.homepageShowCompleted;
  const openItems = items.filter((item) => !item.checked);
  const completed = showCompleted
    ? sortGroup(items.filter((item) => item.checked))
    : [];
  const pastDue = sortGroup(openItems.filter((item) => isPastDue(item)));
  const upcoming = sortGroup(openItems.filter((item) => !isPastDue(item)));
  const body = widget.querySelector(".vch-home-widget-body");
  const hasVisible = openItems.length > 0 || completed.length > 0;

  if (!hasVisible && !loading) {
    body.innerHTML = `
      <p class="vch-home-status">No assignments found.</p>
      ${warning ? `<p class="vch-home-status">${escapeHtml(warning)}</p>` : ""}
    `;
    return;
  }

  body.innerHTML = "";
  if (warning) {
    const note = document.createElement("p");
    note.className = "vch-home-status";
    note.textContent = warning;
    body.appendChild(note);
  }
  if (pastDue.length) {
    body.appendChild(renderGroup("Past due", pastDue));
  }
  if (upcoming.length) {
    body.appendChild(renderGroup("Upcoming", upcoming));
  }
  if (completed.length) {
    body.appendChild(renderGroup("Completed", completed));
  }
  if (loading) {
    const updating = document.createElement("p");
    updating.className = "vch-home-loading vch-home-loading-inline";
    updating.innerHTML =
      `<span class="vch-home-spinner" aria-hidden="true"></span><span>Updating…</span>`;
    body.appendChild(updating);
  }
}

function renderGroup(title, items) {
  const section = document.createElement("section");
  section.className = "vch-home-group";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "vch-home-list";
  items.forEach((item) => list.appendChild(renderItem(item)));
  section.appendChild(list);
  return section;
}

function renderItem(item) {
  const li = document.createElement("li");
  li.className = "vch-home-item";
  if (item.checked) li.classList.add("vch-done");
  if (item.color) li.style.borderLeftColor = item.color;

  const allowCheckbox =
    item.source === "custom" ||
    !item.assessment ||
    homepageSettings.enableAssessmentCheckboxes;

  if (allowCheckbox) {
    const wrap = document.createElement("span");
    wrap.className = "vch-task-wrap";
    wrap.setAttribute("data-type", item.type);
    wrap.setAttribute("data-vch-storage-key", item.storageKey);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "vch-checkbox";
    checkbox.checked = !!item.checked;
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      toggleChecked(item, checkbox.checked, li);
    });
    wrap.appendChild(checkbox);
    li.appendChild(wrap);
  } else {
    const mark = document.createElement("span");
    mark.className = "vch-task-wrap";
    mark.setAttribute("data-type", item.type);
    li.appendChild(mark);
  }

  const title = item.href
    ? document.createElement("a")
    : document.createElement("button");
  title.className = "vch-home-title";
  title.textContent = item.title;
  if (item.href) {
    title.href = item.href;
  } else {
    title.type = "button";
    title.addEventListener("click", () => {
      if (item.assignment) showCustomAssignmentDetails(item.assignment);
    });
  }
  li.appendChild(title);

  const meta = document.createElement("span");
  meta.className = "vch-home-meta";
  meta.textContent = [formatType(item), item.className, formatDue(item)]
    .filter(Boolean)
    .join(" · ");
  li.appendChild(meta);

  return li;
}

async function toggleChecked(item, isChecked, row) {
  try {
    const checked = (await getStorage("vc_checked_assignments")) || {};
    setAssignmentChecked(checked, item.storageKey, isChecked);
    row.classList.toggle("vch-done", isChecked);
    await setStorage({
      vc_checked_assignments: compactCheckedMap(checked),
    });
    // Re-group Past due / Upcoming / Completed so toggles stay coherent.
    scheduleHomepageRefresh({ reuseSchool: true });
  } catch {
    // Ignore invalidated extension context.
  }
}

function customToWidgetItem(assignment, row, checked) {
  const storageKey = customAssignmentStorageKey(assignment.id);
  return {
    source: "custom",
    id: assignment.id,
    title: assignment.title || "Untitled",
    dueDate: parseAssignmentDate(assignment.dueDate),
    dueDateText: assignment.dueDate || "",
    type: "custom",
    assessment: false,
    href: "",
    className: assignment.class || row?.name || "",
    color: assignmentColor(assignment, row),
    assignment,
    storageKey,
    checked: isAssignmentChecked(checked, storageKey),
  };
}

async function loadSchoolAssignments({ onPartial } = {}) {
  const tenant = location.pathname.split("/").filter(Boolean)[0] || "";
  if (!tenant) {
    throw new Error("Could not identify school");
  }

  const path = `/${tenant}/student`;
  const studentHost = location.origin.includes("veracross.com")
    ? location.origin
    : "https://portals.veracross.com";
  const csrfToken =
    discoverCsrfToken(document) ||
    (await safeCsrfFromUrl(`${studentHost}${path}`));
  if (!csrfToken) {
    throw new Error("Missing CSRF token");
  }

  const componentId = discoverClassListComponentId();
  const coursesResponse = await fetchJsonWithFallback(
    `${studentHost}${path}/component/ClassListStudent/${componentId}/load_data`,
    apiHeaders(csrfToken),
  );
  const courses = (coursesResponse.courses ?? []).filter(
    (course) => course.enrollment_pk && course.display_assignments !== 0,
  );

  if (courses.length === 0) {
    return { items: [], warning: "No classes with assignments were returned." };
  }

  let failed = 0;
  let lastAssignmentError = "";
  const collected = [];
  await Promise.all(
    courses.map(async (course) => {
      try {
        const data = await fetchCourseAssignments(
          course,
          path,
          studentHost,
          csrfToken,
        );
        const items = (data.assignments ?? [])
          .map((assignment) =>
            schoolApiAssignmentToItem(assignment, course, studentHost, path),
          )
          .filter(Boolean);
        collected.push(...items);
        onPartial?.(dedupeItems(collected));
      } catch (error) {
        failed += 1;
        lastAssignmentError = error?.message || "assignment request failed";
      }
    }),
  );

  const items = dedupeItems(collected);
  if (items.length === 0) {
    return {
      items,
      warning: lastAssignmentError
        ? `Could not load school assignments: ${lastAssignmentError}`
        : "No school assignments were returned.",
    };
  }
  if (failed) {
    return {
      items,
      warning: `Loaded assignments from ${courses.length - failed} of ${courses.length} classes.`,
    };
  }
  return { items, warning: "" };
}

async function fetchCourseAssignments(course, path, studentHost, csrfToken) {
  const headers = apiHeaders(csrfToken);
  try {
    return await extensionFetchJson(
      `${EMBED_HOST}${path}/enrollment/${course.enrollment_pk}/assignments`,
      headers,
    );
  } catch (embedError) {
    try {
      return await fetchJsonWithFallback(
        `${studentHost}${path}/enrollment/${course.enrollment_pk}/assignments`,
        headers,
      );
    } catch {
      throw embedError;
    }
  }
}

function discoverCsrfToken(doc) {
  const fromMeta = readCsrfToken(doc);
  if (fromMeta) return fromMeta;

  const input = doc.querySelector?.(
    'input[name="authenticity_token"], input[name="csrf_token"]',
  );
  if (input?.value) return input.value;

  const html = doc.documentElement?.innerHTML || "";
  return parseCsrfFromHtml(html) || parseCsrfFromJs(html);
}

function readCsrfToken(doc) {
  if (!doc) return "";
  return (
    doc.querySelector?.('meta[name="csrf-token"]')?.getAttribute("content") ||
    doc.querySelector?.('meta[name="csrf_token"]')?.getAttribute("content") ||
    ""
  );
}

function parseCsrfFromJs(html) {
  const match = String(html).match(
    /csrf[_-]?token["']?\s*[:=]\s*["']([^"']{8,})["']/i,
  );
  return match?.[1] || "";
}

function parseCsrfFromHtml(html) {
  const match =
    String(html).match(
      /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    String(html).match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i,
    );
  return match?.[1] || "";
}

async function fetchCsrfFromHtml(url) {
  const html = await extensionFetchText(url);
  return parseCsrfFromHtml(html) || parseCsrfFromJs(html);
}

async function safeCsrfFromUrl(url) {
  try {
    return await fetchCsrfFromHtml(url);
  } catch {
    return "";
  }
}

async function fetchJsonWithFallback(url, headers) {
  try {
    if (new URL(url).origin === location.origin) {
      const response = await fetch(url, { credentials: "include", headers });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      return await response.json();
    }
  } catch {
    // Fall through to the background fetch.
  }
  return extensionFetchJson(url, headers);
}

function apiHeaders(csrfToken) {
  return {
    Accept: "*/*",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-CSRF-Token": csrfToken,
    "X-Requested-With": "XMLHttpRequest",
  };
}

async function extensionFetchJson(url, headers) {
  const result = await browser.runtime.sendMessage({
    type: "VCH_FETCH",
    url,
    headers,
    as: "json",
  });
  if (!result?.ok) {
    throw new Error(result?.error || "Request failed");
  }
  return result.data;
}

async function extensionFetchText(url) {
  const result = await browser.runtime.sendMessage({
    type: "VCH_FETCH",
    url,
    headers: { Accept: "text/html" },
    as: "text",
  });
  if (!result?.ok) {
    throw new Error(result?.error || "Request failed");
  }
  return result.text;
}

function schoolApiAssignmentToItem(assignment, course, host, path) {
  const title = String(assignment.assignment_description || "").trim();
  if (!title) return null;

  const id = assignment.assignment_id || assignment.id;
  const dateText =
    assignment._date || assignment.due_date_long || assignment.due_date || "";
  const detected = detectAssignmentType(
    String(assignment.assignment_type || "").toLowerCase(),
  );

  return {
    source: "school",
    id: id ? String(id) : "",
    title,
    dueDate: parseAssignmentDate(dateText),
    dueDateText:
      assignment.due_date_long || assignment.due_date || dateText,
    type: detected.type,
    assessment: detected.assessment,
    href: course.enrollment_pk
      ? `${host}${path}/classes/${course.enrollment_pk}`
      : "",
    className: course.class_name || "",
    storageKey: assignmentStorageKey({
      assignmentId: id ? String(id) : undefined,
      text: title,
      dateText,
    }),
  };
}

function discoverClassListComponentId() {
  const selectors = [
    "[href*='ClassListStudent/']",
    "[src*='ClassListStudent/']",
    "[data-url*='ClassListStudent/']",
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const value =
      element?.getAttribute("href") ||
      element?.getAttribute("src") ||
      element?.getAttribute("data-url");
    const match = value?.match(/ClassListStudent\/(\d+)\/load_data/i);
    if (match?.[1]) return match[1];
  }
  for (const script of document.scripts) {
    const match = script.textContent?.match(
      /ClassListStudent\/(\d+)\/load_data/i,
    );
    if (match?.[1]) return match[1];
  }
  return DEFAULT_CLASS_LIST_COMPONENT_ID;
}

function parseAssignmentDate(value) {
  if (!value) return null;
  const text = String(value);

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const month = Number(slash[1]) - 1;
    const day = Number(slash[2]);
    let year = slash[3] ? Number(slash[3]) : new Date().getFullYear();
    if (year < 100) year += 2000;
    return normalizeYear(new Date(year, month, day), !slash[3]);
  }

  const named = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/i,
  );
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    const day = Number(named[2]);
    const year = named[3] ? Number(named[3]) : new Date().getFullYear();
    if (month == null) return null;
    return normalizeYear(new Date(year, month, day), !named[3]);
  }

  return null;
}

function normalizeYear(date, guessedYear) {
  if (!guessedYear || Number.isNaN(date.getTime())) return date;
  const today = startOfToday();
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  if (date < sixMonthsAgo) {
    date.setFullYear(date.getFullYear() + 1);
  }
  return date;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isPastDue(item) {
  if (item.forcedPastDue) return true;
  if (!item.dueDate || Number.isNaN(item.dueDate.getTime())) return false;
  return item.dueDate < startOfToday();
}

function sortGroup(items) {
  return [...items].sort((a, b) => {
    if (!!a.checked !== !!b.checked) return a.checked ? 1 : -1;
    const aTime = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.title.localeCompare(b.title);
  });
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.storageKey || `${item.title}|${item.dueDateText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatType(item) {
  if (item.source === "custom") return "Custom";
  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

function formatDue(item) {
  if (item.dueDate && !Number.isNaN(item.dueDate.getTime())) {
    return item.dueDate.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  return item.dueDateText || "";
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readSchoolCache() {
  try {
    const stored = await browser.storage.local.get(SCHOOL_CACHE_KEY);
    const cache = stored[SCHOOL_CACHE_KEY];
    if (!cache || cache.host !== location.host || !Array.isArray(cache.items)) {
      return [];
    }
    return cache.items.map((item) => ({
      ...item,
      dueDate: item.dueDate ? new Date(item.dueDate) : null,
    }));
  } catch {
    return [];
  }
}

async function writeSchoolCache(items) {
  try {
    await browser.storage.local.set({
      [SCHOOL_CACHE_KEY]: {
        host: location.host,
        savedAt: Date.now(),
        items: items.map((item) => ({
          ...item,
          dueDate: item.dueDate ? item.dueDate.toISOString() : null,
        })),
      },
    });
    await writeAssessmentCache(items);
  } catch {
    // Ignore quota / invalidated context.
  }
}

async function writeAssessmentCache(items) {
  try {
    const assessments = items
      .filter((item) => item.assessment)
      .map((item) => ({
        id: item.id || item.storageKey,
        title: item.title || "",
        type: item.type || "assessment",
        dueDate: item.dueDate ? item.dueDate.toISOString() : null,
        dueDateText: item.dueDateText || "",
        className: item.className || "",
        storageKey: item.storageKey,
        host: location.host,
      }));

    await browser.storage.local.set({
      [ASSESSMENT_CACHE_KEY]: {
        host: location.host,
        portalOrigin: location.origin,
        savedAt: Date.now(),
        items: assessments,
      },
    });
  } catch {
    // Ignore quota / invalidated context.
  }
}
