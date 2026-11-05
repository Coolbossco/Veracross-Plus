/**
 * The Today / Previous / Next strip is not `.timeline-controls`.
 * Find the short full-width box that holds those links and sits above the
 * day columns, then paint that box. Do not change its layout.
 */

const WEEK_LABEL = /^(TODAY|PREVIOUS|NEXT)$/;
const SKIP_PAINT =
  "html, body, #planner, .timeline, .timeline-table, .timeline-records, .timeline-records-inner, .timeline-header-x, .timeline-header-y, .timeline-header-intersect, .timeline-header-x-inner, .timeline-header-y-inner, .app-container, .vx-nav, .vx-portal-nav, .vx-tab-bar, .screen-component";

function weekLabel(el) {
  const text = (el.textContent || "")
    .replace(/[←→‹›«»·.|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return WEEK_LABEL.test(text) ? text : "";
}

function parseRgb(color) {
  const rgb = String(color || "").match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i,
  );
  if (!rgb) return null;
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
}

function isPale(color) {
  const rgb = parseRgb(color);
  if (!rgb) return false;
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return lum > 0.82 && sat < 0.2;
}

function containsDayHeader(el) {
  return Boolean(
    el.querySelector?.(
      ".timeline-header-x, .timeline-header-x-inner, .timeline-row.header",
    ),
  );
}

/**
 * @param {HTMLElement} el
 * @param {boolean} keepImage
 */
function paintBar(el, keepImage) {
  if (!(el instanceof HTMLElement)) return;
  if (el.matches(SKIP_PAINT)) return;
  const already =
    el.dataset.vchWeekBar === "1" &&
    el.classList.contains("vch-week-bar") &&
    el.style.getPropertyValue("background-color").replace(/\s/g, "") ===
      "var(--vch-surface)";
  if (already) return;

  const native = [
    el.tagName.toLowerCase(),
    el.id ? `#${el.id}` : "",
    ...String(el.className || "")
      .trim()
      .split(/\s+/)
      .filter((name) => name && name !== "vch-week-bar")
      .map((name) => `.${name}`),
  ].join("");
  console.debug(`[veracross-plus] week bar ${native || el.tagName}`);

  el.classList.add("vch-week-bar");
  el.dataset.vchWeekBar = "1";
  el.style.setProperty("background-color", "var(--vch-surface)", "important");
  if (!keepImage) {
    el.style.setProperty("background-image", "none", "important");
  }
  el.style.setProperty("color", "var(--vch-text)", "important");
}

/**
 * Short full-width box around the week links, above the day columns.
 * If those links have no wrapper of their own, the pale parent that also
 * holds the day header is the surface that shows through as the white strip.
 * @param {HTMLElement[]} links
 * @returns {{ el: HTMLElement, keepImage: boolean } | null}
 */
function findWeekBar(links) {
  const viewWidth = document.documentElement.clientWidth || window.innerWidth;
  let el = links[0].parentElement;
  /** @type {HTMLElement | null} */
  let bar = null;
  /** @type {HTMLElement | null} */
  let blocked = null;

  while (el && el !== document.documentElement) {
    if (!links.every((link) => el.contains(link))) {
      el = el.parentElement;
      continue;
    }
    if (el.matches(SKIP_PAINT)) break;
    if (containsDayHeader(el)) {
      blocked = el;
      break;
    }
    const box = el.getBoundingClientRect();
    if (box.height > 140) break;
    bar = el;
    if (box.width >= viewWidth * 0.75) break;
    el = el.parentElement;
  }

  if (bar) return { el: bar, keepImage: false };
  if (
    blocked &&
    !blocked.matches(SKIP_PAINT) &&
    isPale(getComputedStyle(blocked).backgroundColor)
  ) {
    return { el: blocked, keepImage: true };
  }
  return null;
}

/**
 * @param {ParentNode} [root]
 */
export function paintWeekBar(root = document) {
  const links = [...root.querySelectorAll("a, button")].filter((el) =>
    weekLabel(el),
  );
  const labels = new Set(links.map((el) => weekLabel(el)));
  if (labels.size < 2) return;

  const found = findWeekBar(links);
  if (!found) return;
  const bar = found.el;

  paintBar(bar, found.keepImage);

  const barWidth = bar.getBoundingClientRect().width;
  for (const child of bar.querySelectorAll("div, p, nav, header, span")) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.matches(SKIP_PAINT) || containsDayHeader(child)) continue;
    const box = child.getBoundingClientRect();
    if (box.width < barWidth * 0.9 || box.height > 140) continue;
    if (!isPale(getComputedStyle(child).backgroundColor)) continue;
    paintBar(child, false);
  }
}

export function clearWeekBar(root = document) {
  for (const el of root.querySelectorAll("[data-vch-week-bar]")) {
    if (!(el instanceof HTMLElement)) continue;
    el.classList.remove("vch-week-bar");
    delete el.dataset.vchWeekBar;
    el.style.removeProperty("background-color");
    el.style.removeProperty("background-image");
    el.style.removeProperty("color");
    el.style.removeProperty("border-color");
  }
}
