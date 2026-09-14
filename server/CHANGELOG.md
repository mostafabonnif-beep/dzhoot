# Changelog

All notable changes to the DZ HOOF server are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses [Semantic Versioning](https://semver.org/).

> Entries under **Unreleased** are updated automatically by CI when a new release tag is pushed.

---

## [Unreleased]

### Fixed (mandatory updates were inert)

- `GET /api/v1/app/version` now honours a deployment-wide minimum supported version:
  `APP_MIN_SUPPORTED_VERSION_CODE` (a release's own `minCompatibleVersion` may raise it,
  never lower it). Production serves releases from the GitHub fallback, which carries no
  per-release metadata, so `minimumSupportedVersionCode` was hard-coded to 1 there and
  `mandatory` was always false — a build the operator considers unsupported could keep
  running forever. An unset, non-numeric or below-1 value is ignored with a one-time
  warning, so a typo cannot force every installed device to update, and `mandatory` is now
  only reported when an update is actually available (a floor above the newest published
  build no longer strands devices on a blocking prompt). Covered by five new cases in
  `src/__tests__/app-update.test.ts`; documented in `server/.env.example` and
  `docs/API_DOCUMENTATION.md`.

### Security (crash reports)

- `POST /api/v1/app/crash-report` now redacts every free-text field before it is stored.
  A crashed app cannot be trusted to have scrubbed its own payload, and a throwable message
  routinely embeds the URL or token that caused the failure — so `exceptionMessage`,
  `stackTrace` and `screen` pass through the central redactor
  (`services/audit-log.ts#redactSensitiveText`), which now also covers Xtream-style account
  path segments (`/live/<user>/<password>/1423.ts` — the query-parameter rule never saw
  these) and signed JWTs (`eyJ…` triples), and accepts a per-call length bound so a stack
  trace is still bounded at 50 000 characters. Operators reading a report can no longer
  recover Xtream credentials, session tokens or playback tokens from it; the failure site
  (exception type, message, file:line) is preserved. Covered by
  `src/__tests__/app-update-crash-report.test.ts` plus the extended `redactSensitiveText`
  cases in `src/services/audit-log.test.ts`.

### Added (admin release management UI)

- `/admin/versions` can now publish and manage release metadata instead of being a
  read-only view of the public endpoints. It lists the admin-managed `AppVersion` rows with
  a provenance badge (COMPLETE only when sha256, a positive size, the file name and the
  download URL are all present, otherwise the missing field is named — the same rule the
  backend diagnostics apply), publishes new releases (auto-deriving `versionCode` from
  `versionName` with the documented `major*10000+minor*100+patch` rule, overridable with an
  explicit warning when the override disagrees, since clients reject such an artifact), and
  edits only what the API allows to change — `isActive`, `releaseNotes`, `isMandatory`,
  `minCompatibleVersion`, `releaseChannel`, `distribution`, `platforms`. Deactivating a
  release asks for confirmation, and the UI states that the artifact identity is immutable
  after publish (a fix means a new `versionCode`) and that every write is audited.
- The release-metadata rules now live in `frontend/src/lib/release-metadata.ts` and are
  unit-tested (16 tests).

### Added (release verification)

- `src/scripts/verify-release-provenance.ts` (`npm run verify:release-provenance`) —
  compares a release manifest against what `GET /api/v1/app/version` actually serves
  (versionName, versionCode, sha256, sizeBytes, releaseChannel, distribution and the APK
  file name in the served `downloadUrl`). Fails closed: an unverifiable manifest is
  rejected before any network call, an API that serves no release is an error, and any
  disagreement exits non-zero so it can gate a publish or a deploy. Read-only, no admin
  session, no database access. Falls back to the legacy `currentVersion` parameter so it
  works against a pre-contract deployment. See `docs/VERIFY_RELEASE_PROVENANCE.md`.

### Added (admin diagnostics)

- `GET /api/v1/admin/diagnostics` — one ordered list of checks with the evidence behind
  each verdict (build identity, environment, MongoDB with latency, Redis, and the release
  pipeline: published release, artifact completeness, HTTPS + allowlisted download host,
  versionCode derivation, update host allowlist, scheduler health), plus the newest active
  release and the server's build identity. `overall` is the worst verdict. It reports
  booleans, counts, latencies and host names only — never a token or connection string.
- `/admin/diagnostics` renders it (trilingual, RTL) with a colored status per check.

### Added (health)

- `GET /health/version` — non-sensitive build metadata (`service`, `version`, `commit`,
  `builtAt`, `environment`, `requestId`). The endpoint existed in the operations brief but
  returned 404. No status probes, connection strings, internal hostnames or secrets.
- `/health` and `/health/version` now build their version/commit/builtAt from one shared
  helper, so a deploy can never report two different versions.

### Added (error taxonomy)

- Central, searchable error-code registry in `@dzhoof/shared`
  (`packages/shared/src/errors/error-codes.ts`) with the 22 codes from the operations
  brief, each carrying `userMessageKey`, `developerMessage`, `retryable`, `severity`,
  `feature` and `remediation`.
- `buildErrorReport(code, { correlationId, httpStatus, durationMs, details })` builds the
  safe, non-sensitive report shape shared by telemetry and diagnostics. `details` is flat
  and primitive-only, so a credential object cannot be attached by accident.
- `GET /api/v1/app/version` error responses now include `errorCode`, `userMessageKey` and
  `retryable` (`UPDATE_METADATA_INVALID` for a bad request, `UPDATE_CHECK_NETWORK` for a
  provider failure) next to the unchanged legacy `error` string, so shipped clients keep
  working and new clients stop parsing message text.
- New reference: `server/docs/ERROR_TAXONOMY.md` (generated from the registry).


### Added (app release provenance + admin publish path)

- `AppVersion` now stores `sha256`, `releaseChannel` (`stable`/`beta`), `distribution`
  (`external_apk`/`play`/`managed_device`) and an optional `platforms` scope, with enum
  validation shared with the API schema. Legacy rows default to `stable` /
  `external_apk` at read time and are made explicit by migration **0016**
  (`npm run migrate:app-version-provenance`, dry-run by default, idempotent).
- New admin-only routes `GET|POST /api/v1/admin/app-versions` and
  `PATCH /api/v1/admin/app-versions/:id` — the first writer for release metadata
  (publishing previously had no code path at all). Every write is audited
  (`APP_VERSION_PUBLISH` / `APP_VERSION_UPDATE`).
- Artifact identity (`versionCode`, `versionName`, `apkFileName`, `apkFileSize`,
  `downloadUrl`, `sha256`) is immutable after publication: re-pointing a URL or
  checksum at the same `versionCode` would let devices install bytes that no longer
  match the reviewed release. Operators publish a new `versionCode` instead.
- `createAppVersionSchema` now requires an https `downloadUrl`, validates the checksum
  shape, and accepts `releaseChannel`, `distribution`, `platforms` and `releasedAt`.

### Changed (app update API — `/api/v1/app/version`)

- `GET /api/v1/app/version` now accepts the documented `currentVersionCode` parameter alongside the
  legacy `currentVersion` alias, plus `channel` (`stable`/`beta`, default `stable`) and `platform`
  (`android`/`android-tv`/`android-mobile`/`fire-tv`), validated by a shared Zod schema.
- `latestVersion` now exposes `minimumSupportedVersionCode`, `releaseChannel`, `distribution`,
  `sha256`, `sizeBytes`, `releaseNotesList` and `publishedAt`; the top level exposes `mandatory` and
  `currentVersionCode`. The legacy keys (`releaseNotes`, `apkFileSize`, `isMandatory`,
  `currentVersion`, …) are unchanged so already-shipped clients keep working.
- `sha256` is read from the release's published `<apk>.sha256` asset (validated HTTPS allowlist +
  SSRF guard on every redirect hop).
- `downloadUrl` is fail-closed: a non-HTTPS URL, or one whose host is not allowlisted, is returned as
  `null`. Extend the allowlist with `APP_UPDATE_ALLOWED_HOSTS`.
- Added a dedicated, configurable rate limit (`APP_UPDATE_RATE_LIMIT_MAX`, default 1000/15min) and a
  real route test suite (previously the `.js` test file was not matched by Jest, so the endpoint had
  no running tests).

### Added (source resilience — mirror domains)

- `XtreamSource.mirrorServerUrls` (validated http(s) array; admin API create/patch + exposed
  in `publicShape`). Alternate panel domains for the **same account**.
- **Automatic API/mirror fallback**: `apiGet` (player_api / sync / verification / series)
  tries the primary `serverUrl` first, then each mirror — a dead primary domain no longer
  blocks catalog sync or source verification.
- **Automatic playback mirror fallback** (live): when the watchdog reports the primary domain
  down and no provider-level backup map exists, the playback token rewrites the stream URL to
  the mirror domain (slot 0 only; **catch-up is never mirrored**) and flags `source: "mirror"`
  in the token response. v2 channel-reference tokens apply the same rewrite at resolve time.
- **Automatic playback mirror fallback (VOD)**: movie tokens (`movie.sourceId`) and series
  episode tokens (parent series `sourceId`) rewrite to the mirror domain under the same
  condition. No-op when the source is healthy, has no mirror, or the URL is not under the
  primary base.

### Fixed (watchdog health)

- Watchdog direct-playback probe no longer treats **TS transport streams** as HLS manifests:
  `.ts` URLs are light-probed (stream response, 1 KB cap, destroy immediately; HTTP 200-399 =
  alive) instead of failing with `maxContentLength size of 524288 exceeded` every cycle, which
  wrongly persisted `verificationStatus=degraded` on healthy TS-format sources (e.g. primary
  source) and blocked scheduled catalog sync.

### Fixed (catalog access)

- `GET /api/v1/channels` and `/channels/grouped` (the TV app channel list) now apply the
  **direct-playback exemption** for `metadata.isWorking`: sources marked `directPlayback`
  keep their full catalog visible even when the server-side probe (from the datacenter IP,
  blocked upstream) reports `isWorking:false`. Previously the app listed only the handful
  of channels that passed the datacenter probe.
- `TV_CHANNELS_MAX` default raised **2000 → 20000** so subscribers receive the full
  ~16.6k-channel catalog in one sync (still overridable via env).

### Security (audit-remediation-v1)

- Public self-service registration is now **disabled by default** (`PUBLIC_REGISTRATION_ENABLED=false`).
  It only opens when the flag is `true` **and** an effective mail provider (Brevo) **and**
  reCAPTCHA keys are configured. Both `/api/v1/auth/register` and `/api/v1/public/signup` return 403 otherwise.
- Frontend hides (instead of showing broken) OAuth buttons, the signup link/form, and the demo-code
  entry when the operator has not configured them (`/api/v1/config/defaults` now reports capability flags).
- `/health` public payload reduced to `{status, version, requestId}`; operational details
  (Mongo/Redis/uptime/sources/EPG/scheduler) only with `?details=true`.
- Conservative Caddy security headers: Content-Security-Policy, Permissions-Policy,
  X-Permitted-Cross-Domain-Policies (in addition to existing HSTS/X-Content-Type-Options/X-Frame-Options).

### Fixed

- Scheduler EPG refresh no longer crashes the container with a heap OOM:
  bounded-concurrency fetching (default sequential), per-source hard timeout, decompressed-size cap,
  per-source program cap, and a heap guard that skips (and records) oversized sources instead of dying.
  One failing/oversized source is isolated — the rest of the refresh completes (regression tests added).
- Production preflight extended: committed-secret scan, env placeholder detection, compose/image tag validation.

### Changed

- Docker base images pinned by fixed tag: `caddy:2.8.4-alpine`, `mongo:7.0.19`, `redis:7.2.5-alpine`.
- Unified app version: workspace/backend/frontend/shared packages and Dockerfile `APP_VERSION` default → `1.0.1`.
- Scheduler container memory limit raised 512MB → 1536MB with `NODE_OPTIONS=--max-old-space-size=1024`
  (conservative for a 5.8GB host); new tunable EPG env vars documented in `.env.example`.

### Added

- `scripts/deploy/preflight.sh` — read-only deploy gate (secrets, env, compose, image tags).
- `scripts/backup/verify-backup.sh` — gzip + SHA256 + `mongorestore --dryRun` backup verification.
- `scripts/security/secure-ssh-setup.sh` — **optional, non-destructive** SSH hardening plan
  (sudo user, Ed25519 keys, fail2ban; does not touch sshd_config until the operator approves).
- `docs/ops/ROLLBACK_GUIDE.md`, `docs/ops/STAGING_GUIDE.md`, `docs/ops/SSH_HARDENING_GUIDE.md`.
- `utils/concurrency.ts` — bounded-concurrency batch runner with per-item timeout and failure isolation.
- `epg-refresh-resilience`, `concurrency-util`, `registration-lockdown` backend test suites.
- `scripts/deploy/deploy-production.sh` — the exact, reviewable production deploy plan
  (dry-run by default; `--apply` only after operator approval; preflight + verified
  backup + tagged builds + compose up + health/scheduler smoke + deploy log).
- `scripts/ops/health-check.sh` — cron-able health probe with optional webhook alerts.
- Scheduler logs heap usage and effective EPG concurrency at startup.

---

## [Unreleased]

### Added

- Production deployment guide for the current DZ HOOF Docker Compose stack, health endpoints, backups, rollback, and release operations.
- Request IDs in API error and 404 responses for safer support diagnostics.

### Changed

- Unified Android release workflow around the `com.dzhoof.iptv` application, HTTPS `DZHOOF_API_URL`, DZ HOOF artifact names, and GitHub Releases.
- Updated project status and setup documentation to reflect current test coverage and Next.js production validation.

### Security

- CI now fails on high-or-above production dependency vulnerabilities and cancels obsolete runs.

---

## [1.3.1] - 2026-07-14

### Fixed

- container healthchecks use IPv4 loopback; bind Next.js standalone server to all interfaces
- point production `REDIS_URL` at the `dzhoof-redis` service; disable scheduler HTTP healthcheck

---

## [1.3.0] - 2026-07-14

### Added

- bound database growth with EPG cap, audit-log TTLs and lean indexes
- categorize, club and dedup channels at import; fix EXTINF titles
- cache channel serving, slim response payloads and cap list sizes
- add data-cleanup migrations (dry-run by default)
- expandable audit resource IDs and channel health stats in admin UI

### Fixed

- enforce channel cap atomically on all add paths; harden dedup remap
- enforce channel ownership boundary; scheduler exits on fatal errors
- external source status filter never matched alive or dead streams
- address review findings on cache staleness, cap races and migration safety

### Other

- record growth-prevention features and architecture decisions (ADRs)

---

## [1.2.1] - 2026-07-14

### Other

- wire `DEMO_CHANNEL_LIST_CODE` through prod compose and the deploy workflow

---

## [1.2.0] - 2026-07-14

### Added

- per-user channel ownership plus security & reliability hardening

### Other

- polish README for public discoverability; add screenshots and missing images
- refactor code structure for improved readability and maintainability

---

## [1.1.4] - 2026-04-06

### Added

- add build-time environment variables for the frontend Docker image

---

## [1.1.3] - 2026-04-06

### Added

- integrate Google reCAPTCHA for registration and enhance login error handling

### Other

- rename `SENTRY_DSN` to `BACKEND_SENTRY_DSN` for consistency across environments
- add how-to guide for adding channels to a playlist, with images and clearer instructions
- refactor code structure for improved readability and maintainability

---

## [1.1.2] - 2026-04-04

### Other

- refactor code structure for improved readability and maintainability

---

## [1.1.1] - 2026-04-04

### Added

- include user-owned channels in access-control queries

---

## [1.1.0] - 2026-04-04

### Added

- unify color palette across web and Android apps with new design tokens; add color palette reference
- implement alternate stream handling and promote-confirmation in the channel detail modal
- enhance channel flagging logic and alternate stream display
- add alternate-streams fields to channel updates and a diagnostic stats endpoint
- add QR code scanner component and integrate it into the device pairing flow
- implement user-based rate limiting and enhance mobile sidebar functionality (#35, #36)
- refactor registration page to use the AuthSidePanel component
- enhance layout and UI components for improved responsiveness and usability
- add SVG logo, icons, og-image, robots.txt and project description for branding and SEO
- add tests for IPTV-org grouped routes and stream metrics
- add FUNDING.yml for sponsorship information

### Fixed

- add type annotation for alternate streams in the channel schema

### Other

- add self-hosting guide for non-technical users and `docker-compose.selfhost.yml`

---

## [1.0.13] - 2026-03-30

### Added

- add Sentry error tracking and Codecov coverage reporting
- improve admin user assigned channels view with stats and richer table

### Fixed

- separate rate limiter for TV pairing status polling endpoint

### Other

- Apply suggestions from code review
- Fix list-related bugs: broken search filter, wrong stats display, and missing parseInt radix

## [1.0.12] - 2026-03-21

### Added

- enhance channel detail modal with alternate stream numbering
- implement alternate stream fallback and promotion logic for channels
- implement favorites syncing and display in channels page
- add proxy play tracking and metrics across the application
- enhance channel metrics tracking and update user dashboard with channel health stats
- add stream metrics system with dead/alive/unresponsive/play counters
- smart stream grouping, fallback, auto-promotion & bad stream flagging (#6)

### Fixed

- add proxy play count and last played/dead timestamps to channel metrics display
- enhance channel testing and reporting with improved axios configuration and error handling
- use atomic $inc for metrics in test endpoint and add metrics to Zod schema
- add .unref() to rate-limit cleanup timer to allow graceful shutdown
- resolve lint error in import-page-shell grouped mode toggle

## [1.0.11] - 2026-03-18

### Added

- feat(tv-auth): add dedicated TV code auth middleware, categories and favorites endpoints

### Fixed

- fix(auth): allow TV apps to authenticate using channel list code as session ID
- fix(deploy): fix env vars not reaching containers and admin credential migration

## [1.0.10] - 2026-03-18

### Fixed

- fix(deploy): fix env vars not reaching containers and admin credential migration

## [1.0.9] - 2026-03-18

### Fixed

- fix(deploy): use case-insensitive stack name lookup for Portainer

## [1.0.8] - 2026-03-18

### Added

- enhance docker-publish.yml with production deployment to Portainer

### Fixed

- fix(server): enable trust proxy in production for correct rate limiting
- fix(deploy): remove compose healthchecks to unblock Portainer stack creation
- fix(deploy): add external network check and improve stack deployment
- deployment pipeline improvements for Portainer stack creation
- fix(deploy): enhance production deployment configuration
- ensure frontend public directory is created before build

## [1.0.7] - 2026-03-18

### Added

- enhance Docker image build and deployment process with frontend support and health checks

## [1.0.6] - 2026-03-18

### Added

- enhance Portainer stack management with creation and update logic

## [1.0.5] - 2026-03-18

### Added

- update environment variables for GitHub OAuth and app configuration
- add Privacy Policy and Terms of Service pages
- enhance admin stats and session management
- enhance external source tab with optional top slot for custom content
- add charts, trends, and visualizations to Statistics page (#8)

### Changed

- replace image proxy byte-caching with validate + 302 redirect

### Other

- Unify admin and user pages into shared role-aware components (#7)

## [1.0.4] - 2026-03-17

### Added

- Refactor user and channel tables to use reusable DataTable component

### Changed

- update layout styles for authentication pages and improve overflow handling

## [1.0.3] - 2026-03-17

### Added

- User sources page and external source tab for channel management (Pluto TV, Samsung TV Plus)

## [1.0.2] - 2026-03-17

### Added

- Email verification flow with 24-hour token expiry and welcome email
- Next.js 14 frontend with App Router, Zustand, React Query, Tailwind CSS
- Stream player with persistent context, mini player, and HLS.js integration
- Quick Pick wizard for multi-source channel discovery (6-step flow)
- Scheduler microservice with liveness checks, EPG refresh, cache refresh
- External sources integration (Pluto TV and Samsung TV Plus)
- EPG service fetching XMLTV data from iptv-epg.org
- OAuth handling in login page
- App versions management page with version history and downloads
- IPTV channel import page for user dashboard
- Column filtering on user management page
- Debounced search hook across channels and recommendations pages
- Reusable DataTable, ColumnFilter, SelectionToolbar components
- Separate Dockerfiles for frontend (prod and dev)

### Changed

- Containerize Next.js frontend and remove old static UI
- Print service URLs and credentials after `make up`
- Consistent text sizing (xs) across typography styles
- Lazy loading on images in user profile and import pages
- Enhanced accessibility and UX across multiple components
- Enhanced statistics page with detailed stats endpoint

### Fixed

- Responsive design border class in AdminDashboard
- Docker publish workflow paths and trigger filters

### Removed

- Unused models, routes, and utilities for refresh tokens and legacy app version management

## [1.0.1] - 2025-11-28

### Added

- GitHub Actions workflow for building and publishing Docker image
- Device pairing functionality with setup guide
- JWT authentication and OAuth integration (Google, GitHub)
- User management module with CRUD operations and channel assignment
- IPTV-org JSON API integration with rich metadata
- Channel stream testing with batch support
- Stream proxy for CORS bypass with M3U8 rewriting
- Image proxy with 24-hour in-memory cache
- TV/device pairing via PIN and legacy channel list code
- Statistics dashboard (channels, users, sessions, devices, activity timeline)
- Health check endpoint
- Docker deployment with MongoDB, docker-compose

### Changed

- Refactored channel management and playlist references
- Refactored TV device pairing functionality
- Refactored code structure for improved readability

### Fixed

- Quick Filters and channel testing limits
- CSP and event listener issues blocking stream playback
- Helmet CSP to allow blob URLs for HLS.js

## [1.0.0] - 2025-11-01

### Added

- Initial release
- Express.js API server with MongoDB
- Channel management (CRUD, M3U import/export)
- User authentication with session-based auth
- Admin panel with AdminLTE UI
- Global M3U playlist generation with playlist code protection
- HLS video player with HLS.js
- Bcrypt password hashing
- Helmet security headers and CORS
- Gzip compression and Morgan logging

---

[Unreleased]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.13...v1.1.0
[1.0.13]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.12...v1.0.13
[1.0.12]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.11...v1.0.12
[1.0.11]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/1.0.2...v1.0.3
[1.0.2]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.1...1.0.2
[1.0.1]: https://github.com/akshaynikhare/FireVisionIPTVServer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/akshaynikhare/FireVisionIPTVServer/releases/tag/v1.0.0
