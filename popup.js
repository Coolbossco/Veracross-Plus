// Custom popup window launcher
// This creates a system-level popup window that can have true rounded corners

// Firefox compatibility: Create browser namespace polyfill
const browser = chrome || browser;

document.addEventListener("DOMContentLoaded", () => {
  console.log('[Veracross Plus] Popup launcher starting...');
  
  // Close the standard popup immediately
  window.close();

  const windowWidth = 350;
  const windowHeight = 450;

  // Position the popup window near the top-right (typical extension popup position)
  // This works reliably across different browsers and screen sizes
  let left = Math.round(screen.width - windowWidth - 20); // 20px from right edge
  let top = 80; // Below browser UI

  // Ensure window stays on screen
  if (left < 0) left = 20; // Keep at least 20px from left edge
  if (top + windowHeight > screen.height) {
    top = screen.height - windowHeight - 20; // Keep at least 20px from bottom
  }

  // Firefox-compatible window creation
  const windowCreateOptions = {
    url: chrome.runtime.getURL("window.html"),
    type: "popup",
    width: windowWidth,
    height: windowHeight,
    focused: true,
    left: Math.max(0, left),
    top: Math.max(0, top)
  };

  console.log('[Veracross Plus] Creating popup window with options:', windowCreateOptions);

  // Create a custom popup window with rounded corners
  if (chrome.windows && chrome.windows.create) {
    chrome.windows.create(windowCreateOptions, (createdWindow) => {
      if (chrome.runtime.lastError) {
        console.error("[Veracross Plus] Error creating popup window:", chrome.runtime.lastError);
        // Fallback: try to open in a new tab if window creation fails
        chrome.tabs.create({ url: chrome.runtime.getURL("window.html") });
      } else {
        console.log('[Veracross Plus] Popup window created successfully:', createdWindow);
      }
    });
  } else {
    console.error('[Veracross Plus] chrome.windows.create not available, falling back to tab');
    // Fallback for browsers that don't support window creation
    chrome.tabs.create({ url: chrome.runtime.getURL("window.html") });
  }
});