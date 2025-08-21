// Veracross Plus — content script (MVP)
// Adds: (1) homework checkboxes (2) exact % estimator (3) optional home redirect



// Add global error handling to catch any JavaScript errors
window.addEventListener('error', (event) => {
  console.error('Veracross Plus: Global error caught:', event.error);
  console.error('Veracross Plus: Error details:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

// Also catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('Veracross Plus: Unhandled promise rejection:', event.reason);
});



const DEFAULTS = {
    enableChecklist: true,
    enableEstimator: true,
    enableHomeRedirect: false,
    homeUrl: "" // e.g., "/student/schedule/weekly" or a full URL
  };
  
  // Small stable hash for keys
  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  
  function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get(DEFAULTS, resolve);
    });
  }
  
  function saveSettings(changes) {
    return new Promise(resolve => {
      chrome.storage.sync.set(changes, resolve);
    });
  }
  
  function getStorage(key) {
    return new Promise(resolve => chrome.storage.sync.get(key, obj => resolve(obj[key])));
  }
  
  function setStorage(obj) {
    return new Promise(resolve => chrome.storage.sync.set(obj, resolve));
  }
  
  // ———————————————— Feature 1: Homework checklist ————————————————
  async function applyChecklist() {
    
    const checked = (await getStorage("vc_checked_assignments")) || {};

    // Apply checklist directly to the current document
    // This avoids iframe communication issues and works on all Veracross pages
    applyChecklistToDocument(document, checked);
  }

  function applyChecklistToDocument(doc, checked) {
    
    // Clear any existing checkboxes first to prevent duplicates
    const existingCheckboxes = doc.querySelectorAll('.vch-task-wrap');
    if (existingCheckboxes.length > 0) {
      existingCheckboxes.forEach(cb => cb.remove());
    }
    
    // Much more specific selectors to avoid multiple checkboxes per assignment
    const selectors = [
      // Only target the main assignment containers, not nested elements
      ".timeline-records > .timeline-record",
      ".timeline-records > [class*='assignment']",
      ".timeline-records > [class*='homework']",
      ".timeline-records > [class*='test']",
      ".timeline-records > [class*='paper']",
      ".timeline-records > [class*='classwork']",
      // Fallback for other layouts - only direct children
      "main > [class*='assignment']",
      "main > [class*='homework']",
      "main > [class*='test']",
      "main > [class*='paper']",
      "main > [class*='classwork']",
      // Very specific - only elements with assignment-like text that aren't nested
      "[data-assignment-id]:not([class*='vch-decorated'])",
      ".assignment-row:not([class*='vch-decorated'])"
    ];

    const seen = new WeakSet();

    function keyForNode(node) {
      const stable = node.getAttribute?.("data-assignment-id");
      if (stable) return `${location.host}|${stable}`;
      const text = node.textContent?.trim().replace(/\s+/g, " ") || "";
      const nearDate = node.closest("tr,li,div")?.textContent?.match(/\b(?:\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\b/);
      return `${location.host}|${hash(text + (nearDate?.[0] || ""))}`;
    }

    function decorate(node) {
      if (seen.has(node)) return;
      seen.add(node);

      const id = keyForNode(node);

      // Check if this node already has a checkbox to avoid duplicates
      if (node.querySelector('.vch-task-wrap')) {
        return;
      }

      // Mark this node as decorated immediately to prevent re-processing
      node.classList.add('vch-decorated');

      // Find the best place to insert the checkbox - prefer the first text node or link
      let insertTarget = node;
      
      // Look for the first meaningful text element or link
      const firstTextElement = node.querySelector('a, span, div, p') || node;
      if (firstTextElement && firstTextElement !== node) {
        insertTarget = firstTextElement;
      }
      
      // If the insert target already has a checkbox, skip this node
      if (insertTarget.querySelector('.vch-task-wrap')) {
        return;
      }
      
      // Get the full text content for better assignment type detection
      const fullText = (node.textContent || "").toLowerCase();
      const nodeText = fullText.trim();
      
      // More comprehensive assignment type detection
      let assignmentType = "homework"; // default
      let shouldSkip = false;
      
      // Check for test-related assignments first - be more specific
      if (nodeText.includes("test") || 
          nodeText.includes("exam") || 
          (nodeText.includes("assessment") && !nodeText.includes("paper")) ||  // Only skip assessment if it's NOT a paper
          nodeText.includes("quiz") ||
          nodeText.includes("final") ||
          nodeText.includes("midterm")) {
        assignmentType = "test";
        shouldSkip = true;
      } else if (nodeText.includes("paper") || nodeText.includes("essay")) {
        assignmentType = "paper";
      } else if (nodeText.includes("classwork") || nodeText.includes("class work")) {
        assignmentType = "classwork";
      } else if (nodeText.includes("homework") || nodeText.includes("home work")) {
        assignmentType = "homework";
      }
      
      // Skip test assignments and any assignments that don't need checkboxes
      if (shouldSkip) {
        return;
      }
      
      // Additional filtering: skip assignments that are just informational or don't need tracking
      if (nodeText.includes("summer work") && !nodeText.includes("due")) {
        return;
      }
      
      // Skip assignments that are just informational text without due dates or specific actions
      if (!nodeText.includes("due") && 
          !nodeText.includes("homework") && 
          !nodeText.includes("classwork") && 
          !nodeText.includes("paper") && 
          !nodeText.includes("assignment") &&
          !nodeText.includes("bring") &&
          !nodeText.includes("complete") &&
          !nodeText.includes("finish")) {
        return;
      }
      
      const wrap = document.createElement("span");
      wrap.className = "vch-task-wrap";
      wrap.setAttribute("data-type", assignmentType);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "vch-checkbox";
      cb.checked = !!checked[id];

      if (cb.checked) {
        node.classList.add("vch-done");
      }

      // Prevent clicks on the checkbox from propagating to parent elements
      cb.addEventListener("click", (event) => {
        // Don't prevent default - let the checkbox change state
        event.stopPropagation();
      });

      // Also prevent clicks on the wrapper from propagating
      wrap.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
      });
      
      // Add a simple test click handler to see if anything works
      cb.addEventListener("mousedown", (event) => {
        // Mouse down event
      });
      
      cb.addEventListener("mouseup", (event) => {
        // Mouse up event
      });
      
      // Test if the checkbox can be focused
      cb.addEventListener("focus", (event) => {
        // Focus event
      });
      
      // Add input event listener as backup
      cb.addEventListener("input", (event) => {
        // Input event
      });

      // Add error handling to the change event
      cb.addEventListener("change", async (event) => {
        try {
          
          checked[id] = cb.checked ? 1 : undefined;
          
          node.classList.toggle("vch-done", cb.checked);
          
          // prune undefineds
          const compact = Object.fromEntries(Object.entries(checked).filter(([,v]) => v));
          
          await setStorage({ vc_checked_assignments: compact });
        } catch (error) {
          console.error('Veracross Plus: Error in checkbox change handler:', error);
        }
      });

      // Insert checkbox at the beginning of the insert target
      insertTarget.insertBefore(wrap, insertTarget.firstChild);
      wrap.appendChild(cb);
    }

    function scan() {
      let totalFound = 0;
      let totalDecorated = 0;
      
      selectors.forEach(sel => {
        const elements = doc.querySelectorAll(sel);
        
        elements.forEach(node => {
          // Skip if already decorated
          if (node.classList.contains('vch-decorated')) {
            return;
          }
          
          // Skip if node already has a checkbox
          if (node.querySelector('.vch-task-wrap')) {
            return;
          }
          
          totalFound++;
          decorate(node);
          totalDecorated++;
        });
      });
      
      if (totalFound === 0) {
        
        // Try to find any elements that might contain assignments
        const allElements = doc.querySelectorAll('*');
        
        // Look for elements with assignment-related text
        const assignmentElements = Array.from(allElements).filter(el => {
          const text = el.textContent || '';
          return text.includes('Homework') || text.includes('Test') || text.includes('Paper') || text.includes('Classwork');
        });
      }
    }

    scan();
    const mo = new MutationObserver(() => scan());
    mo.observe(doc.documentElement, { childList: true, subtree: true });
  }

  // ———————————————— Feature 2: Exact % estimator ————————————————
  function parseScores(root) {
    // Finds fragments like "8/10" or "75%" inside tables/lists.
    const text = root.innerText || "";
    const byFraction = [...text.matchAll(/(\b\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g)].map(m => ({ earned: +m[1], possible: +m[2] }));
    const byPercent = [...text.matchAll(/(\b\d+(?:\.\d+)?)\s*%/g)].map(m => ({ percent: +m[1] }));
    return { byFraction, byPercent };
  }
  
  function estimatePercent({ byFraction, byPercent }) {
    let earned = 0, possible = 0;
    byFraction.forEach(({ earned: e, possible: p }) => { if (!isNaN(e) && !isNaN(p) && p > 0) { earned += e; possible += p; } });
  
    // If we only have percents, average them (unweighted) as a fallback.
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
      // Heuristic: prefer the main content region
      const main = document.querySelector("main, #main, .main-content") || document.body;
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
  
  // ———————————————— Feature 3: Home redirect ————————————————
  function maybeRedirectHome(settings) {
    try {
      if (!settings.enableHomeRedirect) return;
      if (!settings.homeUrl) return;
  
      const isRootish = /\/student\/?$/.test(location.pathname) || /\/portal\/?$/.test(location.pathname);
      if (isRootish) {
        // Support relative or absolute
        const target = settings.homeUrl.startsWith("http") ? settings.homeUrl : new URL(settings.homeUrl, location.origin).toString();
        if (location.toString() !== target) {
          location.replace(target);
        }
      }
    } catch (e) {
      // no-op
    }
  }
  
  // ———————————————— Init ————————————————
  (async function init() {
    
    const settings = await loadSettings();
    
    maybeRedirectHome(settings);

    if (settings.enableChecklist) {
      
      // Apply checklist directly to the current page
      // This works on all Veracross pages without iframe communication issues
      const checked = (await getStorage("vc_checked_assignments")) || {};
      
      // Wait for DOM to be ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          applyChecklistToDocument(document, checked);
        });
      } else {
        applyChecklistToDocument(document, checked);
      }
      
    } 
    
    if (settings.enableEstimator) applyEstimator();
    
  })();