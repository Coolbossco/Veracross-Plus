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
| `false` | Not on allowlist **and** version not published | **CWS-equivalent legacy UI** (0.6.x / pre-redesign): legacy popup, homepage widget, lunch chips/cards, custom-assignment FAB/modal, what’s-new, and styles |
| `true` | Allowlisted **or** `published: true` | **Redesigned UI + PR #7/#8 features** (achromatic-ledger chrome, day-grouped homework, near-today ordering, modern popup / tour) |

Safe default until the Worker responds: **legacy** (no flash of the redesign).

The client also sets `document.documentElement.dataset.vchRollout` (`"1"` / `"0"`),
`dataset.vchExperience` (`modern` / `legacy`), syncs `rolloutEnabled` to
`storage.local`, shows a **Beta** badge on the modern popup, and swaps the
toolbar popup HTML via `action.setPopup`.

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
  storage / beta DOM, notify background.
- `src/content/experience.js` — inject legacy vs modern CSS; load homepage /
  what’s-new modules for the active mode.
- Legacy snapshots: `styles.legacy.css`, `homepage.legacy.js`,
  `whats-new.legacy.js`, `popup.legacy.html` (from 0.6.0 / pre-redesign).
- Booted early from `src/content/content.js` (legacy CSS painted before the
  fetch resolves).
- Host permission: `https://rollout.codegraph.cc/*`.

## Verify locally (Load Unpacked)

1. `npm run build` → Load Unpacked from `dist/`.
2. Open the student portal while **not** on the KV allowlist → toolbar popup and
   page chrome should match current CWS (legacy). Hard-reload the portal tab
   after changing allowlist.
3. Add your Veracross local-part to the allowlist (or set `published: true`) →
   reload the portal tab → redesign UI + Beta badge on the modern popup.
4. Files to hard-reload after rebuild: extension on `chrome://extensions`
   (Reload), then the Veracross tab (Ctrl+Shift+R). Re-open the toolbar popup.

## Gating new surfaces

```js
// Prefer dataset after initRollout()
const modern = document.documentElement.dataset.vchRollout === "1";

// Or mark markup for automatic show/hide
// <div data-vch-beta hidden>…</div>
```

Do **not** use Umami (`stats.codegraph.cc`) for rollout config — analytics only.
