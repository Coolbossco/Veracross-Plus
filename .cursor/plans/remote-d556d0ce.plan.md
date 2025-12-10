<!-- d556d0ce-a672-495f-8742-10ddcc16f245 b8193dec-6ebb-49c9-b8de-0fcfefe7ac29 -->
# Remote Sync Migration

## Architecture & Requirements

- Define high-level architecture: extension ↔ Dokploy API ↔ PostgreSQL; list communication paths, authentication flow (DOM-extracted username + signed session token), and offline behavior assumptions.
- Document security considerations: HTTPS-only API, CORS policy for extension origins, rate limiting, username verification safeguards, hashed identifiers.

## Backend Service

- Choose backend stack (language, framework, ORM, migration tool) and scaffold project in `server/` directory.
- Implement authentication flow: accept Veracross username from extension, create per-device session with signed JWT/refresh token, optional signature based on extension secret.
- Build REST endpoints: `/auth/init`, `/auth/refresh`, `/settings`, `/custom-assignments`, `/assignment-checks` (CRUD as needed).
- Add validation, error handling, logging, and unit tests for each endpoint.
- Containerize service for Dokploy and configure environment variables for internal DB connection.

## Database Schema & Migrations

- Create migration scripts for PostgreSQL covering `users`, `sessions`, `user_settings`, `custom_assignments`, `assignment_checks`, and audit timestamps.
- Add indexes/constraints for lookups by `username_hash`, `user_id`, and composite uniqueness on assignment keys.
- Configure migration runner in deployment pipeline (e.g., run on container startup).

## Extension Updates

- Introduce config for API base URL; update `manifest*.json` with new `host_permissions` and optional CSP adjustments.
- Implement auth bootstrap in `content.js` to extract Veracross username safely, hash it client-side, and request session from API.
- Replace `chrome.storage.*` usages in `content.js`, `popup.js`, `window.js` with API client module handling fetches, caching, retries, and token refresh.
- Add migration script: on first run, read existing local data, push to backend, mark migration completion flag.
- Update UI to reflect sync status, error states, and possibly manual re-sync button.
- Add integration tests/mocks to cover API interactions.

## Deployment & Ops

- Provision Dokploy PostgreSQL (already chosen); set database user/password, network restricted to Dokploy.
- Deploy API container to Dokploy with environment variables for DB creds, JWT secret, and allowed origins.
- Set up CI/CD pipeline or manual build steps for API image and database migrations.
- Prepare monitoring/logging: Dokploy logs, optional Sentry/Prometheus integration, alerts for error rates.

## Rollout & Migration Strategy

- Develop staged rollout plan: internal testing, beta users, full release.
- Implement fallback to local storage if API unreachable, with queued sync when connectivity restores.
- Provide documentation for users: new permissions, privacy policy updates, how usernames are used.
- Track metrics post-launch: successful login counts, sync success rate, error spikes.

### To-dos

- [ ] Document architecture decisions and security guidelines for remote sync backend
- [ ] Scaffold Dokploy-hosted API, implement auth and REST endpoints, add migrations/tests
- [ ] Update extension to authenticate, call new API, migrate local data, and expose sync status
- [ ] Deploy API and database, configure monitoring, and execute rollout/migration plan