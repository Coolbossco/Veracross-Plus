import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read manifest based on build target
const manifest = {
  manifest_version: 3,
  name: "Veracross Plus",
  description:
    "Enhanced Veracross with homework checkboxes on timeline and daily schedule, grade estimator, and custom assignments",
  version: "0.2.1",

  permissions: ["storage"],
  host_permissions: [
    "*://*.veracross.com/*",
    "*://*.myveracross.com/*",
    "*://portals.veracross.com/*",
    "*://portals-embed.veracross.com/*",
    "http://localhost:3000/*",
  ],

  icons: {
    "16": "src/assets/icons/16.png",
    "32": "src/assets/icons/32.png",
    "48": "src/assets/icons/48.png",
    "128": "src/assets/icons/128.png",
  },

  content_scripts: [
    {
      matches: [
        "*://*.veracross.com/*",
        "*://*.myveracross.com/*",
        "*://portals.veracross.com/*",
        "*://portals-embed.veracross.com/*",
      ],
      js: ["src/content/index.ts"],
      css: ["src/content/styles.css"],
      run_at: "document_end",
      all_frames: true,
    },
  ],

  action: {
    default_popup: "src/ui/popup/popup.html",
    default_title: "Veracross Plus",
    default_icon: {
      "16": "src/assets/icons/16.png",
      "24": "src/assets/icons/24.png",
      "32": "src/assets/icons/32.png",
    },
  },

  options_page: "src/ui/options/options.html",

  // No background service worker needed - this is a content script only extension
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    crx({
      manifest,
      // Disable service worker generation - we don't need it
      contentScripts: {
        injectCss: true,
      },
    }),
    // Plugin to copy CSS file to dist
    {
      name: "copy-css",
      writeBundle() {
        const cssSource = resolve(__dirname, "src/content/styles.css");
        const cssDest = resolve(__dirname, "dist/chrome/src/content/styles.css");

        if (existsSync(cssSource)) {
          mkdirSync(resolve(__dirname, "dist/chrome/src/content"), { recursive: true });
          copyFileSync(cssSource, cssDest);
        }
      },
    },
  ],
  server: {
    cors: true,
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist/chrome",
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/ui/popup/popup.html"),
        options: resolve(__dirname, "src/ui/options/options.html"),
      },
    },
    // Ensure CSS files are included
    cssCodeSplit: false,
  },
  // Ensure CSS is processed
  css: {
    // Vite handles CSS automatically
  },
});

