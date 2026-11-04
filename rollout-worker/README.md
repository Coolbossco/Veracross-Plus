# Veracross Plus rollout Worker

Read-only HTTP API that tells extension installs whether the current version’s
**beta channel** is enabled for a Veracross username (email local-part).

Config is edited **only** in the Cloudflare dashboard (KV). There is no write
API and no admin secret over HTTP.

## Endpoint

```http
GET /v1/rollout?version=0.7.0&user=parnellks
```

Response:

```json
{
  "enabled": true,
  "version": "0.7.0",
  "published": false,
  "reason": "allowlisted"
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | `true` when `published` is true **or** `user` is in the version allowlist |
| `version` | Echo of the requested version |
| `published` | Whether this version is open to everyone |
| `reason` | `published` · `allowlisted` · `not_allowlisted` · `unpublished` · `missing_config` · … |

Missing KV key → `{ "enabled": false, "reason": "missing_config", … }`.

CORS: `Access-Control-Allow-Origin: *` on GET/OPTIONS.  
`Cache-Control: public, max-age=120` (60–300s range).

## Dashboard setup

1. Cloudflare dashboard → **Workers & Pages** → **KV** → **Create a namespace**  
   (e.g. `veracross-plus-rollout`).
2. Copy the namespace **id** into `wrangler.toml` (`id = "…"`).
3. Create a Worker (this folder) and bind the namespace as **`ROLLOUT_KV`**  
   (already declared in `wrangler.toml`).
4. Attach a route or custom domain: `rollout.codegraph.cc`.
5. Deploy:

   ```bash
   cd rollout-worker
   npx wrangler deploy
   ```

6. In KV, add a key per extension version:

   | Key | Value |
   | --- | --- |
   | `rollout:0.7.0` | `{ "published": false, "allowlist": ["parnellks"] }` |

   Edit the JSON in the dashboard to add usernames or set `"published": true`.

Usernames are **lowercased local-parts** (e.g. `parnellks` from
`parnellks@countryday.net`). Full emails are accepted in the allowlist and
normalized the same way.

## Example curl

```bash
curl -sS 'https://rollout.codegraph.cc/v1/rollout?version=0.7.0&user=parnellks'
```

Expected while unpublished but allowlisted:

```json
{"enabled":true,"version":"0.7.0","published":false,"reason":"allowlisted"}
```

Unknown user while unpublished:

```bash
curl -sS 'https://rollout.codegraph.cc/v1/rollout?version=0.7.0&user=someoneelse'
# {"enabled":false,"version":"0.7.0","published":false,"reason":"not_allowlisted"}
```

## What this does *not* do

- It does **not** push different Chrome Web Store packages to named users.
- Package exposure still uses CWS gradual % / Trusted Testers.
- This Worker gates the extension’s **beta channel** (`dataset.vchRollout`,
  popup Beta badge, `[data-vch-beta]` surfaces). For 0.7.0 the redesign UI
  ships in the package; future flags should check `rollout.betaChannel`.
