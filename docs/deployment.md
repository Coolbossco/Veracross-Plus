# Remote Sync Deployment Guide

This runbook covers building, deploying, and operating the remote sync API on Dokploy together with its PostgreSQL database.

## Prerequisites

- Dokploy project with access to container registry (Docker Hub, GHCR, etc.)
- Dokploy-managed PostgreSQL instance or self-managed database reachable from Dokploy
- Extension release process ready to accept new API base URL
- Optional: Sentry DSN and Prometheus/Grafana or equivalent monitoring stack

## Environment Variables

Set the following variables in Dokploy (never commit secrets):

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Full Prisma URL `postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public` |
| `JWT_SECRET` | HS256 secret for short-lived access tokens |
| `REFRESH_TOKEN_SECRET` | HS256 secret for refresh-token JWTs |
| `EXTENSION_SHARED_SECRET` | Optional shared secret for HMAC signing (leave blank to disable) |
| `ALLOWED_ORIGINS` | Comma-separated list of extension origins permitted by CORS |
| `TOKEN_ISSUER` | JWT issuer string (defaults to `remote-sync`) |
| `ACCESS_TOKEN_TTL` | Access token lifetime (e.g. `15m`) |
| `REFRESH_TOKEN_TTL` | Refresh token lifetime (e.g. `7d`) |
| `LOG_LEVEL` | Pino log level (e.g. `info`) |
| `SENTRY_DSN` | Optional DSN if Sentry is enabled |

## Build & Publish

```bash
cd server
npm ci
npm run build
docker build -t registry.example.com/remote-sync:$(git rev-parse --short HEAD) .
docker push registry.example.com/remote-sync:$(git rev-parse --short HEAD)
```

## Dokploy Service Configuration

1. Create a “Container App” pointing to the pushed image.
2. Set environment variables listed above.
3. Expose container port `4000`.
4. Configure health checks against `/health` (HTTP 200).
5. Enable log forwarding (Dokploy → integrated log viewer).

## Database Provisioning

1. Provision Dokploy PostgreSQL instance with encryption at rest.
2. Restrict network access to the Dokploy application network.
3. Create dedicated database user with minimum privileges.
4. Record credentials and construct `DATABASE_URL`.
5. Schedule automated daily backups with 30-day retention.

## Migrations

- The container entrypoint executes `npx prisma migrate deploy` before starting the API.
- On Dokploy, enable “run on start” so every deployment applies pending migrations.
- For manual migration execution: `docker compose run --rm api npx prisma migrate deploy`.

## Monitoring & Alerts

| Area | Recommendation |
| --- | --- |
| **Logs** | Dokploy log streaming + retention; consider forwarding to ELK/Splunk. |
| **Metrics** | Expose `/metrics` via optional sidecar or integrate with Prometheus scrape job. |
| **Alerts** | Configure Dokploy alert on container restarts and 5XX rate > 2% (can be emulated via external uptime monitor). |
| **Tracing** | Optionally add Sentry (set `SENTRY_DSN`) for error tracking. |

## Rollout Strategy

1. Deploy backend and database to staging; run smoke tests.
2. Flip extension base URL (via `options.html` or remote config) for internal QA only.
3. Monitor API logs, DB connections, and extension error reporting.
4. Stage extension release to 5–10% of users; observe for 24 hours.
5. Roll out to 100% once error rate stabilises.

## Operational Tasks

- **Manual Sync Retry**: users can trigger via the extension popup (“Retry Remote Sync”).
- **User Support**: correlate issues using `AuditEvent` records (`type` stores `auth.signup`, `auth.login`, `auth.refresh`, `auth.logout`, etc.).
- **Incident Response**: revoke compromised refresh tokens using SQL (`UPDATE "RefreshToken" SET revoked = true WHERE id = ?`).

## Local Development

```bash
cd server
docker compose up --build
# API available at http://localhost:4000
```

Seed data can be inserted via Prisma or direct SQL. Use `npm run dev` for hot reload outside containers.

## Extension Release Checklist

1. Update `options.html` default API URL if production endpoint changed.
2. Bump extension version in manifests.
3. Run `npm run build` (root) to produce updated Chrome/Firefox packages.
4. Smoke test authentication, checklist sync, and custom assignments.
5. Announce new permissions (host access + remote sync) in release notes and privacy policy.

