import browser from "webextension-polyfill";
import { isStudentHomePage } from "./homepage.js";
import {
  formatLunchDayLabel,
  loadLunchWeek,
  parseIsoDate,
  peekLunchWeek,
  SAGE_MENU_URL,
  toIsoDate,
  weekMonday,
} from "./lunch.js";
import {
  applyOverlayPosition,
  bindOverlayDrag,
  bindResponsivePanel,
  clampOverlayPosition,
  restoreOverlayPosition,
  setPanelManualCollapse,
} from "./overlay-layout.js";
import { isExtensionAlive } from "./storage.js";

const CARD_SEL = ".vch-lunch-card";
const LUNCH_POS_KEY = "vch_lunch_card_pos";
const LUNCH_COLLAPSE_KEY = "vch_lunch_card_collapsed";

let lunchHomeSettings = {};
let lunchHomeBound = false;
let selectedIso = toIsoDate(new Date());
let weekPayload = null;
let loadError = "";

export async function applyLunchHome(settings = {}) {
  lunchHomeSettings = { ...lunchHomeSettings, ...settings };

  if (!lunchHomeSettings.enableLunchHomepage || window !== window.top) {
    removeLunchCard();
    return;
  }

  if (!isStudentHomePage()) {
    removeLunchCard();
    return;
  }

  bindLunchHomeListeners();
  await renderLunchCard();
}

function bindLunchHomeListeners() {
  if (lunchHomeBound) return;
  lunchHomeBound = true;

  browser.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionAlive() || area !== "sync") return;
    if (changes.enableLunchHomepage) {
      lunchHomeSettings.enableLunchHomepage =
        !!changes.enableLunchHomepage.newValue;
      if (lunchHomeSettings.enableLunchHomepage) {
        void applyLunchHome(lunchHomeSettings);
      } else {
        removeLunchCard();
      }
    }
  });
}

function removeLunchCard() {
  document.querySelectorAll(CARD_SEL).forEach((el) => el.remove());
}

function ensureLunchCard() {
  let card = document.querySelector(CARD_SEL);
  const manualCollapse = card?.dataset?.vchManualCollapse || "";
  const userMoved = card?.dataset?.vchUserMoved || "";
  if (card) return card;

  card = document.createElement("aside");
  card.className = "vch-lunch-card";
  card.innerHTML = `
    <div class="vch-lunch-card-header" title="Drag to move">
      <div class="vch-lunch-card-title-wrap">
        <div class="vch-lunch-card-title">Lunch</div>
        <button type="button" class="vch-panel-toggle" data-vch-panel-toggle aria-label="Hide panel" title="Hide panel">Hide</button>
      </div>
      <div class="vch-lunch-card-nav">
        <button type="button" class="vch-lunch-nav-btn" data-vch-lunch-prev aria-label="Previous day">‹</button>
        <button type="button" class="vch-lunch-nav-btn vch-lunch-today-btn" data-vch-lunch-today>Today</button>
        <button type="button" class="vch-lunch-nav-btn" data-vch-lunch-next aria-label="Next day">›</button>
      </div>
    </div>
    <button type="button" class="vch-panel-chip" data-vch-panel-chip aria-label="Open lunch menu" title="Drag to move · click to open">
      <span class="vch-panel-chip-label">Lunch</span>
      <span class="vch-panel-chip-action" aria-hidden="true">▸</span>
    </button>
    <div class="vch-lunch-card-date" data-vch-lunch-date></div>
    <div class="vch-lunch-card-body" data-vch-lunch-body>
      ${lunchSkeletonHtml()}
    </div>
    <div class="vch-lunch-card-footer">
      <a class="vch-lunch-menu-link" href="${SAGE_MENU_URL}" target="_blank" rel="noopener noreferrer">Full Sage menu</a>
    </div>
  `;

  document.body.appendChild(card);
  if (manualCollapse) card.dataset.vchManualCollapse = manualCollapse;
  if (userMoved) card.dataset.vchUserMoved = userMoved;
  placeLunchCard(card);
  void restoreOverlayPosition(
    card,
    LUNCH_POS_KEY,
    (pos) => applyOverlayPosition(card, pos),
    (pos) => clampOverlayPosition(card, pos),
    () => defaultLunchPosition(card),
  );
  bindCardControls(card);
  bindOverlayDrag({
    panel: card,
    headerSelector: ".vch-lunch-card-header",
    storageKey: LUNCH_POS_KEY,
    applyPosition: (pos) => applyOverlayPosition(card, pos),
    clampPosition: (pos) => clampOverlayPosition(card, pos),
    onExpand: () => expandLunchCard(card),
  });
  bindResponsivePanel({
    panel: card,
    side: "right",
    collapsedClass: "vch-lunch-card--collapsed",
    collapseStorageKey: LUNCH_COLLAPSE_KEY,
    onPlace: () => placeLunchCard(card),
  });
  card.querySelector("[data-vch-panel-chip]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (card._vchSkipChipExpand) {
      card._vchSkipChipExpand = false;
      return;
    }
    expandLunchCard(card);
  });
  return card;
}

function expandLunchCard(card) {
  setPanelManualCollapse(card, false, "vch-lunch-card--collapsed");
  placeLunchCard(card);
}

function defaultLunchPosition(card) {
  const toolbar = document.querySelector(".screen-toolbar, .app-container");
  const app = document.querySelector(".app-container");
  const width = card.offsetWidth || 340;
  const top = Math.max(
    16,
    Math.round((toolbar?.getBoundingClientRect().top || 72) + 8),
  );

  let right = 16;
  if (app) {
    const appRight = window.innerWidth - app.getBoundingClientRect().right;
    if (appRight >= width + 28) {
      right = Math.round(appRight - width - 12);
      if (right < 16) right = 16;
    }
  }

  return {
    left: Math.max(8, window.innerWidth - width - right),
    top,
  };
}

function placeLunchCard(card) {
  if (card.dataset.vchUserMoved === "1") {
    applyOverlayPosition(
      card,
      clampOverlayPosition(card, {
        left: parseFloat(card.style.left) || 16,
        top: parseFloat(card.style.top) || 80,
      }),
    );
    return;
  }
  applyOverlayPosition(card, defaultLunchPosition(card));
}

function bindCardControls(card) {
  if (card._vchLunchBound) return;
  card._vchLunchBound = true;

  card.querySelector("[data-vch-lunch-prev]")?.addEventListener("click", () => {
    shiftSelectedDay(-1);
  });
  card.querySelector("[data-vch-lunch-next]")?.addEventListener("click", () => {
    shiftSelectedDay(1);
  });
  card.querySelector("[data-vch-lunch-today]")?.addEventListener("click", () => {
    selectedIso = toIsoDate(new Date());
    void renderLunchCard({ reuseWeek: true });
  });

  window.addEventListener("resize", () => {
    const el = document.querySelector(CARD_SEL);
    if (el) placeLunchCard(el);
  });
}

function shiftSelectedDay(delta) {
  const current = parseIsoDate(selectedIso) || new Date();
  current.setDate(current.getDate() + delta);
  selectedIso = toIsoDate(current);
  void renderLunchCard({ reuseWeek: true });
}

async function renderLunchCard({ reuseWeek = false } = {}) {
  if (!lunchHomeSettings.enableLunchHomepage || !isStudentHomePage()) {
    removeLunchCard();
    return;
  }

  const card = ensureLunchCard();
  placeLunchCard(card);

  const selected = parseIsoDate(selectedIso) || new Date();
  const monday = weekMonday(selected);
  const mondayIso = toIsoDate(monday);
  const todayIso = toIsoDate(new Date());

  const todayBtn = card.querySelector("[data-vch-lunch-today]");
  if (todayBtn) {
    todayBtn.hidden = selectedIso === todayIso;
  }

  const dateEl = card.querySelector("[data-vch-lunch-date]");
  if (dateEl) {
    dateEl.textContent = formatLunchDayLabel(selected);
  }

  const body = card.querySelector("[data-vch-lunch-body]");
  if (!body) return;

  const needFetch =
    !reuseWeek ||
    !weekPayload ||
    weekPayload.monday !== mondayIso;

  if (needFetch) {
    const warm =
      (weekPayload?.monday === mondayIso ? weekPayload : null) ||
      peekLunchWeek(selected);
    if (warm?.days && Object.keys(warm.days).length) {
      weekPayload = warm;
      paintLunchBody(body, selected, { animate: false });
    } else {
      setLunchBodyHtml(body, lunchSkeletonHtml(), { animate: false });
    }

    try {
      weekPayload = await loadLunchWeek(selected);
      loadError = weekPayload.error || "";
    } catch (error) {
      weekPayload = { monday: mondayIso, days: {} };
      loadError = error?.message || "Could not load lunch";
    }
    paintLunchBody(body, selected, { animate: true });
    return;
  }

  paintLunchBody(body, selected, { animate: true });
}

/**
 * @param {Element} body
 * @param {Date} selected
 * @param {{ animate?: boolean }} [opts]
 */
function paintLunchBody(body, selected, { animate = true } = {}) {
  const selectedKey = toIsoDate(selected);
  const day = weekPayload?.days?.[selectedKey];
  const isWeekend = selected.getDay() === 0 || selected.getDay() === 6;

  if (!day || (!day.primary && !day.categories?.length)) {
    const msg = isWeekend
      ? "No lunch menu for this day."
      : loadError
        ? `Could not load lunch. ${loadError}`
        : "No lunch menu for this day.";
    setLunchBodyHtml(
      body,
      `<p class="vch-lunch-status">${escapeHtml(msg)}</p>`,
      { animate },
    );
    return;
  }

  const previewCats = pickPreviewCategories(day);
  const stationLabel = day.station
    ? `<div class="vch-lunch-station">${escapeHtml(day.station)}</div>`
    : "";

  setLunchBodyHtml(
    body,
    `
    ${stationLabel}
    <div class="vch-lunch-primary">${escapeHtml(day.primary || "Lunch")}</div>
    ${previewCats
      .map(
        (cat) => `
      <div class="vch-lunch-cat">
        <div class="vch-lunch-cat-name">${escapeHtml(cat.name)}</div>
        <ul class="vch-lunch-cat-items">
          ${cat.items
            .slice(0, 6)
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("")}
        </ul>
      </div>`,
      )
      .join("")}
  `,
    { animate },
  );
}

/**
 * @param {Element} body
 * @param {string} html
 * @param {{ animate?: boolean }} [opts]
 */
function setLunchBodyHtml(body, html, { animate = true } = {}) {
  if (!(body instanceof HTMLElement)) {
    body.innerHTML = html;
    return;
  }
  body.classList.remove("is-lunch-enter");
  body.innerHTML = html;
  if (!animate) return;
  void body.offsetWidth;
  body.classList.add("is-lunch-enter");
}

function lunchSkeletonHtml() {
  return `
    <div class="vch-lunch-skeleton" aria-hidden="true">
      <div class="vch-lunch-skel-line vch-lunch-skel-station"></div>
      <div class="vch-lunch-skel-line vch-lunch-skel-primary"></div>
      <div class="vch-lunch-skel-line"></div>
      <div class="vch-lunch-skel-line"></div>
      <div class="vch-lunch-skel-line vch-lunch-skel-short"></div>
    </div>
  `;
}

/**
 * @param {ReturnType<import("./lunch.js").normalizeSageDay>} day
 */
function pickPreviewCategories(day) {
  // Crossroads-normalized days already only contain main-line items.
  // Show Entrées + sides/specials; skip soups/salads noise when station-scoped.
  const preferred = [];
  const rest = [];
  for (const cat of day.categories || []) {
    if (/entr/i.test(cat.name)) preferred.push(cat);
    else if (/side|special|vegetable/i.test(cat.name)) preferred.push(cat);
    else if (day.station) rest.push(cat);
    else if (/soup|salad|special/i.test(cat.name)) preferred.push(cat);
    else rest.push(cat);
  }
  return [...preferred, ...rest].slice(0, 3);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
