# Staged CWS rollout

Veracross Plus ships one Chrome Web Store package per version. Named soft-launch
uses a **read-only Cloudflare Worker** plus KV config edited in the dashboard.
Package exposure still uses CWS gradual rollout % / Trusted Testers.

## Layers

| Layer | Role |
| --- | --- |
| CWS % / Trusted Testers | Who receives the package |
| Worker + KV (`rollout.codegraph.cc`) | Who gets **beta channel** for that version |

For **0.7.0**, the UI redesign ships in the package to everyone who installs it.
The Worker sets `document.documentElement.dataset.vchRollout`, syncs
`rolloutEnabled` to `storage.local`, shows a **Beta** badge in the popup, and
enables `[data-vch-beta]` surfaces. Future gated UI should check
`dataset.vchRollout === "1"` (or `storage.local.rolloutEnabled`).

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
   resolve identity and fetch the Worker.
6. When ready for everyone: set `"published": true` in the same KV key (no new
   store build required for the beta flag). Raise CWS % to 100% as desired.
7. Next version: bump again, new KV key with `published: false`, repeat.

## Worker

See [`rollout-worker/README.md`](../rollout-worker/README.md) for deploy,
binding, and curl examples.

```bash
curl -sS 'https://rollout.codegraph.cc/v1/rollout?version=0.7.0&user=parnellks'
```

## Extension client

- `src/content/rollout.js` — resolve local-part, fetch Worker, apply dataset /
  storage / beta DOM.
- Booted early from `src/content/content.js`.
- Host permission: `https://rollout.codegraph.cc/*`.

## Gating new surfaces

```js
// Prefer dataset after initRollout()
const betaOn = document.documentElement.dataset.vchRollout === "1";

// Or mark markup for automatic show/hide
// <div data-vch-beta hidden>…</div>
```

Do **not** use Umami (`stats.codegraph.cc`) for rollout config — analytics only.
