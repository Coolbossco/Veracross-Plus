/**
 * Dual-mode experience loader for staged CWS rollout.
 *
 * Safe default is legacy (0.6.x / pre-redesign). Modern UI + PR #7/#8
 * features load only when rollout.enabled is true.
 *
 * Modules are imported statically so content-script loading does not depend on
 * page-origin dynamic `import()` URLs.
 */

import browser from "webextension-polyfill";
import legacyCss from "./styles.legacy.css?inline";
import modernCss from "./styles.css?inline";
import * as homepageLegacy from "./homepage.legacy.js";
import * as homepageModern from "./homepage.js";
import * as whatsNewLegacy from "./whats-new.legacy.js";
import * as whatsNewModern from "./whats-new.js";

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

/**
 * @typedef {{
 *   initWhatsNew: () => Promise<void>,
 *   applyHomepageWidget: (settings?: object) => Promise<void>,
 * }} ExperienceModules
 */

/**
 * @param {boolean} enabled
 * @returns {ExperienceModules}
 */
export function loadExperienceModules(enabled) {
  if (enabled) {
    return {
      initWhatsNew: whatsNewModern.initWhatsNew,
      applyHomepageWidget: homepageModern.applyHomepageWidget,
    };
  }
  return {
    initWhatsNew: whatsNewLegacy.initWhatsNew,
    applyHomepageWidget: homepageLegacy.applyHomepageWidget,
  };
}
