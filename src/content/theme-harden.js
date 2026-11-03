/**
 * Runtime contrast hardener for leftovers CSS misses (white panels, dark-on-dark text).
 * Only runs when a theme is active.
 */

const SKIP_TAGS = new Set([
  "IMG",
  "SVG",
  "PATH",
  "CANVAS",
  "VIDEO",
  "IFRAME",
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "BR",
  "HR",
]);

const PRESERVE_HUE_SEL =
  ".event-link, .fc-event, .fc-title, .fc-list-item-title, [data-vch-preserve-color]";

let hardenTimer = 0;
let hardenObserver = null;

function parseRgb(color) {
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") {
    return null;
  }
  const rgb = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
    };
  }
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  return null;
}

function luminance({ r, g, b }) {
  const toLin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

function saturation({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

/** Mix toward white until readable on dark surfaces, keeping hue. */
function lightenForDarkBg({ r, g, b }, minLum = 0.62) {
  let t = 0;
  let out = { r, g, b };
  while (luminance(out) < minLum && t < 0.92) {
    t += 0.04;
    out = {
      r: Math.round(r + (255 - r) * t),
      g: Math.round(g + (255 - g) * t),
      b: Math.round(b + (255 - b) * t),
    };
  }
  return `rgb(${out.r}, ${out.g}, ${out.b})`;
}

/** Mix toward black until readable on light surfaces, keeping hue. */
function darkenForLightBg({ r, g, b }, maxLum = 0.28) {
  let t = 0;
  let out = { r, g, b };
  while (luminance(out) > maxLum && t < 0.92) {
    t += 0.04;
    out = {
      r: Math.round(r * (1 - t)),
      g: Math.round(g * (1 - t)),
      b: Math.round(b * (1 - t)),
    };
  }
  return `rgb(${out.r}, ${out.g}, ${out.b})`;
}

const LIGHT_THEME_IDS = new Set(["soft-light", "lilac", "matcha"]);

function isThemed() {
  return document.documentElement.hasAttribute("data-vch-theme");
}

function isLightTheme() {
  return LIGHT_THEME_IDS.has(
    document.documentElement.getAttribute("data-vch-theme") || "",
  );
}

/**
 * Walk ancestors for the first opaque background.
 * @param {HTMLElement} el
 */
function effectiveBackground(el) {
  let node = el;
  while (node && node instanceof HTMLElement) {
    try {
      const bg = parseRgb(getComputedStyle(node).backgroundColor);
      if (bg && (bg.r + bg.g + bg.b > 0 || getComputedStyle(node).backgroundColor.includes("rgb"))) {
        const alphaMatch = getComputedStyle(node).backgroundColor.match(
          /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)/i,
        );
        if (!alphaMatch || Number(alphaMatch[1]) > 0.08) {
          if (bg) return bg;
        }
      }
    } catch {
      break;
    }
    node = node.parentElement;
  }
  // Theme page fallback.
  return isLightTheme()
    ? { r: 245, g: 242, b: 236 }
    : { r: 20, g: 18, b: 28 };
}

function clearHardenedStyles(root = document) {
  root.querySelectorAll("[data-vch-hardened]").forEach((el) => {
    el.style.removeProperty("background-color");
    el.style.removeProperty("color");
    el.removeAttribute("data-vch-hardened");
  });
}

/**
 * Prefer the authored inline color for category links (before we rewrite it).
 * @param {HTMLElement} el
 * @param {{r:number,g:number,b:number}|null} computed
 */
function colorSource(el, computed) {
  const inline = el.getAttribute("style");
  if (inline) {
    const m = inline.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    if (m) {
      const parsed = parseRgb(m[1].trim());
      if (parsed) return parsed;
    }
  }
  const fromProp = parseRgb(el.style?.color || "");
  return fromProp || computed;
}

/**
 * @param {ParentNode} [scope]
 */
export function hardenThemeContrast(scope = document) {
  if (!isThemed()) {
    clearHardenedStyles(scope);
    return;
  }

  // Drop prior inline rewrites so switching light ↔ dark cannot leave
  // pale text stuck on a light background.
  clearHardenedStyles(scope);

  const nodes = scope.querySelectorAll
    ? scope.querySelectorAll(
        "div, span, a, p, li, td, th, section, article, header, footer, nav, main, aside, button, label, h1, h2, h3, h4, h5, h6, ul, ol, table, tr, form, fieldset",
      )
    : [];

  const list = scope.nodeType === 1 ? [scope, ...nodes] : [...nodes];

  for (const el of list) {
    if (!(el instanceof HTMLElement)) continue;
    if (SKIP_TAGS.has(el.tagName)) continue;
    if (
      el.closest(
        ".vch-add-assignment-btn, .vch-checkbox, .vch-task-wrap, .vx-nav, .vx-nav-center, .vx-nav-account, .nav-account, .vx-tab-bar, .timeline, #planner, a.print, .pdf, #login-form, .account-form-container, .card-header-title, .card-footer, .vch-whats-new, .vch-tour-preview, [data-vch-skip-harden]",
      )
    ) {
      continue;
    }

    // Leave the accounts login photo + card alone
    if (
      document.getElementById("login-form") ||
      document.querySelector(".account-form-container")
    ) {
      if (
        el === document.body ||
        el === document.documentElement ||
        el.closest(".card, .ae-container, .banner")
      ) {
        continue;
      }
    }

    let style;
    try {
      style = getComputedStyle(el);
    } catch {
      continue;
    }

    const bg = parseRgb(style.backgroundColor);
    const fgComputed = parseRgb(style.color);
    let changed = false;
    const lightTheme = isLightTheme();

    // On dark themes, map pale school panels onto themed surfaces.
    // On light themes, keep pale panels but force readable dark copy.
    if (
      !lightTheme &&
      bg &&
      luminance(bg) > 0.55 &&
      saturation(bg) < 0.35
    ) {
      const inDocumentTable = Boolean(
        el.closest("#document .data_table, .data_table"),
      );
      const zebra = el.classList?.contains("alt") || el.closest?.("tr.alt");
      el.style.setProperty(
        "background-color",
        inDocumentTable || zebra ? "var(--vch-surfaceAlt)" : "var(--vch-surface)",
        "important",
      );
      changed = true;
    }

    const preserveHue = Boolean(el.closest(PRESERVE_HUE_SEL));
    const fg = preserveHue ? colorSource(el, fgComputed) : fgComputed;
    const surface = bg && luminance(bg) > 0.04 ? bg : effectiveBackground(el);
    const surfaceLum = luminance(surface);

    if (fg) {
      if (surfaceLum >= 0.55) {
        // Light background: pale / white text becomes near-black.
        if (luminance(fg) > 0.42) {
          if (preserveHue || saturation(fg) >= 0.22) {
            el.style.setProperty("color", darkenForLightBg(fg), "important");
          } else {
            el.style.setProperty("color", "var(--vch-text)", "important");
          }
          changed = true;
        }
      } else if (luminance(fg) < 0.55) {
        // Dark background: lift dark text (existing behavior).
        if (preserveHue || saturation(fg) >= 0.22) {
          el.style.setProperty("color", lightenForDarkBg(fg), "important");
          changed = true;
        } else if (saturation(fg) < 0.55) {
          el.style.setProperty(
            "color",
            luminance(fg) < 0.28 ? "var(--vch-text)" : "var(--vch-textMuted)",
            "important",
          );
          changed = true;
        }
      }
    }

    if (changed) {
      el.setAttribute("data-vch-hardened", "1");
    }
  }
}

export function scheduleThemeHarden(delayMs = 16) {
  clearTimeout(hardenTimer);
  hardenTimer = setTimeout(() => {
    if (!isThemed()) {
      clearHardenedStyles();
      return;
    }
    hardenThemeContrast(document);
  }, delayMs);
}

export function bindThemeHarden() {
  if (hardenObserver) return;

  scheduleThemeHarden(0);

  hardenObserver = new MutationObserver((mutations) => {
    if (!isThemed()) return;
    // Harden new popups/modals immediately so light UI doesn't flash
    let urgent = false;
    for (const m of mutations) {
      if (m.type === "childList" && m.addedNodes.length) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (
            node.matches?.(
              ".popup, #facebox, .vx-modal, .vx-overlay, .dropdown, .qtip, .tippy-box, .modal-body, [class*='popup'], [class*='modal']",
            ) ||
            node.querySelector?.(
              ".popup, #facebox, .vx-modal, .dropdown, .qtip, .tippy-box",
            )
          ) {
            urgent = true;
            hardenThemeContrast(node);
          }
        }
      }
    }
    scheduleThemeHarden(urgent ? 0 : 24);
  });

  hardenObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  });

  window.addEventListener("load", () => scheduleThemeHarden(0), { once: true });
}

export function unbindThemeHarden() {
  clearTimeout(hardenTimer);
  hardenObserver?.disconnect();
  hardenObserver = null;
  clearHardenedStyles();
}
