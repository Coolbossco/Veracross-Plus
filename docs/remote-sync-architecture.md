# Remote Sync Architecture & Security

## System Overview

- **Clients**: Chrome and Firefox extensions collect Veracross data and communicate with the backend via HTTPS.
- **Backend API**: Dokploy-hosted service exposing REST endpoints for authentication, settings, custom assignments, and assignment checks.
- **Database**: Managed PostgreSQL instance provisioned in Dokploy, restricted to internal network access from the API container.
- **Telemetry**: Dokploy logs streamed to centralized logging; optional Sentry for error tracking and Prometheus-compatible metrics endpoint.

## Data Flow

1. The extension prompts the user for email and password; credentials are sent to `/auth/signup` (first run) or `/auth/login`.
2. Backend hashes passwords with bcrypt, issues short-lived JWT access tokens and long-lived refresh tokens bound to the device.
3. Authenticated requests from the extension include the access token in the `Authorization` header when calling `/settings`, `/custom-assignments`, and `/assignment-checks`.
4. Backend persists data in PostgreSQL using per-user tables keyed by `email` and `user_id`. All writes create audit timestamps.
5. Extension caches recent responses; when offline it queues mutations for later replay.

## Authentication & Authorization

- JWT access tokens (15 minutes) signed with `HS256`. Refresh tokens (7 days) are JWTs whose raw value is hashed with bcrypt before storage.
- Optional HMAC signature using an extension-shared secret included in `X-VC-Ext-Signature` header to prevent replay (recommended when distributing outside Chrome Web Store).
- Passwords are never stored in plaintext; bcrypt cost configurable via `BCRYPT_ROUNDS`.
- Device sessions stored in `sessions` table with `device_id`, `user_agent`, and last activity timestamps.
- Backend enforces per-user data ownership by scoping queries to authenticated `user_id`/`email`.

## API Surface

- `POST /auth/signup`: Create a new account and issue tokens.
- `POST /auth/login`: Authenticate an existing account and issue tokens.
- `POST /auth/refresh`: Refresh access token using refresh token rotation.
- `POST /auth/logout`: Revoke the provided refresh token (device-level logout).
- `GET/PUT /settings`: Retrieve and update user preferences (e.g., feature toggles).
- `GET/POST/PUT/DELETE /custom-assignments`: CRUD for manually added assignments.
- `GET/POST /assignment-checks`: Retrieve checks and create new status entries.

## Security Controls

- HTTPS enforced via Dokploy-managed TLS; HTTP requests rejected with 301.
- CORS restricts origins to published extension IDs plus localhost during development.
- Rate limiting via sliding window (e.g., 60 `/auth/login`/`/auth/signup` per minute per IP+email).
- Input validation with Zod schemas; responses sanitized to prevent injection.
- Backend logs security events (failed auth, unexpected signatures) with structured metadata.
- Refresh tokens hashed with bcrypt before storage; rotation invalidates old tokens.
- Workspace config allows only extension to access API; no public web clients.

## Offline & Resilience

- Extension maintains local IndexedDB cache; mutations persisted offline until connectivity resumes.
- API implements idempotency keys for write operations to avoid duplicates on retry.
- Background sync attempts replays with exponential backoff capped at 5 minutes.
- Circuit breaker around fetch wrapper to prevent rapid failures when API unreachable.

## Audit & Monitoring

- Every table includes `created_at` and `updated_at` managed by database triggers or ORM.
- Separate audit table records auth events: signup, login, refresh, logout, and failed attempts.
- Dokploy logs forwarded to centralized viewer; alerts configured for 5XX rate >2% over 5 minutes.
- Optional Sentry DSN recorded in env to capture unhandled backend exceptions.
- Prometheus-style `/metrics` endpoint exposes request latency, error counts, and DB pool stats.

## Deployment Considerations

- API container built from Node.js base image with production `NODE_ENV`.
- Configuration via environment variables: `DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `EXTENSION_SHARED_SECRET`, `ALLOWED_ORIGINS`.
- Migrations executed automatically on startup using Prisma migrate or equivalent.
- Connection pooling limited (e.g., max 10) to align with Dokploy Postgres plan.
- Daily backup job scheduled within Dokploy; retention of 30 days.


