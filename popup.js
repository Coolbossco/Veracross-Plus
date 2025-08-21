// Custom popup window launcher
// This creates a system-level popup window that can have true rounded corners

document.addEventListener("DOMContentLoaded", () => {
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

  // Create a custom popup window with rounded corners
  chrome.windows.create({
    url: chrome.runtime.getURL("window.html"),
    type: "popup",
    width: windowWidth,
    height: windowHeight,
    focused: true,
    left: Math.max(0, left),
    top: Math.max(0, top)
  }, (window) => {
    if (chrome.runtime.lastError) {
      console.error("Error creating popup window:", chrome.runtime.lastError);
    }
  });
});