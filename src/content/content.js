import browser from "webextension-polyfill";
import { applyChecklistToDocument } from "./checklist.js";
import {
  addFloatingAssignmentButton,
  applyCustomAssignments,
  instantAssignmentUpdate,
  isInstantUpdateInProgress,
  resetCustomAssignmentState,
} from "./custom-assignments.js";
import {
  applyExperienceStyles,
  loadExperienceModules,
} from "./experience.js";
import { applyLunchHome } from "./lunch-home.js";
import {
  applyLunchTimeline,
  scheduleLunchTimelineRefresh,
} from "./lunch-timeline.js";
import { initRollout } from "./rollout.js";
import { getStorage, isExtensionAlive, loadSettings } from "./storage.js";
import { initTheme } from "./theme.js";

// Safe default: legacy CWS UI until the Worker says otherwise (no modern flash).
try {
  document.documentElement.dataset.vchRollout = "0";
  document.documentElement.dataset.vchExperience = "legacy";
} catch {
  // ignore
}

function fixClippingIssues() {
  const timelineCells = document.querySelectorAll(".timeline-cell");

  timelineCells.forEach((cell) => {
    const assignments = cell.querySelectorAll(".assignment");
    const assignmentCount = assignments.length;

    if (assignmentCount >= 3) {
      let totalContentHeight = 0;
      assignments.forEach((assignment) => {
        const assignmentHeight =
          assignment.offsetHeight || assignment.scrollHeight || 40;
        totalContentHeight += assignmentHeight;
      });

      totalContentHeight += 16;
      const visibleHeight = Math.min(100, totalContentHeight - 15);
      const maxHeight = Math.max(100, totalContentHeight);

      cell.style.height = `${visibleHeight}px`;
      cell.style.maxHeight = `${maxHeight}px`;
      cell.style.overflowY = "auto";
      cell.style.overflowX = "hidden";
      cell.style.verticalAlign = "top";
      cell.classList.add("scrollable");

      const parentRow = cell.closest("tr");
      if (parentRow) {
        parentRow.style.height = `${visibleHeight}px`;
      }
    }
  });

  const timelineRows = document.querySelectorAll(
    ".timeline-records tr, .timeline-table tr, tr",
  );

  timelineRows.forEach((row) => {
    const cells = row.querySelectorAll("td");
    let hasAssignments = false;

    cells.forEach((cell) => {
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
        cell.querySelector("[data-assignment-id]");

      if (hasAssignmentElements || hasAssignmentText) {
        hasAssignments = true;
        cell.style.height = "auto";
        cell.style.minHeight = "120px";
        cell.style.verticalAlign = "top";
        cell.style.padding = "8px";
      }
    });

    if (hasAssignments) {
      row.style.height = "auto";
      row.style.minHeight = "120px";
    }
  });
}

function enhanceTimelineScrolling() {
  const scrollableCells = document.querySelectorAll(".timeline-cell.scrollable");

  scrollableCells.forEach((cell) => {
    const assignments = cell.querySelectorAll(".assignment");
    if (assignments.length >= 3) {
      let totalContentHeight = 0;
      assignments.forEach((assignment) => {
        const assignmentHeight =
          assignment.offsetHeight || assignment.scrollHeight || 40;
        totalContentHeight += assignmentHeight;
      });

      const visibleHeight = Math.min(100, totalContentHeight - 15);
      const maxHeight = Math.max(100, totalContentHeight);

      cell.style.height = `${visibleHeight}px`;
      cell.style.maxHeight = `${maxHeight}px`;
      cell.style.overflowY = "auto";
      cell.style.overflowX = "hidden";
    }
  });
}

function handleWindowResize() {
  setTimeout(() => {
    fixClippingIssues();
    enhanceTimelineScrolling();
  }, 100);
}

function parseScores(root) {
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

function maybeRedirectHome(settings) {
  try {
    if (!settings.enableHomeRedirect) return;
    if (!settings.homeUrl) return;

    const isRootish =
      /\/student\/?$/.test(location.pathname) ||
      /\/portal\/?$/.test(location.pathname);
    if (isRootish) {
      const target = settings.homeUrl.startsWith("http")
        ? settings.homeUrl
        : new URL(settings.homeUrl, location.origin).toString();
      if (location.toString() !== target) {
        location.replace(target);
      }
    }
  } catch {
    // no-op
  }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "refreshCustomAssignments") {
    setTimeout(() => {
      instantAssignmentUpdate();
    }, 10);
    sendResponse({ success: true });
  }
});

(async function init() {
  try {
    // Staged rollout: Worker allowlist / published → modern redesign + #7/#8.
    // Otherwise keep CWS-equivalent legacy UI (styles, popup, homepage, tour).
    // Paint legacy CSS immediately so a slow Worker never flashes modern chrome.
    applyExperienceStyles(false);
    const rollout = await initRollout();
    const modern = rollout.enabled === true;
    if (modern) applyExperienceStyles(true);
    const { initWhatsNew, applyHomepageWidget } =
      loadExperienceModules(modern);

    await initTheme();
    await initWhatsNew();
    const settings = await loadSettings();

    maybeRedirectHome(settings);

    fixClippingIssues();
    setTimeout(() => enhanceTimelineScrolling(), 100);

    if (
      location.hostname.includes("veracross") ||
      location.hostname.includes("portals")
    ) {
      let timelineCheckCount = 0;
      const maxChecks = 50;

      const waitForTimeline = () => {
        timelineCheckCount++;
        const timeline = document.querySelector(
          ".timeline-records, .timeline-table",
        );

        if (timeline) {
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

    const clipObserver = new MutationObserver((mutations) => {
      if (!isExtensionAlive()) {
        clipObserver.disconnect();
        return;
      }
      fixClippingIssues();
      setTimeout(() => enhanceTimelineScrolling(), 100);

      const hasTimelineChanges = mutations.some((mutation) => {
        return Array.from(mutation.addedNodes).some((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (
              node.matches &&
              (node.matches("[data-vch-custom]") ||
                node.querySelector("[data-vch-custom]") ||
                node.matches(".vch-custom-timeline-row") ||
                node.matches(".vch-custom-assignment") ||
                node.matches(".vch-lunch-header-chip") ||
                node.querySelector(".vch-lunch-header-chip"))
            ) {
              return false;
            }
            return (
              node.matches &&
              (node.matches(".timeline-row") ||
                node.matches(".timeline-cell") ||
                node.matches(".timeline-records-inner") ||
                node.querySelector(
                  ".timeline-row, .timeline-cell, .timeline-records-inner",
                ))
            );
          }
          return false;
        });
      });

      if (
        hasTimelineChanges &&
        settings.enableCustomAssignments &&
        !isInstantUpdateInProgress()
      ) {
        setTimeout(async () => {
          if (!isExtensionAlive()) return;
          resetCustomAssignmentState();
          await instantAssignmentUpdate();
        }, 100);
      }

      if (hasTimelineChanges && settings.enableLunchTimeline) {
        scheduleLunchTimelineRefresh(150);
      }
    });
    clipObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("resize", handleWindowResize);

    const scrollContainer =
      document.querySelector(
        ".timeline-table-wrapper, .timeline-records-wrapper, .timeline-wrapper, .timeline-table, .timeline-records",
      ) || document;
    scrollContainer.addEventListener("scroll", () => {
      clearTimeout(scrollContainer.scrollTimeout);
      scrollContainer.scrollTimeout = setTimeout(() => {}, 100);
    });

    if (settings.enableChecklist) {
      const checked = (await getStorage("vc_checked_assignments")) || {};

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          applyChecklistToDocument(document, checked, settings);
          setTimeout(() => enhanceTimelineScrolling(), 200);
        });
      } else {
        applyChecklistToDocument(document, checked, settings);
        setTimeout(() => enhanceTimelineScrolling(), 200);
      }
    }

    if (settings.enableEstimator) {
      applyEstimator();
    }

    await applyCustomAssignments(settings);
    await applyHomepageWidget(settings);
    await applyLunchHome(settings);
    await applyLunchTimeline(settings);

    let currentUrl = location.href;
    const checkForUrlChange = () => {
      if (!isExtensionAlive()) return;
      if (location.href !== currentUrl) {
        currentUrl = location.href;

        resetCustomAssignmentState();
        setTimeout(async () => {
          const latest = await loadSettings();
          Object.assign(settings, latest);
          if (settings.enableHomepageWidget && isExtensionAlive()) {
            await applyHomepageWidget(settings);
          }
          if (settings.enableLunchHomepage && isExtensionAlive()) {
            await applyLunchHome(settings);
          }
          if (settings.enableCustomAssignments && isExtensionAlive()) {
            resetCustomAssignmentState();
            await instantAssignmentUpdate();
          }
          if (settings.enableLunchTimeline && isExtensionAlive()) {
            await applyLunchTimeline(settings);
          }
        }, 100);
      }

      setTimeout(checkForUrlChange, 1000);
    };

    setTimeout(checkForUrlChange, 1000);

    let lastUrl = location.href;
    const checkButtonVisibility = () => {
      if (!isExtensionAlive()) return;
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(() => {
          if (isExtensionAlive()) addFloatingAssignmentButton();
        }, 500);
      }
      setTimeout(checkButtonVisibility, 1000);
    };
    setTimeout(checkButtonVisibility, 1000);
  } catch {
    // Silent error handling
  }
})();
