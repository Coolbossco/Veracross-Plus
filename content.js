// Veracross Plus — content script (MVP)
// Adds: (1) homework checkboxes (2) exact % estimator (3) optional home redirect

// Debug logging prefix for easy identification
const DEBUG_PREFIX = '[Veracross Plus]';

// Add global error handling to catch any JavaScript errors
window.addEventListener('error', (event) => {
  console.error(`${DEBUG_PREFIX} Global error caught:`, event.error);
  console.error(`${DEBUG_PREFIX} Error details:`, {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

// Also catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error(`${DEBUG_PREFIX} Unhandled promise rejection:`, event.reason);
});



const DEFAULTS = {
    enableChecklist: false,
    enableEstimator: false,
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
    console.log(`${DEBUG_PREFIX} Loading settings...`);
    return new Promise(resolve => {
      chrome.storage.sync.get(DEFAULTS, (result) => {
        console.log(`${DEBUG_PREFIX} Settings loaded:`, result);
        resolve(result);
      });
    });
  }
  
  function saveSettings(changes) {
    console.log(`${DEBUG_PREFIX} Saving settings:`, changes);
    return new Promise(resolve => {
      chrome.storage.sync.set(changes, () => {
        console.log(`${DEBUG_PREFIX} Settings saved successfully`);
        resolve();
      });
    });
  }
  
  function getStorage(key) {
    console.log(`${DEBUG_PREFIX} Getting storage for key:`, key);
    return new Promise(resolve => chrome.storage.sync.get(key, obj => {
      console.log(`${DEBUG_PREFIX} Storage retrieved for ${key}:`, obj[key]);
      resolve(obj[key]);
    }));
  }
  
  function setStorage(obj) {
    console.log(`${DEBUG_PREFIX} Setting storage:`, obj);
    return new Promise(resolve => chrome.storage.sync.set(obj, () => {
      console.log(`${DEBUG_PREFIX} Storage set successfully`);
      resolve();
    }));
  }
  
  // ———————————————— Fix clipping issues ————————————————
  function fixClippingIssues() {
    console.log(`${DEBUG_PREFIX} Starting clipping fix...`);
    console.log(`${DEBUG_PREFIX} Current URL:`, location.href);
    console.log(`${DEBUG_PREFIX} Document ready state:`, document.readyState);
    
    // Target timeline-cell divs specifically
    const timelineCells = document.querySelectorAll('.timeline-cell');
    console.log(`${DEBUG_PREFIX} Found ${timelineCells.length} timeline-cell elements`);
    
    let cellsFixed = 0;
    
    timelineCells.forEach((cell, index) => {
      const assignments = cell.querySelectorAll('.assignment');
      const assignmentCount = assignments.length;
      
      console.log(`${DEBUG_PREFIX} Timeline cell ${index + 1}: contains ${assignmentCount} assignments`);
      
      // If cell has 3 or more assignments, make it scrollable instead of expanding
      if (assignmentCount >= 3) {
        console.log(`${DEBUG_PREFIX} Timeline cell ${index + 1} needs scrolling (${assignmentCount} assignments)`);
        
        // Method 2: Make scrollable (keeps layout clean)
        cell.style.height = '120px';
        cell.style.maxHeight = '120px';
        cell.style.overflowY = 'auto';
        cell.style.overflowX = 'hidden';
        cell.style.verticalAlign = 'top';
        cell.style.padding = '4px';
        cell.classList.add('scrollable');
        
        // Don't expand parent row - keep table layout consistent
        const parentRow = cell.closest('tr');
        if (parentRow) {
          parentRow.style.height = '120px';
          console.log(`${DEBUG_PREFIX} Set consistent row height for cell ${index + 1}`);
        }
        
        cellsFixed++;
        console.log(`${DEBUG_PREFIX} Applied scrollable styling to timeline cell ${index + 1}`);
      } else {
        console.log(`${DEBUG_PREFIX} Timeline cell ${index + 1} doesn't need modification (${assignmentCount} assignments)`);
      }
    });
    
    console.log(`${DEBUG_PREFIX} Fixed ${cellsFixed} timeline cells with 3+ assignments`);
    
    // Also try to find assignment containers more directly
    const assignmentElements = document.querySelectorAll('[data-assignment-id]');
    console.log(`${DEBUG_PREFIX} Found ${assignmentElements.length} elements with data-assignment-id`);
    
    // Legacy fallback: expand row heights to show all assignments
    const timelineRows = document.querySelectorAll('.timeline-records tr, .timeline-table tr, tr');
    console.log(`${DEBUG_PREFIX} Found ${timelineRows.length} timeline rows`);
    
    let processedRows = 0;
    let rowsWithAssignments = 0;
    
    timelineRows.forEach((row, index) => {
      console.log(`${DEBUG_PREFIX} Processing row ${index + 1}/${timelineRows.length}`);
      
      // Check if this row has cells with assignment content
      const cells = row.querySelectorAll('td');
      console.log(`${DEBUG_PREFIX} Row ${index + 1} has ${cells.length} cells`);
      
      let hasAssignments = false;
      let cellsWithAssignments = 0;
      
      cells.forEach((cell, cellIndex) => {
        const hasAssignmentElements = cell.querySelector('[class*="assignment"], .homework, .test, .paper, .quiz, .classwork, [data-assignment-id]');
        const text = cell.textContent || '';
        const hasAssignmentText = (
          text.includes('HOMEWORK') || 
          text.includes('TEST') || 
          text.includes('PAPER') || 
          text.includes('QUIZ') ||  
          text.includes('CLASSWORK') ||
          text.includes('DUE') ||
          text.includes('Homework') ||
          text.includes('Classwork') ||
          text.includes('Paper') ||
          text.includes('Test') ||
          text.includes('Quiz') ||
          cell.querySelector('[data-assignment-id]') // Check for Veracross assignment elements
        );
        
        console.log(`${DEBUG_PREFIX} Cell ${cellIndex + 1} analysis:`, {
          hasElements: !!hasAssignmentElements,
          hasDataId: !!cell.querySelector('[data-assignment-id]'),
          hasText: hasAssignmentText,
          textLength: text.length,
          textSample: text.substring(0, 200)
        });
        
        if (hasAssignmentElements || hasAssignmentText) {
          hasAssignments = true;
          cellsWithAssignments++;
          console.log(`${DEBUG_PREFIX} Cell ${cellIndex + 1} in row ${index + 1} has assignments:`, {
            hasElements: !!hasAssignmentElements,
            hasText: hasAssignmentText,
            textSample: text.substring(0, 100)
          });
          
          // Ensure cell can expand
          cell.style.height = 'auto';
          cell.style.minHeight = '120px';
          cell.style.verticalAlign = 'top';
          cell.style.padding = '8px';
        }
      });
      
      // If row has assignments, ensure it can expand
      if (hasAssignments) {
        rowsWithAssignments++;
        row.style.height = 'auto';
        row.style.minHeight = '120px';
        console.log(`${DEBUG_PREFIX} Row ${index + 1} expanded - has ${cellsWithAssignments} cells with assignments`);
      }
      
      processedRows++;
    });
    
    console.log(`${DEBUG_PREFIX} Clipping fix complete:`, {
      totalRows: timelineRows.length,
      processedRows,
      rowsWithAssignments,
      timestamp: new Date().toISOString()
    });
  }

  // ———————————————— Feature 1: Homework checklist ————————————————
  async function applyChecklist() {
    
    const checked = (await getStorage("vc_checked_assignments")) || {};

    // Apply checklist directly to the current document
    // This avoids iframe communication issues and works on all Veracross pages
    applyChecklistToDocument(document, checked);
  }

  function applyChecklistToDocument(doc, checked) {
    console.log(`${DEBUG_PREFIX} Applying checklist to document...`);
    console.log(`${DEBUG_PREFIX} Document:`, doc === document ? 'main document' : 'other document');
    console.log(`${DEBUG_PREFIX} Checked assignments count:`, Object.keys(checked).length);
    
    // Clear any existing checkboxes first to prevent duplicates
    const existingCheckboxes = doc.querySelectorAll('.vch-task-wrap');
    if (existingCheckboxes.length > 0) {
      console.log(`${DEBUG_PREFIX} Removing ${existingCheckboxes.length} existing checkboxes`);
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
      console.log(`${DEBUG_PREFIX} Starting checklist scan...`);
      let totalFound = 0;
      let totalDecorated = 0;
      
      selectors.forEach((sel, index) => {
        const elements = doc.querySelectorAll(sel);
        console.log(`${DEBUG_PREFIX} Selector ${index + 1}/${selectors.length} (${sel}): found ${elements.length} elements`);
        
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
      
      console.log(`${DEBUG_PREFIX} Checklist scan complete:`, {
        totalFound,
        totalDecorated,
        timestamp: new Date().toISOString()
      });
      
      if (totalFound === 0) {
        console.log(`${DEBUG_PREFIX} No assignment elements found, trying fallback search...`);
        
        // Try to find any elements that might contain assignments
        const allElements = doc.querySelectorAll('*');
        console.log(`${DEBUG_PREFIX} Scanning all ${allElements.length} elements for assignment content...`);
        
        // Look for elements with assignment-related text
        const assignmentElements = Array.from(allElements).filter(el => {
          const text = el.textContent || '';
          return text.includes('Homework') || text.includes('Test') || text.includes('Paper') || text.includes('Classwork');
        });
        
        console.log(`${DEBUG_PREFIX} Found ${assignmentElements.length} elements with assignment-related text`);
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
    console.log(`${DEBUG_PREFIX} ========== EXTENSION INITIALIZING ==========`);
    console.log(`${DEBUG_PREFIX} URL:`, location.href);
    console.log(`${DEBUG_PREFIX} Hostname:`, location.hostname);
    console.log(`${DEBUG_PREFIX} Pathname:`, location.pathname);
    console.log(`${DEBUG_PREFIX} User Agent:`, navigator.userAgent);
    console.log(`${DEBUG_PREFIX} Document ready state:`, document.readyState);
    
    try {
      const settings = await loadSettings();
      console.log(`${DEBUG_PREFIX} Extension settings loaded successfully`);
      
      console.log(`${DEBUG_PREFIX} Checking for home redirect...`);
      maybeRedirectHome(settings);

      console.log(`${DEBUG_PREFIX} Applying initial clipping fixes...`);
      // Fix clipping issues first
      fixClippingIssues();
      
      // For Veracross timeline, wait for the timeline to be rendered
      if (location.hostname.includes('veracross') || location.hostname.includes('portals')) {
        console.log(`${DEBUG_PREFIX} Detected Veracross environment - setting up timeline monitoring`);
        
        let timelineCheckCount = 0;
        const maxChecks = 50; // Prevent infinite polling
        
        // Wait for timeline to be created
        const waitForTimeline = () => {
          timelineCheckCount++;
          const timeline = document.querySelector('.timeline-records, .timeline-table');
          console.log(`${DEBUG_PREFIX} Timeline check ${timelineCheckCount}/${maxChecks} - Found:`, !!timeline);
          
          if (timeline) {
            console.log(`${DEBUG_PREFIX} Timeline found! Setting up delayed fixes...`);
            // Apply fixes when timeline is found
            setTimeout(() => {
              console.log(`${DEBUG_PREFIX} Applying clipping fix (500ms delay)`);
              fixClippingIssues();
            }, 500);
            setTimeout(() => {
              console.log(`${DEBUG_PREFIX} Applying clipping fix (1000ms delay)`);
              fixClippingIssues();
            }, 1000);
            setTimeout(() => {
              console.log(`${DEBUG_PREFIX} Applying clipping fix (2000ms delay)`);
              fixClippingIssues();
            }, 2000);
          } else if (timelineCheckCount < maxChecks) {
            console.log(`${DEBUG_PREFIX} Timeline not found yet, retrying in 100ms... (${timelineCheckCount}/${maxChecks})`);
            setTimeout(waitForTimeline, 100);
          } else {
            console.log(`${DEBUG_PREFIX} Timeline not found after ${maxChecks} attempts, stopping search`);
          }
        };
        waitForTimeline();
      }
      
      // Monitor for dynamic content changes and reapply fixes
      console.log(`${DEBUG_PREFIX} Setting up mutation observer...`);
      const clipObserver = new MutationObserver((mutations) => {
        console.log(`${DEBUG_PREFIX} DOM mutations detected (${mutations.length} mutations), reapplying fixes...`);
        fixClippingIssues();
      });
      clipObserver.observe(document.documentElement, { childList: true, subtree: true });
      console.log(`${DEBUG_PREFIX} Mutation observer active`);

      if (settings.enableChecklist) {
        console.log(`${DEBUG_PREFIX} Checklist feature is ENABLED - applying checklist`);
      } else {
        console.log(`${DEBUG_PREFIX} Checklist feature is DISABLED`);
      }
      if (settings.enableChecklist) {
        console.log(`${DEBUG_PREFIX} Checklist feature is ENABLED - applying checklist`);
        
        // Apply checklist directly to the current page
        // This works on all Veracross pages without iframe communication issues
        const checked = (await getStorage("vc_checked_assignments")) || {};
        console.log(`${DEBUG_PREFIX} Retrieved checked assignments:`, Object.keys(checked).length, 'items');
        
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
          console.log(`${DEBUG_PREFIX} DOM still loading, waiting for DOMContentLoaded...`);
          document.addEventListener('DOMContentLoaded', () => {
            console.log(`${DEBUG_PREFIX} DOMContentLoaded fired, applying checklist`);
            applyChecklistToDocument(document, checked);
          });
        } else {
          console.log(`${DEBUG_PREFIX} DOM ready, applying checklist immediately`);
          applyChecklistToDocument(document, checked);
        }
      } else {
        console.log(`${DEBUG_PREFIX} Checklist feature is DISABLED`);
      }
      
      if (settings.enableEstimator) {
        console.log(`${DEBUG_PREFIX} Grade estimator feature is ENABLED`);
        applyEstimator();
      } else {
        console.log(`${DEBUG_PREFIX} Grade estimator feature is DISABLED`);
      }
      
      console.log(`${DEBUG_PREFIX} ========== EXTENSION INITIALIZATION COMPLETE ==========`);
      
    } catch (error) {
      console.error(`${DEBUG_PREFIX} INITIALIZATION ERROR:`, error);
      console.error(`${DEBUG_PREFIX} Error stack:`, error.stack);
    }
    
  })();