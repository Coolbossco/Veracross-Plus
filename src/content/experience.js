/**
 * Dual-mode experience loader for staged CWS rollout.
 *
 * Safe default is legacy = exact CWS UI from commit 8815883
 * (detached window popup + that-era content styles / checklist / custom assignments).
 * Modern UI + PR #7/#8 features load only when rollout.enabled is true.
 */

import browser from "webextension-polyfill";
import legacyCss from "./styles.legacy.css?inline";
import modernCss from "./styles.css?inline";

const STYLE_ID = "vch-experience-css";

/**
 * Vite emits root-absolute `/assets/...` urls inside `?inline` CSS. Those must
 * be rewritten to extension URLs when the stylesheet is injected into the page.
 * @param {string} css
 * @returns {string}
 */
function rewriteAssetUrls(css) {
  return css.replace(
    /url\((['"]?)(\/assets\/[^)'"]+)\1\)/g,
    (_match, _quote, path) => {
      const relative = path.replace(/^\//, "");
      try {
        return `url("${browser.runtime.getURL(relative)}")`;
      } catch {
        return `url("${path}")`;
      }
    },
  );
}

const LEGACY_CSS = rewriteAssetUrls(legacyCss);
const MODERN_CSS = rewriteAssetUrls(modernCss);

/**
 * @param {boolean} enabled
 */
export function applyExperienceStyles(enabled) {
  try {
    document.documentElement.dataset.vchExperience = enabled
      ? "modern"
      : "legacy";
  } catch {
    // ignore
  }

  const parent = document.head || document.documentElement;
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    parent.appendChild(style);
  }
  style.textContent = enabled ? MODERN_CSS : LEGACY_CSS;
}
