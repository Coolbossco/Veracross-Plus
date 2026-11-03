import browser from "webextension-polyfill";
import {
  formatLunchDayLabel,
  loadLunchWeek,
  parseIsoDate,
  SAGE_MENU_URL,
  toIsoDate,
  weekMonday,
} from "./lunch.js";
import { isExtensionAlive } from "./storage.js";

const CHIP_SEL = ".vch-lunch-header-chip";
const DATE_ROW_SEL =
  ".timeline-header-x-inner > .timeline-row.header:not(.summary):not(.vch-lunch-header-row)";
const SUMMARY_ROW_SEL =
  ".timeline-header-x-inner > .timeline-row.header.summary";

let lunchTimelineSettings = {};
let lunchTimelineBound = false;
let lunchModalMsgBound = false;
let injectTimer = 0;
/** @type {Record<string, ReturnType<import("./lunch.js").normalizeSageDay>>} */
let weekCache = {};
/** @type {Set<string>} */
let loadedMondays = new Set();

export async function applyLunchTimeline(settings = {}) {
  lunchTimelineSettings = { ...lunchTimelineSettings, ...settings };
  bindLunchTimelineListeners();
  bindLunchModalMessages();

  if (!lunchTimelineSettings.enableLunchTimeline) {
    removeLunchTimelineUi();
    return;
  }

  if (!isPlannerContext()) {
    removeLunchTimelineUi();
    return;
  }

  await injectLunchIntoSummaryRow();
}

export function scheduleLunchTimelineRefresh(delayMs = 120) {
  if (!lunchTimelineSettings.enableLunchTimeline) return;
  clearTimeout(injectTimer);
  injectTimer = setTimeout(() => {
    if (!isExtensionAlive()) return;
    void injectLunchIntoSummaryRow();
  }, delayMs);
}

function bindLunchTimelineListeners() {
  if (lunchTimelineBound) return;
  lunchTimelineBound = true;

  browser.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionAlive() || area !== "sync") return;
    if (changes.enableLunchTimeline) {
      lunchTimelineSettings.enableLunchTimeline =
        !!changes.enableLunchTimeline.newValue;
      void applyLunchTimeline(lunchTimelineSettings);
    }
  });
}

function bindLunchModalMessages() {
  if (lunchModalMsgBound) return;
  lunchModalMsgBound = true;

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "VCH_SHOW_LUNCH_DETAIL" && data.payload) {
      // Planner lives in an iframe — always render the modal on the top page
      // so the backdrop covers the whole portal, not just the frame.
      if (window !== window.top) return;
      renderLunchDetailModal(data.payload);
    }
  });
}

function isPlannerContext() {
  return Boolean(
    document.querySelector("#planner.timeline, #planner .timeline, .timeline-records"),
  );
}

function removeLunchTimelineUi() {
  document.querySelectorAll(CHIP_SEL).forEach((el) => el.remove());
  document
    .querySelectorAll(
      ".vch-lunch-header-row, .vch-lunch-class-row, .vch-lunch-timeline-row",
    )
    .forEach((el) => el.remove());
  document.querySelectorAll(".vch-lunch-modal").forEach((el) => el.remove());
  restoreTimelineHeaderLayout();
}

function restoreTimelineHeaderLayout() {
  document.querySelectorAll("[data-vch-lunch-layout]").forEach((el) => {
    let saved = {};
    try {
      saved = JSON.parse(el.getAttribute("data-vch-lunch-layout") || "{}");
    } catch {
      saved = {};
    }
    for (const [prop, raw] of Object.entries(saved)) {
      el.style.setProperty(prop, raw ?? "");
    }
    el.removeAttribute("data-vch-lunch-layout");
    delete el.dataset.vchLunchBaseTop;
    delete el.dataset.vchLunchBaseHeight;
  });
}

/**
 * @param {HTMLElement} el
 * @param {string} prop
 * @param {string} value
 */
function setTrackedStyle(el, prop, value) {
  let saved = {};
  try {
    saved = JSON.parse(el.getAttribute("data-vch-lunch-layout") || "{}");
  } catch {
    saved = {};
  }
  if (!(prop in saved)) {
    saved[prop] = el.style.getPropertyValue(prop) || "";
    el.setAttribute("data-vch-lunch-layout", JSON.stringify(saved));
  }
  el.style.setProperty(prop, value);
}

/**
 * Remember stock sticky offsets before lunch chips change the header height.
 */
function captureLunchLayoutBaselines() {
  const headerX = document.querySelector(".timeline-header-x");
  if (headerX && !headerX.dataset.vchLunchBaseHeight) {
    headerX.dataset.vchLunchBaseHeight = String(headerX.offsetHeight || 0);
  }

  for (const sel of [
    ".timeline-records",
    ".timeline-header-y",
    ".timeline-header-intersect",
  ]) {
    const el = document.querySelector(sel);
    if (!el || el.dataset.vchLunchBaseTop) continue;

    const tracked = el.getAttribute("data-vch-lunch-layout");
    if (tracked) {
      try {
        const saved = JSON.parse(tracked);
        if ("top" in saved) el.style.setProperty("top", saved.top || "");
      } catch {
        // ignore
      }
    }
    el.dataset.vchLunchBaseTop = String(
      Number.parseFloat(getComputedStyle(el).top) || 0,
    );
  }
}

/**
 * Expand sticky header and shift class labels + records by the same delta so
 * the first class title is not clipped under the taller lunch header.
 * @param {HTMLElement} summaryRow
 */
function syncTimelineHeaderLayout(summaryRow) {
  const headerX = document.querySelector(".timeline-header-x");
  const dateRow = document.querySelector(DATE_ROW_SEL);
  if (!headerX || !dateRow || !summaryRow) return;

  captureLunchLayoutBaselines();

  const needed = dateRow.offsetHeight + summaryRow.offsetHeight;
  const baseHeight =
    Number.parseFloat(headerX.dataset.vchLunchBaseHeight) || needed;
  const extra = Math.max(0, needed - baseHeight);

  setTrackedStyle(headerX, "height", `${needed}px`);
  setTrackedStyle(headerX, "min-height", `${needed}px`);

  const intersect = document.querySelector(".timeline-header-intersect");
  if (intersect) {
    setTrackedStyle(intersect, "height", `${needed}px`);
    setTrackedStyle(intersect, "min-height", `${needed}px`);
  }

  if (extra <= 0) return;

  // Class names live in header-y; assignment cells live in records. Both must
  // move down with the expanded sticky header or the first row is clipped.
  for (const sel of [".timeline-records", ".timeline-header-y"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (!el.dataset.vchLunchBaseTop) {
      el.dataset.vchLunchBaseTop = String(
        Number.parseFloat(getComputedStyle(el).top) || 0,
      );
    }
    const baseTop = Number.parseFloat(el.dataset.vchLunchBaseTop) || 0;
    setTrackedStyle(el, "top", `${baseTop + extra}px`);
  }
}

async function injectLunchIntoSummaryRow() {
  if (!lunchTimelineSettings.enableLunchTimeline || !isPlannerContext()) {
    removeLunchTimelineUi();
    return;
  }

  // Remove the broken separate lunch row / old class-row approaches.
  document
    .querySelectorAll(
      ".vch-lunch-header-row, .vch-lunch-class-row, .vch-lunch-timeline-row",
    )
    .forEach((el) => el.remove());
  document.querySelectorAll(CHIP_SEL).forEach((el) => el.remove());

  const dateRow = document.querySelector(DATE_ROW_SEL);
  const summaryRow = document.querySelector(SUMMARY_ROW_SEL);
  const dateCells = dateRow
    ? Array.from(dateRow.querySelectorAll(":scope > .timeline-cell"))
    : [];
  const summaryCells = summaryRow
    ? Array.from(summaryRow.querySelectorAll(":scope > .timeline-cell"))
    : [];

  if (!dateCells.length || !summaryCells.length) return;

  const range = getVisibleDateRange(dateCells);
  if (!range) return;

  // Capture stock header/records offsets before chips change the layout.
  captureLunchLayoutBaselines();

  await ensureWeeksLoaded(range.start, range.end);

  const count = Math.min(dateCells.length, summaryCells.length);
  for (let i = 0; i < count; i++) {
    const date = parseHeaderCellDate(dateCells[i]);
    if (!date) continue;

    const day = weekCache[toIsoDate(date)];
    const cell = summaryCells[i];
    // Always reserve the lunch slot so ASSIGNMENTS DUE stays on one line.
    const chip = day?.primary
      ? createLunchHeaderChip(day)
      : createLunchHeaderSpacer();
    cell.insertBefore(chip, cell.firstChild);
  }

  requestAnimationFrame(() => {
    if (summaryRow) syncTimelineHeaderLayout(summaryRow);
  });
}

/**
 * @param {Date} start
 * @param {Date} end
 */
async function ensureWeeksLoaded(start, end) {
  const mondays = [];
  let cursor = weekMonday(start);
  const last = weekMonday(end);
  while (cursor <= last) {
    const iso = toIsoDate(cursor);
    if (!loadedMondays.has(iso)) mondays.push(new Date(cursor));
    cursor = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 7,
    );
  }

  if (!mondays.length) return;

  const chunkSize = 4;
  for (let i = 0; i < mondays.length; i += chunkSize) {
    const chunk = mondays.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (monday) => {
        const mondayIso = toIsoDate(monday);
        try {
          const payload = await loadLunchWeek(monday);
          weekCache = { ...weekCache, ...(payload.days || {}) };
          loadedMondays.add(payload.monday || mondayIso);
        } catch {
          loadedMondays.add(mondayIso);
        }
      }),
    );
  }
}

function getVisibleDateRange(headerCells) {
  let start = null;
  let end = null;
  headerCells.forEach((cell) => {
    const date = parseHeaderCellDate(cell);
    if (!date) return;
    if (!start || date < start) start = date;
    if (!end || date > end) end = date;
  });
  if (!start || !end) return null;
  return { start, end };
}

/**
 * @param {ReturnType<import("./lunch.js").normalizeSageDay>} day
 */
function createLunchHeaderChip(day) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "vch-lunch-header-chip";
  chip.setAttribute("data-vch-lunch-date", day.date);
  chip.setAttribute("data-vch-skip-harden", "true");
  chip.title = day.station
    ? `${day.station}: ${day.primary}`
    : day.primary;
  chip.textContent = day.primary;

  chip.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openLunchDetail(day);
  });

  return chip;
}

function createLunchHeaderSpacer() {
  const spacer = document.createElement("div");
  spacer.className = "vch-lunch-header-chip vch-lunch-header-chip--empty";
  spacer.setAttribute("data-vch-skip-harden", "true");
  spacer.title = "Not serving lunch";
  spacer.textContent = "Not Serving";
  return spacer;
}

function openLunchDetail(day) {
  if (window !== window.top) {
    try {
      window.top.postMessage({ type: "VCH_SHOW_LUNCH_DETAIL", payload: day }, "*");
      return;
    } catch {
      // Same-frame fallback below.
    }
  }
  renderLunchDetailModal(day);
}

function renderLunchDetailModal(day) {
  document.querySelectorAll(".vch-lunch-modal").forEach((el) => el.remove());

  const date = parseIsoDate(day.date);
  const label = date ? formatLunchDayLabel(date) : day.date;

  const modal = document.createElement("div");
  modal.className = "vch-lunch-modal";
  modal.setAttribute("data-vch-skip-harden", "true");
  modal.innerHTML = `
    <div class="vch-lunch-modal-backdrop" data-vch-lunch-close></div>
    <div class="vch-lunch-modal-panel" role="dialog" aria-label="Lunch menu">
      <div class="vch-lunch-modal-header">
        <div>
          <div class="vch-lunch-modal-title">${escapeHtml(day.station ? `Lunch · ${day.station}` : "Lunch")}</div>
          <div class="vch-lunch-modal-date">${escapeHtml(label)}</div>
        </div>
        <button type="button" class="vch-lunch-modal-close" data-vch-lunch-close aria-label="Close">×</button>
      </div>
      <div class="vch-lunch-modal-body">
        ${
          day.categories?.length
            ? day.categories
                .map(
                  (cat) => `
            <div class="vch-lunch-cat">
              <div class="vch-lunch-cat-name">${escapeHtml(cat.name)}</div>
              <ul class="vch-lunch-cat-items">
                ${cat.items
                  .map((item) => `<li>${escapeHtml(item)}</li>`)
                  .join("")}
              </ul>
            </div>`,
                )
                .join("")
            : `<p class="vch-lunch-status">No items listed.</p>`
        }
      </div>
      <div class="vch-lunch-modal-footer">
        <a href="${SAGE_MENU_URL}" target="_blank" rel="noopener noreferrer">Open Sage menu</a>
      </div>
    </div>
  `;

  modal.querySelectorAll("[data-vch-lunch-close]").forEach((el) => {
    el.addEventListener("click", () => modal.remove());
  });

  document.body.appendChild(modal);
}

function parseHeaderCellDate(headerCell) {
  let headerText = headerCell.querySelector("h4")?.textContent?.trim();
  if (!headerText || !headerText.includes(",")) {
    headerText = headerCell.textContent?.trim() || "";
  }
  headerText = headerText.replace(/\s+/g, " ").trim();
  if (
    !headerText.includes(",") ||
    headerText.includes("ASSIGNMENTS DUE") ||
    /^\d+\s+ASSIGNMENTS DUE/.test(headerText)
  ) {
    return null;
  }
  return parseHeaderDate(headerText);
}

function parseHeaderDate(headerText) {
  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const cleanedText = headerText.replace(/\s+/g, " ").trim();
    const parts = cleanedText.split(", ");
    if (parts.length !== 2) return null;

    const [monthStr, dayStr] = parts[1].split(" ");
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
    if (month == null || !day) return null;

    let year = currentYear;
    if (currentMonth <= 2 && month >= 10) year = currentYear - 1;
    if (currentMonth >= 10 && month <= 2) year = currentYear + 1;

    return new Date(year, month, day);
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
