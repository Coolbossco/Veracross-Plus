import browser from "webextension-polyfill";

document.addEventListener("DOMContentLoaded", () => {
  // Close the standard popup immediately
  window.close();

  const windowWidth = 350;
  const windowHeight = 450;

  // Position the popup window near the top-right (typical extension popup position)
  let left = Math.round(screen.width - windowWidth - 20); // 20px from right edge
  let top = 80; // Below browser UI

  // Ensure window stays on screen
  if (left < 0) left = 20; // Keep at least 20px from left edge
  if (top + windowHeight > screen.height) {
    top = screen.height - windowHeight - 20; // Keep at least 20px from bottom
  }

  const windowUrl = browser.runtime.getURL("src/popup/window.legacy.html");
  const windowCreateOptions = {
    url: windowUrl,
    type: "popup",
    width: windowWidth,
    height: windowHeight,
    focused: true,
    left: Math.max(0, left),
    top: Math.max(0, top),
  };

  // Create a custom popup window with rounded corners (exact CWS / 8815883 behavior)
  if (browser.windows && browser.windows.create) {
    browser.windows.create(windowCreateOptions).catch(() => {
      browser.tabs.create({ url: windowUrl });
    });
  } else {
    browser.tabs.create({ url: windowUrl });
  }
});
