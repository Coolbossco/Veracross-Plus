import browser from "webextension-polyfill";

const PANEL_WIDTH = 340;
const GUTTER_PAD = 28;

/**
 * True when the portal app has a side gutter wide enough for a 340px card
 * without covering the main column.
 * @param {"left" | "right"} side
 */
export function hasSideGutter(side) {
  const app = document.querySelector(".app-container");
  const needed = PANEL_WIDTH + GUTTER_PAD;
  if (!app) {
    return window.innerWidth >= needed * 2 + 720;
  }
  const rect = app.getBoundingClientRect();
  if (side === "left") {
    return rect.left >= needed;
  }
  return window.innerWidth - rect.right >= needed;
}

/**
 * Narrow / zoomed view where both side cards would crush the center.
 */
export function isCompactOverlayViewport() {
  return !hasSideGutter("left") || !hasSideGutter("right") || window.innerWidth < 1180;
}

/**
 * @param {HTMLElement} panel
 * @param {boolean} collapsed
 * @param {string} collapsedClass
 */
export function setPanelCollapsed(panel, collapsed, collapsedClass) {
  panel.classList.toggle(collapsedClass, collapsed);
  panel.setAttribute("data-vch-collapsed", collapsed ? "1" : "0");
  const toggle = panel.querySelector("[data-vch-panel-toggle]");
  if (toggle) {
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.title = collapsed ? "Show panel" : "Hide panel";
    toggle.textContent = collapsed ? "Show" : "Hide";
  }
}

/**
 * Remember the user's open/collapsed choice and update the panel.
 * @param {HTMLElement} panel
 * @param {boolean} collapsed
 * @param {string} collapsedClass
 */
export function setPanelManualCollapse(panel, collapsed, collapsedClass) {
  panel.dataset.vchManualCollapse = collapsed ? "1" : "0";
  setPanelCollapsed(panel, collapsed, collapsedClass);
  const key = panel._vchCollapseStorageKey;
  if (!key) return;
  void browser.storage.local.set({ [key]: collapsed ? "1" : "0" }).catch(() => {});
}

/**
 * Wire collapse toggle + auto-collapse when the gutter is too small.
 * Manual collapse sticks until the user expands again, and is restored
 * from storage when `collapseStorageKey` is set.
 * @param {object} opts
 * @param {HTMLElement} opts.panel
 * @param {"left" | "right"} opts.side
 * @param {string} opts.collapsedClass
 * @param {() => void} [opts.onPlace]
 * @param {string} [opts.collapseStorageKey]
 */
export function bindResponsivePanel({
  panel,
  side,
  collapsedClass,
  onPlace,
  collapseStorageKey,
}) {
  if (panel._vchResponsiveBound) {
    syncAutoCollapse(panel, side, collapsedClass, onPlace);
    return;
  }
  panel._vchResponsiveBound = true;
  panel._vchCollapseStorageKey = collapseStorageKey || "";
  panel.dataset.vchManualCollapse = panel.dataset.vchManualCollapse || "";

  panel
    .querySelector("[data-vch-panel-toggle]")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = panel.getAttribute("data-vch-collapsed") !== "1";
      setPanelManualCollapse(panel, next, collapsedClass);
      onPlace?.();
    });

  // Collapsed chip click expands (non-button chip surface)
  panel.addEventListener("click", (event) => {
    if (panel.getAttribute("data-vch-collapsed") !== "1") return;
    if (event.target.closest("[data-vch-panel-toggle]")) return;
    if (event.target.closest("a, button, input")) return;
    setPanelManualCollapse(panel, false, collapsedClass);
    onPlace?.();
  });

  const onResize = () => {
    syncAutoCollapse(panel, side, collapsedClass, onPlace);
  };
  window.addEventListener("resize", onResize);
  panel._vchResponsiveResize = onResize;

  const finish = () => syncAutoCollapse(panel, side, collapsedClass, onPlace);
  if (collapseStorageKey && !panel.dataset.vchManualCollapse) {
    void browser.storage.local
      .get(collapseStorageKey)
      .then((stored) => {
        const value = stored[collapseStorageKey];
        if (value === "1" || value === "0") {
          panel.dataset.vchManualCollapse = value;
        }
      })
      .catch(() => {})
      .finally(finish);
    return;
  }

  finish();
}

/**
 * Drag from expanded header (non-controls) or collapsed chip.
 * @param {object} opts
 * @param {HTMLElement} opts.panel
 * @param {string} opts.headerSelector
 * @param {string} opts.storageKey
 * @param {(pos: {left: number, top: number}) => void} opts.applyPosition
 * @param {(pos: {left: number, top: number}) => {left: number, top: number}} opts.clampPosition
 * @param {() => void} [opts.onExpand]
 */
export function bindOverlayDrag({
  panel,
  headerSelector,
  storageKey,
  applyPosition,
  clampPosition,
  onExpand,
}) {
  if (panel._vchDragBound) return;
  panel._vchDragBound = true;

  panel.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    const collapsed = panel.getAttribute("data-vch-collapsed") === "1";
    const header = event.target.closest(headerSelector);
    const chip = event.target.closest("[data-vch-panel-chip]");
    let handle = null;
    if (header && !event.target.closest("button, a, input")) {
      handle = header;
    } else if (collapsed && chip) {
      handle = chip;
    } else {
      return;
    }

    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragged = false;
    panel.classList.add("vch-panel-dragging");
    handle.setPointerCapture?.(event.pointerId);

    const move = (moveEvent) => {
      if (
        Math.abs(moveEvent.clientX - startX) > 4 ||
        Math.abs(moveEvent.clientY - startY) > 4
      ) {
        dragged = true;
      }
      applyPosition(
        clampPosition({
          left: moveEvent.clientX - offsetX,
          top: moveEvent.clientY - offsetY,
        }),
      );
    };

    const stop = async (stopEvent) => {
      handle.releasePointerCapture?.(stopEvent.pointerId);
      panel.classList.remove("vch-panel-dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (!dragged) {
        if (chip) onExpand?.();
        return;
      }
      if (chip) panel._vchSkipChipExpand = true;
      panel.dataset.vchUserMoved = "1";
      try {
        await browser.storage.local.set({
          [storageKey]: {
            left: parseFloat(panel.style.left),
            top: parseFloat(panel.style.top),
          },
        });
      } catch {
        // Ignore storage failures.
      }
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    event.preventDefault();
  });
}

/**
 * @param {HTMLElement} panel
 * @param {string} storageKey
 * @param {(pos: {left: number, top: number}) => void} applyPosition
 * @param {(pos: {left: number, top: number}) => {left: number, top: number}} clampPosition
 * @param {() => {left: number, top: number}} defaultPosition
 */
export async function restoreOverlayPosition(
  panel,
  storageKey,
  applyPosition,
  clampPosition,
  defaultPosition,
) {
  if (panel.dataset.vchUserMoved === "1" && panel.style.left) return;

  let pos = null;
  try {
    const stored = await browser.storage.local.get(storageKey);
    pos = stored[storageKey];
  } catch {
    pos = null;
  }
  if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) {
    requestAnimationFrame(() => {
      applyPosition(defaultPosition());
    });
    return;
  }
  panel.dataset.vchUserMoved = "1";
  applyPosition(clampPosition(pos));
}

/**
 * @param {HTMLElement} panel
 * @param {{left: number, top: number}} pos
 */
export function applyOverlayPosition(panel, pos) {
  panel.style.left = `${pos.left}px`;
  panel.style.top = `${pos.top}px`;
  panel.style.right = "auto";
}

/**
 * @param {HTMLElement} panel
 * @param {{left: number, top: number}} pos
 */
export function clampOverlayPosition(panel, pos) {
  const width = panel.offsetWidth || 340;
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(8, window.innerHeight - 48);
  return {
    left: Math.min(maxLeft, Math.max(8, pos.left)),
    top: Math.min(maxTop, Math.max(8, pos.top)),
  };
}

/**
 * @param {HTMLElement} panel
 * @param {"left" | "right"} side
 * @param {string} collapsedClass
 * @param {() => void} [onPlace]
 */
function syncAutoCollapse(panel, side, collapsedClass, onPlace) {
  const room = hasSideGutter(side);
  const manual = panel.dataset.vchManualCollapse;

  if (manual === "1") {
    setPanelCollapsed(panel, true, collapsedClass);
  } else if (manual === "0") {
    // User left it open — keep it open even when gutters are tight.
    setPanelCollapsed(panel, false, collapsedClass);
  } else if (!room) {
    // No saved preference yet: collapse when the card would cover content.
    setPanelCollapsed(panel, true, collapsedClass);
  } else {
    setPanelCollapsed(panel, false, collapsedClass);
  }

  onPlace?.();
}
