# Staged CWS rollout

Veracross Plus ships one Chrome Web Store package per version. Named soft-launch
uses a **read-only Cloudflare Worker** plus KV config edited in the dashboard.
Package exposure still uses CWS gradual rollout % / Trusted Testers.

## Layers

| Layer | Role |
| --- | --- |
| CWS % / Trusted Testers | Who receives the package |
| Worker + KV (`rollout.codegraph.cc`) | Who gets the **new UI / features** for that version |

## Dual experience (0.7.0+)

The package contains **both** UIs. The Worker decides which one runs:

| `enabled` | Who | Experience |
| --- | --- | --- |
| `false` | Not on allowlist **and** version not published | **Exact CWS / pre-redesign UI** anchored at commit [`8815883`](https://github.com/Coolbossco/Veracross-Plus/commit/881588351be694d3a66e93e392e4e9e7d0836a01): detached `window.legacy` settings popup, that-era content styles, checklist, custom-assignment FAB/modals (via `legacy-app.js`) |
| `true` | Allowlisted **or** `published: true` | **Redesigned UI + PR #7/#8 features** (achromatic-ledger chrome, homepage/lunch widgets, themes tour, day-grouped homework, modern toolbar popup) |

Safe default until the Worker responds: **legacy** (no flash of the redesign).

The client also sets `document.documentElement.dataset.vchRollout` (`"1"` / `"0"`),
`dataset.vchExperience` (`modern` / `legacy`), syncs `rolloutEnabled` to
`storage.local`, shows a **Beta** badge on the modern popup, and swaps the
toolbar action via `action.setPopup` between `popup.legacy.html` and `popup.html`.

## Operator steps (every release)

1. Land features on `main`.
2. Bump **`package.json`** and **`manifest.json`** to the same version; add a
   `src/whats-new/changelog.js` entry.
3. In Cloudflare → KV namespace for the Worker, create/update key
   `rollout:<version>`:

   ```json
   { "published": false, "allowlist": ["parnellks"] }
   ```

4. Build (`npm run build` / `npm run zip`) and upload to CWS. Optionally start
   at a low gradual rollout % or Trusted Testers.
5. Add Veracross local-parts (lowercase, e.g. `parnellks`) in the KV JSON via
   the dashboard. Testers visit the portal once so the content script can
   resolve identity and fetch the Worker (that visit also switches their popup
   to the modern HTML).
6. When ready for everyone: set `"published": true` in the same KV key (no new
   store build required for the flag). Raise CWS % to 100% as desired.
7. Next version: bump again, new KV key with `published: false`, repeat.

## Worker

See [`rollout-worker/README.md`](../rollout-worker/README.md) for deploy,
binding, and curl examples.

```bash
curl -sS 'https://rollout.codegraph.cc/v1/rollout?version=0.7.0&user=parnellks'
```

## Extension client

- `src/content/rollout.js` — resolve local-part, fetch Worker, apply dataset /
  storage, notify background.
- `src/content/experience.js` — inject legacy (`styles.legacy.css` from 8815883)
  vs modern CSS.
- `src/content/legacy-app.js` — exact content app from 8815883 (booted when
  `enabled === false`).
- Legacy popup stack: `popup.legacy.html` → opens `window.legacy.html` (8815883).
- Booted from `src/content/content.js` (legacy CSS painted before the fetch).
- Host permission: `https://rollout.codegraph.cc/*`.

## Verify locally (Load Unpacked)

1. `npm run build` → Load Unpacked from `dist/`.
2. Reload the extension on `chrome://extensions`, hard-reload the Veracross tab
   (Ctrl+Shift+R), re-open the toolbar icon.
3. User **not** on the KV allowlist → detached rounded settings window + page
   chrome matching commit 8815883 / current CWS (not the redesigned toolbar popup).
4. Add your Veracross local-part to the allowlist (or set `published: true`) →
   reload the portal tab → redesign UI + modern toolbar popup + Beta badge.

## Gating new surfaces

```js
// Prefer dataset after initRollout()
const modern = document.documentElement.dataset.vchRollout === "1";

// Or mark markup for automatic show/hide
// <div data-vch-beta hidden>…</div>
```

Do **not** use Umami (`stats.codegraph.cc`) for rollout config — analytics only.
