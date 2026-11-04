import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './manifest.json';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
    cors: {
      origin: /chrome-extension:\/\//,
    },
    origin: 'http://localhost:5173',
  },
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        popupLegacy: resolve(__dirname, 'src/popup/popup.legacy.html'),
        windowLegacy: resolve(__dirname, 'src/popup/window.legacy.html'),
        options: resolve(__dirname, 'src/options.html'),
      },
    },
  },
  plugins: [crx({ manifest })],
});
