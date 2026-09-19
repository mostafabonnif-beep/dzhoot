# DZ HOOF — Server Project Status

_Last verified: 2026-09-16 (production VPS + CI). The newest section is
"Re-verified 2026-09-16" below; the older sections are kept for their measured history._

## Re-verified 2026-09-16 (audit hardening pass)

Measured on the VPS and against the repository, not copied forward:

- **Baseline was green before anything was changed**: backend 94 suites / 866 tests,
  frontend 12 suites / 68 tests, lint 0 errors, production builds clean, and
  `scripts/deploy/smoke-test.sh` 15/15 against `https://iptv.ld-11.net`. The defects fixed
  in this pass were therefore *semantic*, not test failures — they were found by reading
  the code against its own contracts.
- **Fixed (PR #312, server)** — each with regression tests (99 suites / 899 tests now):
  - the freemium channel-group boundary could be bypassed: `PUT/GET/POST
    /api/v1/user-playlist/me/channels` minted playback tokens without applying the group
    scope `/tv/playback-token` applies, and `/tv/playback/:token` did not re-check at
    consumption time;
  - `routes/auth.js` carried a second, divergent `requireAuth` (imported by 28 route
    modules) that dropped `accessGroups`/`freeAccess`/`allCatalog`, so group-scoped routes
    reached through it failed open. One implementation now;
  - `POST /api/v1/public/signup` never verified reCAPTCHA (its sibling `/auth/register`
    did), so it handed out channel-list codes and JWTs to bots;
  - the 50 MB M3U body parser ran before authentication;
  - `GET /app/demo-code` had no error handling (hung client + `unhandledRejection`);
  - `POST /me/notifications/:id/read` accepted any notification id;
  - the failover watchdog, stream probe and auto-match helper fetched operator-configured
    upstream URLs with no SSRF guard;
  - `utils/initSuperAdmin.ts` logged a live channel-list code;
  - `utils/crypto.ts` / `routes/jwt.js` gated their dev-fallback secrets on
    `NODE_ENV === 'production'` only;
  - OAuth CSRF state lived in a process-global `Map`, so an in-flight Google/GitHub
    sign-in failed with "Invalid or missing state parameter" whenever the API container
    was replaced (i.e. on every deploy) and could not work with more than one replica;
  - `POST /payments/cinetpay/checkout` had no limiter, and the public logo relay had no
    dedicated budget.
- **Fixed (PR #313, app + web)**: Android onboarding never advanced after a BYO playlist
  import (`"Playlist loaded"` vs `"تم تحميل قائمة التشغيل"`), unencoded channel ids in the
  player/multiview routes (Navigation crash), an uncaught Room foreign-key violation in
  `PlayerViewModel`, an unattended health-scanner scope without a
  `CoroutineExceptionHandler`, a Multiview `PlayerView` bound to a released player, and
  `SecurePreferences` construction throwing/caching per call. Web: `/buy?shop=` never
  reached `ShopPlans` (Next 15+ `searchParams` is a Promise), `/watch` had stale-response
  races, `/buy/success` could poll forever, the mini-player drag origin was a stale
  closure, and `?admin_email=` was reflected unvalidated.
- **`AppVersion` 1.2.2 (versionCode 10202, no `sha256`) was deactivated.** Its
  `downloadUrl` points at `/api/v1/app/download`, which redirects to the *latest* release,
  so backfilling a checksum for it would have advertised a hash that never matches the
  bytes a client downloads. `/api/v1/app/version` now resolves 1.3.2 from the GitHub
  release manifest with a verified `sha256` (`checksumSource: manifest`).
- **Ops spot-check**: fail2ban `sshd` + `dzhoof-http` active (1 currently banned),
  0 failed systemd units, disk 76% used.
- **Android fixes shipped and verified (v1.3.3, 2026-09-17).** The tag was pushed
  (`git push origin refs/tags/v1.3.3`), the release workflow produced a signed APK, and the
  artifacts were verified on the build host rather than trusted from a green run:
  the `.sha256` asset matches the APK bytes recomputed locally, `apksigner verify` passes
  with the production certificate (`5938049a…`, the same one v1.3.2 was signed with),
  `aapt dump badging` reports `com.dzhoof.iptv` / `1.3.3` / `10303`, the release manifest's
  `commit` is the merge with the fixes, and
  `GET /api/v1/app/version?currentVersion=10302` returns `updateAvailable: true` with a
  `manifest`-sourced checksum and no `updateBlockedReason`. The pass itself was driven by the
  app's own telemetry: the `crashreports` collection (7 reports, two classes) and
  `playbackevents` (816 events — the largest error bucket had already stopped on 2026-08-26,
  so it was left alone; start-up failure rate fell from 30% in August to 4.8% in September).
- **Still open, needs a human**: email alerts are unconfigured
  (`/health?details=true` → `notifications.email: missing_credentials`; Telegram is
  `ok`, so alerts are deliverable); the reseller portal requires a fresh login after every
  page reload because the reseller JWT is deliberately kept out of browser storage (F11) —
  that is a product/security trade-off, not a bug to fix silently; `UPSTREAM_PROXY_HOSTS` is
  now deployment configuration instead of a provider default in the code, so the operator
  must keep it set in `.env.production` (it is, explicitly, since 2026-09-17); real-device /
  Android-TV validation remains environmental; and several customer-facing pages under
  `(dashboard)` and `buy/` are still written in English while the localization system and
  `AGENTS.md` both ask for Arabic-first user-visible text — a translation pass, not a fix to
  slip in beside a bug fix.

## Re-verified 2026-09-15

Measured on the VPS and against the live API, not copied forward:

- **Deployed commit**: `94a4f374` (staged 2026-09-14T16:55:56Z) while `origin/main` was
  `460b8cc`. Neither had a green `DZ HOOF CI`: the deployed commit's run was *cancelled*
  and `main`'s failed on the `android` job (the SDK `tools` package removal). CI is now
  a deploy gate: `scripts/deploy/verify-commit-provenance.sh`.
- **Off-site backups ARE configured** (this file said "prepared but not yet configured"):
  restic to `rclone:dzhoof-google:…` with 20 snapshots, newest 2026-09-15T03:38Z, weekly
  `--check` passing; local restic repo 25 GB (11 snapshots); daily `mongodump` 03:15 UTC.
- **Monitored surface**: fail2ban (`sshd` + `dzhoof-http`), disk 65% used (28 GB free),
  api/frontend/mongo/redis healthy with 0 restarts, MongoDB and Redis not reachable from
  outside, only 22/80/443/51820 exposed.
- **Open defects found** (all fixed on the branch, none deployed yet):
  `GET /api/v1/app/version` served `sha256: null`; app HTML served with
  `s-maxage=31536000`; alert email broken (`Missing credentials for "PLAIN"`) while
  `/health` claimed alerting was configured; the daily report job logged success with zero
  emails delivered.
- **`dzhoof-test-fail.service`** is a leftover *transient* failed unit from a 2026-09-13
  `OnFailure` alert test; cleanup script: `scripts/ops/clear-transient-failed-units.sh`.

## Production deployment (verified 2026-08-21)

- **Live at**: `https://iptv.ld-11.net` (HTTPS, Let's Encrypt, valid until 2026-11-16).
- **Stack**: `dzhoof-api`, `dzhoof-scheduler`, `dzhoof-frontend`, `dzhoof-mongodb`, `dzhoof-redis`, `dzhoof-caddy` — all healthy on the VPS (`5.135.79.221`).
- **Health**: `/health` → `{"status":"ok","version":"1.0.1"}`; scheduler syncs IPTV-org catalog (14k+ channels).
- **Deploy model**: pinned-commit staged releases (`/opt/dzhoot-releases/<sha>`) with atomic swap and automatic rollback; see `server/scripts/deploy/atomic-deploy.sh`. There is no `.github/workflows/deploy.yml` (this line used to imply one) — deploys are run on the host by an operator after CI is green, and `atomic-deploy.sh` now refuses a commit whose required workflows are not green.
- **Secrets**: `/etc/dzhoot/.env.production` (mode 600) on the server only; nothing secret is committed.
- **Backups**: daily `mongodump` (03:15 UTC) + local encrypted restic (retention 7d/4w/6m). Off-site backup is prepared but not yet configured (requires storage-provider credentials).
- **Firewall**: only 22/80/443 exposed publicly; MongoDB/Redis are internal.

## Origin

DZ HOOF is based on the MIT-licensed FireVision IPTV Server, renamed and hardened. It accepts only streams the operator is authorized to use; it does not provide pirated channel sources.

## Validation status (CI on main, 2026-08-21)

- Backend: TypeScript typecheck, ESLint, build, `npm audit` (0 high+), backend tests (177 tests across 24 suites), and an E2E subscription smoke all pass.
- Android: lint, unit tests, and a distributable debug APK (pointing at `https://iptv.ld-11.net/`) pass on GitHub Actions.
- Production deploy dry-run passes on the VPS; a full atomic deploy was executed successfully on 2026-08-21.

## Remaining work

- Real-device Android TV / Fire TV validation (emulator + device). The Android task set is
  now verified on a runner (`compileOfficialReleaseKotlin` + `testStagingDebugUnitTest` +
  `lint`: 74 XML files / 591 tests / 0 failures) but not on hardware.
- A signed release APK end-to-end run of the release workflow (it carries the same
  `sdkmanager` fix as CI and has not been exercised since).
- Full VOD/Series acceptance on a live source; cross-device watch-progress sync.
- `AppVersion 1.2.2` is active without a `sha256`: backfill its checksum or deactivate it
  (the update API withholds it now instead of serving it unverifiable).
- IPv6 crash-report redaction is now covered (compressed `::`, full eight-group and
  bracketed forms) on both the device and the server, with a shared test table in
  `CrashRedactorTest` and `audit-log.test.ts`. Closed 2026-09-15 together with four other
  redaction classes that had passed through: JSON-encoded secrets, the credential half of
  an `Authorization:` header, cookie/session assignments outside a header line, and
  credentials in a non-HTTP (`rtsp`/`rtmp`) stream URL.
