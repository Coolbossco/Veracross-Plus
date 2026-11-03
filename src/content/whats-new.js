import browser from "webextension-polyfill";
import { changelogForVersion } from "../whats-new/changelog.js";
import {
  DEFAULT_THEME_ID,
  getTheme,
  WHATS_NEW_DEMO_THEME_IDS,
} from "../themes/registry.js";
import { loadTourHomeworkItems } from "./homepage.js";
import {
  formatDayHeading,
  groupHomeworkByCalendarDay,
  startOfDay,
} from "./homework-near-today.js";
import {
  formatLunchDayLabel,
  loadLunchWeek,
  parseIsoDate,
  toIsoDate,
  weekdaysFromMonday,
} from "./lunch.js";
import { isExtensionAlive } from "./storage.js";

const STORAGE_KEY = "vch_whats_new";
const MODAL_SEL = ".vch-whats-new";
const TOUR_HW_LIMIT = 5;

let whatsNewBound = false;

export async function initWhatsNew() {
  if (window !== window.top) return;
  bindWhatsNewListeners();
  await maybeShowWhatsNew();
}

function bindWhatsNewListeners() {
  if (whatsNewBound) return;
  whatsNewBound = true;

  browser.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionAlive() || area !== "local") return;
    if (!changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue;
    if (next?.pending) {
      void maybeShowWhatsNew();
    }
  });
}

async function maybeShowWhatsNew() {
  if (!isExtensionAlive() || window !== window.top) return;
  if (document.querySelector(MODAL_SEL)) return;

  let payload = null;
  try {
    const stored = await browser.storage.local.get({ [STORAGE_KEY]: null });
    payload = stored[STORAGE_KEY];
  } catch {
    return;
  }

  if (!payload?.pending || !payload.version) return;

  const current = browser.runtime.getManifest()?.version;
  if (!current || payload.version !== current) return;

  await renderWhatsNewTour(current);
}

/**
 * @param {string} version
 */
function tourSteps(version) {
  const bullets = changelogForVersion(version);
  return [
    {
      id: "intro",
      layout: "center",
      kicker: "Veracross Plus",
      title: "What’s new",
      badge: `v${version}`,
      html: `<ul class="vch-whats-new-list">${bullets
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul>`,
    },
    {
      id: "themes",
      layout: "coach",
      kicker: "Step 1",
      title: "Choose a theme",
      html: `<p class="vch-whats-new-copy">Themes restyle Veracross on this page. Pick one on the right — change it anytime from the toolbar popup.</p>`,
      stage: "themes",
    },
    {
      id: "homework",
      layout: "pair",
      kicker: "Step 2",
      title: "Homework on home",
      html: `<p class="vch-whats-new-copy">The homepage widget lists past-due and upcoming work. Try the preview: check items, hide the panel, or drag it.</p>`,
      stage: "homework",
    },
    {
      id: "lunch",
      layout: "pair",
      kicker: "Step 3",
      title: "Lunch on home",
      html: `<p class="vch-whats-new-copy">Lunch on Home shows today’s menu on the student home page. Flip days in the preview beside this card.</p>`,
      stage: "lunch",
    },
  ];
}

/**
 * @param {string} version
 */
async function renderWhatsNewTour(version) {
  document.querySelectorAll(MODAL_SEL).forEach((el) => el.remove());

  const steps = tourSteps(version);
  let index = 0;

  const root = document.createElement("div");
  root.className = "vch-whats-new";
  root.setAttribute("data-vch-skip-harden", "true");
  root.dataset.enter = "1";
  root.innerHTML = `
    <div class="vch-whats-new-backdrop"></div>
    <canvas class="vch-whats-new-confetti" aria-hidden="true"></canvas>
    <div class="vch-whats-new-stage" data-vch-wn-stage hidden></div>
    <div class="vch-whats-new-cluster" data-vch-wn-cluster>
      <div class="vch-whats-new-panel" role="dialog" aria-labelledby="vch-whats-new-title">
        <div class="vch-whats-new-header">
          <div>
            <div class="vch-whats-new-eyebrow" data-vch-wn-kicker></div>
            <h2 class="vch-whats-new-title" id="vch-whats-new-title" data-vch-wn-title></h2>
          </div>
          <span class="vch-whats-new-badge" data-vch-wn-badge hidden></span>
        </div>
        <div class="vch-whats-new-body" data-vch-wn-body></div>
        <div class="vch-whats-new-footer">
          <button type="button" class="vch-whats-new-skip" data-vch-wn-skip>Skip</button>
          <div class="vch-whats-new-dots" data-vch-wn-dots></div>
          <div class="vch-whats-new-actions">
            <button type="button" class="vch-whats-new-back" data-vch-wn-back hidden>Back</button>
            <button type="button" class="vch-whats-new-next" data-vch-wn-next>Continue</button>
          </div>
        </div>
      </div>
      <div class="vch-whats-new-demo-host" data-vch-wn-demo hidden></div>
    </div>
  `;

  const stage = root.querySelector("[data-vch-wn-stage]");
  const demoHost = root.querySelector("[data-vch-wn-demo]");
  const panel = root.querySelector(".vch-whats-new-panel");
  const body = root.querySelector("[data-vch-wn-body]");
  const dots = root.querySelector("[data-vch-wn-dots]");
  const backBtn = root.querySelector("[data-vch-wn-back]");
  const nextBtn = root.querySelector("[data-vch-wn-next]");
  let stepToken = 0;
  let firstPaint = true;

  const finish = async () => {
    root.remove();
    try {
      await browser.storage.local.set({
        [STORAGE_KEY]: {
          version,
          pending: false,
          lastSeenVersion: version,
        },
      });
    } catch {
      // Ignore.
    }
  };

  root.querySelector("[data-vch-wn-skip]")?.addEventListener("click", () => {
    void finish();
  });
  backBtn?.addEventListener("click", () => {
    if (index <= 0) return;
    index -= 1;
    void showStep();
  });
  nextBtn?.addEventListener("click", () => {
    if (index >= steps.length - 1) {
      void finish();
      return;
    }
    index += 1;
    void showStep();
  });

  async function showStep() {
    const token = ++stepToken;
    const step = steps[index];
    const prevLayout = root.dataset.layout || "";
    const layoutChanged = Boolean(prevLayout && prevLayout !== step.layout);

    // Fade outgoing stage/demo before swapping so coach → pair doesn't teleport.
    stage?.classList.remove("is-visible");
    demoHost?.classList.remove("is-visible");
    if (!firstPaint) {
      await delay(layoutChanged ? 280 : 160);
      if (token !== stepToken) return;
    }

    root.dataset.layout = step.layout;
    root.dataset.step = step.id;
    if (layoutChanged) {
      root.dataset.morph = `${prevLayout}-to-${step.layout}`;
    }

    const kicker = root.querySelector("[data-vch-wn-kicker]");
    const title = root.querySelector("[data-vch-wn-title]");
    const badge = root.querySelector("[data-vch-wn-badge]");
    if (kicker) kicker.textContent = step.kicker;
    if (title) title.textContent = step.title;
    if (badge) {
      badge.hidden = !step.badge;
      badge.textContent = step.badge || "";
    }
    if (body) body.innerHTML = step.html;
    if (nextBtn) {
      nextBtn.textContent = index === steps.length - 1 ? "Done" : "Continue";
    }
    if (backBtn) backBtn.hidden = index === 0;

    if (panel) {
      panel.classList.remove("is-swap");
      void panel.offsetWidth;
      panel.classList.add("is-swap");
    }

    if (dots) {
      dots.innerHTML = steps
        .map(
          (item, i) =>
            `<span class="vch-whats-new-dot${i === index ? " is-active" : ""}"></span>`,
        )
        .join("");
    }

    // Drag reparents cards onto the tour root; clear those too on step change.
    root
      .querySelectorAll(":scope > .vch-tour-preview")
      .forEach((el) => el.remove());

    if (stage) {
      if (step.stage === "themes") {
        stage.hidden = false;
        stage.innerHTML = "";
        stage.appendChild(await buildThemeStage());
        if (token !== stepToken) return;
        await delay(layoutChanged ? 120 : 30);
        if (token !== stepToken) return;
        stage.classList.add("is-visible");
      } else {
        stage.hidden = true;
        stage.innerHTML = "";
      }
    }

    if (demoHost) {
      const showDemo = step.stage === "homework" || step.stage === "lunch";
      if (!showDemo) {
        demoHost.hidden = true;
        demoHost.innerHTML = "";
      } else {
        demoHost.hidden = false;
        demoHost.innerHTML = "";
        if (step.stage === "homework") {
          demoHost.innerHTML = await buildHomeworkDemo();
          if (token !== stepToken) return;
          bindTourCard(demoHost.querySelector(".vch-tour-preview"), "homework");
        } else {
          const days = await loadTourLunchDays();
          if (token !== stepToken) return;
          demoHost.innerHTML = lunchDemoShell();
          bindTourCard(demoHost.querySelector(".vch-tour-preview"), "lunch", {
            days,
          });
        }
        await delay(layoutChanged ? 120 : 30);
        if (token !== stepToken) return;
        demoHost.classList.add("is-visible");
      }
    }

    firstPaint = false;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  document.body.appendChild(root);
  await showStep();
  window.setTimeout(() => {
    if (root.isConnected) root.dataset.enter = "0";
  }, 620);

  const canvas = root.querySelector(".vch-whats-new-confetti");
  if (canvas instanceof HTMLCanvasElement) {
    runConfetti(canvas);
  }
}

async function buildThemeStage() {
  const wrap = document.createElement("div");
  wrap.className = "vch-whats-new-theme-stage";
  wrap.innerHTML = `<div class="vch-whats-new-stage-label">Themes</div><div class="vch-whats-new-swatches" data-vch-wn-swatches></div>`;
  const host = wrap.querySelector("[data-vch-wn-swatches]");

  let selected = DEFAULT_THEME_ID;
  try {
    const stored = await browser.storage.sync.get({
      selectedTheme: DEFAULT_THEME_ID,
    });
    selected = stored.selectedTheme || DEFAULT_THEME_ID;
  } catch {
    selected = DEFAULT_THEME_ID;
  }

  for (const id of WHATS_NEW_DEMO_THEME_IDS) {
    const theme = id === DEFAULT_THEME_ID ? null : getTheme(id);
    if (id !== DEFAULT_THEME_ID && !theme) continue;
    const name = id === DEFAULT_THEME_ID ? "Default" : theme.name;
    const accent =
      id === DEFAULT_THEME_ID ? "#8b909a" : theme.tokens.accent || "#888";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vch-whats-new-swatch";
    if (selected === id) btn.classList.add("is-active");
    btn.dataset.themeId = id;
    btn.style.setProperty("--vch-swatch-accent", accent);
    btn.setAttribute("aria-label", `Use ${name}`);
    btn.innerHTML = `<span class="vch-whats-new-swatch-dot" aria-hidden="true"></span><span class="vch-whats-new-swatch-name">${escapeHtml(name)}</span>`;
    btn.addEventListener("click", async () => {
      host
        ?.querySelectorAll(".vch-whats-new-swatch")
        .forEach((el) => el.classList.remove("is-active"));
      btn.classList.add("is-active");
      try {
        await browser.storage.sync.set({ selectedTheme: id });
      } catch (error) {
        console.debug("Could not apply theme from tour.", error);
      }
    });
    host?.appendChild(btn);
  }

  return wrap;
}

function sampleHomeworkItems(now = new Date()) {
  const today = startOfDay(now);
  const daysAgo = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  const daysAhead = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d;
  };
  const yesterday = daysAgo(1);
  const nextWeek = daysAhead(7);
  const lastWeek = daysAgo(4);
  return [
    {
      title: "Reading response",
      className: "English",
      dueLabel: formatDayHeading(yesterday, today),
      type: "homework",
      checked: false,
      pastDue: true,
      dueDate: yesterday,
      dayLabel: formatDayHeading(yesterday, today),
    },
    {
      title: "Newton's Laws TEST",
      className: "Physics",
      dueLabel: formatDayHeading(nextWeek, today),
      type: "test",
      checked: false,
      pastDue: false,
      dueDate: nextWeek,
      dayLabel: formatDayHeading(nextWeek, today),
    },
    {
      title: "Problem set 4",
      className: "Trigonometry",
      dueLabel: formatDayHeading(lastWeek, today),
      type: "homework",
      checked: true,
      pastDue: false,
      dueDate: lastWeek,
      dayLabel: formatDayHeading(lastWeek, today),
    },
  ];
}

const SAMPLE_LUNCH_DAYS = [
  {
    date: "Mon, Nov 2",
    station: "Grill",
    primary: "Hamburger Patty",
    categories: [{ name: "Sides", items: ["Seasoned fries", "Fruit cup"] }],
  },
  {
    date: "Tue, Nov 3",
    station: "Breakfast for lunch",
    primary: "Belgian Waffles",
    categories: [{ name: "Sides", items: ["Whipped cream", "Berries"] }],
  },
  {
    date: "Fri, Oct 30",
    station: "Comfort",
    primary: "Sliced Zombie Meat",
    categories: [{ name: "Sides", items: ["Mashed potatoes", "Green beans"] }],
  },
];

/**
 * @returns {Promise<string>}
 */
async function buildHomeworkDemo() {
  let items = [];
  try {
    items = await loadTourHomeworkItems({ limit: TOUR_HW_LIMIT });
  } catch {
    items = [];
  }
  if (!items.length) items = sampleHomeworkItems();

  const { dayGroups, completed } = groupHomeworkByCalendarDay(items, {
    includeCompleted: true,
  });
  /** @type {Array<{ title: string, kind: string, items: typeof items, hideDue: boolean }>} */
  const groups = dayGroups.map((group) => ({
    title: group.label,
    kind: group.kind,
    items: group.items,
    hideDue: group.kind !== "undated",
  }));
  if (completed.length) {
    groups.push({
      title: "Completed",
      kind: "completed",
      items: completed,
      hideDue: false,
    });
  }
  if (!groups.length) {
    const fallback = sampleHomeworkItems();
    const again = groupHomeworkByCalendarDay(fallback, {
      includeCompleted: true,
    });
    for (const group of again.dayGroups) {
      groups.push({
        title: group.label,
        kind: group.kind,
        items: group.items,
        hideDue: group.kind !== "undated",
      });
    }
    if (again.completed.length) {
      groups.push({
        title: "Completed",
        kind: "completed",
        items: again.completed,
        hideDue: false,
      });
    }
  }

  return `
    <section class="vch-home-widget vch-tour-preview">
      <header class="vch-home-widget-header" data-vch-tour-drag>
        <span class="vch-panel-title">Upcoming &amp; past due</span>
        <button type="button" class="vch-panel-toggle" data-vch-tour-toggle>Hide</button>
      </header>
      <button type="button" class="vch-panel-chip" data-vch-tour-chip data-vch-tour-drag>
        <span class="vch-panel-chip-label">Due</span>
      </button>
      <div class="vch-home-widget-body">
        ${groups
          .map(
            (group) => `
          <section class="vch-home-group" data-vch-group="${escapeHtml(group.kind)}">
            <h3>${escapeHtml(group.title)}</h3>
            <ul class="vch-home-list">
              ${group.items
                .map((item) => homeworkItemHtml(item, { hideDue: group.hideDue }))
                .join("")}
            </ul>
          </section>`,
          )
          .join("")}
      </div>
    </section>
  `;
}

/**
 * @param {{ title: string, className: string, dueLabel: string, type: string, checked: boolean, pastDue?: boolean }} item
 * @param {{ hideDue?: boolean }} [opts]
 */
function homeworkItemHtml(item, { hideDue = false } = {}) {
  const meta = [item.className, hideDue ? "" : item.dueLabel]
    .filter(Boolean)
    .join(" · ");
  return `
    <li class="vch-home-item${item.checked ? " vch-done" : ""}">
      <span class="vch-task-wrap" data-type="${escapeHtml(item.type || "homework")}">
        <input class="vch-checkbox" type="checkbox"${item.checked ? " checked" : ""} />
      </span>
      <span class="vch-home-title">${escapeHtml(item.title)}</span>
      <span class="vch-home-meta">${escapeHtml(meta)}</span>
    </li>
  `;
}

function lunchDemoShell() {
  return `
    <section class="vch-lunch-card vch-tour-preview">
      <div class="vch-lunch-card-header" data-vch-tour-drag>
        <div class="vch-lunch-card-title-wrap">
          <div class="vch-lunch-card-title">Lunch</div>
          <button type="button" class="vch-panel-toggle" data-vch-tour-toggle>Hide</button>
        </div>
        <div class="vch-lunch-card-nav">
          <button type="button" class="vch-lunch-nav-btn" data-vch-tour-prev aria-label="Previous day">‹</button>
          <button type="button" class="vch-lunch-nav-btn vch-lunch-today-btn" data-vch-tour-today>Today</button>
          <button type="button" class="vch-lunch-nav-btn" data-vch-tour-next aria-label="Next day">›</button>
        </div>
      </div>
      <button type="button" class="vch-panel-chip" data-vch-tour-chip data-vch-tour-drag>
        <span class="vch-panel-chip-label">Lunch</span>
      </button>
      <div class="vch-lunch-card-date" data-vch-tour-date></div>
      <div class="vch-lunch-card-body" data-vch-tour-body></div>
      <div class="vch-lunch-card-footer">
        <span class="vch-lunch-menu-link">Full Sage menu</span>
      </div>
    </section>
  `;
}

/**
 * @returns {Promise<Array<{
 *   date: string,
 *   station: string,
 *   primary: string,
 *   categories: Array<{ name: string, items: string[] }>,
 *   isToday?: boolean
 * }>>}
 */
async function loadTourLunchDays() {
  try {
    const week = await loadLunchWeek(new Date());
    const monday = parseIsoDate(week.monday);
    if (!monday) return SAMPLE_LUNCH_DAYS;

    const todayIso = toIsoDate(new Date());
    const days = weekdaysFromMonday(monday)
      .map((date) => {
        const iso = toIsoDate(date);
        const day = week.days?.[iso];
        if (!day || (!day.primary && !(day.categories || []).length)) {
          return null;
        }
        return {
          date: formatLunchDayLabel(date),
          station: day.station || "",
          primary: day.primary || "Lunch",
          categories: pickTourLunchCategories(day),
          isToday: iso === todayIso,
        };
      })
      .filter(Boolean);

    return days.length ? days : SAMPLE_LUNCH_DAYS;
  } catch {
    return SAMPLE_LUNCH_DAYS;
  }
}

/**
 * @param {{ station?: string, categories?: Array<{ name: string, items: string[] }> }} day
 */
function pickTourLunchCategories(day) {
  const preferred = [];
  const rest = [];
  for (const cat of day.categories || []) {
    if (!cat?.items?.length) continue;
    const slim = { name: cat.name, items: cat.items.slice(0, 6) };
    if (/entr|side|special|vegetable|soup|salad/i.test(cat.name)) {
      preferred.push(slim);
    } else if (day.station) {
      rest.push(slim);
    } else {
      preferred.push(slim);
    }
  }
  return [...preferred, ...rest].slice(0, 3);
}

/**
 * Demo-only drag, hide, checkboxes, and lunch day switching. Nothing is stored.
 * @param {Element | null} card
 * @param {"homework" | "lunch"} kind
 * @param {{ days?: typeof SAMPLE_LUNCH_DAYS }} [opts]
 */
function bindTourCard(card, kind, opts = {}) {
  if (!(card instanceof HTMLElement)) return;

  // Sit beside the dialog in the pair cluster; drag promotes to fixed.
  card.style.width = "";
  card.style.left = "";
  card.style.top = "";

  const collapsedClass =
    kind === "homework" ? "vch-home-widget--collapsed" : "vch-lunch-card--collapsed";

  const setCollapsed = (collapsed) => {
    card.classList.toggle(collapsedClass, collapsed);
    const toggle = card.querySelector("[data-vch-tour-toggle]");
    if (toggle) toggle.textContent = collapsed ? "Show" : "Hide";
  };

  card.querySelector("[data-vch-tour-toggle]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    setCollapsed(!card.classList.contains(collapsedClass));
  });
  card.querySelector("[data-vch-tour-chip]")?.addEventListener("click", () => {
    setCollapsed(false);
  });

  card.querySelectorAll(".vch-checkbox").forEach((box) => {
    if (!(box instanceof HTMLInputElement)) return;
    box.addEventListener("change", () => {
      box.closest(".vch-home-item")?.classList.toggle("vch-done", box.checked);
      box.closest(".vch-home-item")?.classList.add("vch-tour-check-pop");
    });
  });

  if (kind === "lunch") {
    const days =
      Array.isArray(opts.days) && opts.days.length
        ? opts.days
        : SAMPLE_LUNCH_DAYS;
    const todayIndex = Math.max(
      0,
      days.findIndex((day) => day.isToday),
    );
    let dayIndex = todayIndex;
    const paint = ({ animate = false } = {}) => {
      const day = days[dayIndex];
      const date = card.querySelector("[data-vch-tour-date]");
      const body = card.querySelector("[data-vch-tour-body]");
      if (date) date.textContent = day.date;
      if (body) {
        const station = day.station
          ? `<div class="vch-lunch-station">${escapeHtml(day.station)}</div>`
          : "";
        const cats = (day.categories || [])
          .map(
            (cat) => `
          <div class="vch-lunch-cat">
            <div class="vch-lunch-cat-name">${escapeHtml(cat.name)}</div>
            <ul class="vch-lunch-cat-items">
              ${(cat.items || [])
                .map((item) => `<li>${escapeHtml(item)}</li>`)
                .join("")}
            </ul>
          </div>`,
          )
          .join("");
        body.innerHTML = `
          ${station}
          <div class="vch-lunch-primary">${escapeHtml(day.primary)}</div>
          ${cats}
        `;
        if (animate) {
          body.classList.remove("is-day-swap");
          void body.offsetWidth;
          body.classList.add("is-day-swap");
        }
      }
    };
    paint();
    card.querySelector("[data-vch-tour-prev]")?.addEventListener("click", () => {
      dayIndex = (dayIndex + days.length - 1) % days.length;
      paint({ animate: true });
    });
    card.querySelector("[data-vch-tour-next]")?.addEventListener("click", () => {
      dayIndex = (dayIndex + 1) % days.length;
      paint({ animate: true });
    });
    card.querySelector("[data-vch-tour-today]")?.addEventListener("click", () => {
      dayIndex = todayIndex;
      paint({ animate: true });
    });
  }

  card.querySelectorAll("[data-vch-tour-drag]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (!(event instanceof PointerEvent)) return;
      if (event.target instanceof Element && event.target.closest("button, input, a")) {
        return;
      }
      event.preventDefault();
      const tourRoot = card.closest(".vch-whats-new");
      const startX = event.clientX;
      const startY = event.clientY;
      const rect = card.getBoundingClientRect();
      const originLeft = rect.left;
      const originTop = rect.top;

      // Lift out of the flex cluster so drag uses true viewport coordinates
      // and releasing doesn't snap the card back into the pair layout.
      if (tourRoot && card.parentElement !== tourRoot) {
        tourRoot.appendChild(card);
      }
      card.style.width = `${rect.width}px`;
      card.style.left = `${originLeft}px`;
      card.style.top = `${originTop}px`;
      card.classList.add("vch-panel-dragging", "vch-tour-moved");

      const move = (moveEvent) => {
        const left = Math.min(
          window.innerWidth - 48,
          Math.max(8, originLeft + moveEvent.clientX - startX),
        );
        const top = Math.min(
          window.innerHeight - 36,
          Math.max(8, originTop + moveEvent.clientY - startY),
        );
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
      };
      const up = () => {
        card.classList.remove("vch-panel-dragging");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 */
function runConfetti(canvas) {
  const host = canvas.parentElement;
  if (!host) return;

  const width = host.clientWidth || window.innerWidth;
  const height = host.clientHeight || window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const colors = ["#4a7fb5", "#6faf6a", "#e67a3a", "#b56bff", "#46d6b0"];
  const pieces = Array.from({ length: 28 }, () => ({
    x: width * 0.5 + (Math.random() - 0.5) * 280,
    y: height * 0.42,
    w: 4 + Math.random() * 4,
    h: 6 + Math.random() * 5,
    vx: -2.2 + Math.random() * 4.4,
    vy: -3.2 - Math.random() * 2.4,
    rot: Math.random() * Math.PI,
    vr: -0.15 + Math.random() * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const started = performance.now();
  const duration = 1200;

  function frame(now) {
    const elapsed = now - started;
    ctx.clearRect(0, 0, width, height);
    for (const piece of pieces) {
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.vy += 0.08;
      piece.rot += piece.vr;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rot);
      ctx.globalAlpha = Math.max(0, 1 - elapsed / duration);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      ctx.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, width, height);
  }

  requestAnimationFrame(frame);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
