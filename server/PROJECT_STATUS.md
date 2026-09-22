# DZ HOOF — Server Project Status

_Last verified: 2026-09-22 (production VPS + CI). The newest sections are below; the older ones are
kept for their measured history._

## Re-verified 2026-09-22 (deploy pipeline: the two documented gaps are now closed in code)

**What happened:** a routine `atomic-deploy.sh <sha> APPLY=1` aborted at step 4/7 with
`Conflict. The container name "/dzhoof-api" is already in use`, and the automatic rollback hit the
same conflict. Production never changed (containers were never replaced; the site stayed 200), but for
a few minutes the outcome was unknown.

**Root cause 1 — compose project name (documented, never fixed in code).** The running stack is
labelled project `dzhoot`, but `docker compose` run from `/opt/dzhoot/server` derives the project from
the directory → `server`. With the hard-coded `container_name: dzhoof-*`, the "wrong" project makes
compose try to **create** new containers instead of recreating the existing ones → fixed-name
collision. `server/PROJECT_STATUS.md` had already written on 2026-09-20: *"The deploy failures of
2026-09-19 were caused by a missing `COMPOSE_PROJECT_NAME=dzhoot`"* — but the fix lived only in that
sentence, not in any script, env file or compose file. So it recurred, twice.

**Root cause 2 — no deploy lock.** `atomic-deploy.sh` had no mutual exclusion. A second operator/agent
can stage and deploy mid-flight; two concurrent runs can interleave the `/opt/dzhoot` swap and corrupt
the active release. On 2026-09-21 two runs did exactly that.

**Fix shipped (all verified against the live host):**

| Fix | Effect |
|---|---|
| `docker-compose.production.yml` declares `name: dzhoot` | project name can no longer depend on the CWD; `docker compose` from anywhere adopts the existing stack. Verified: dry-run from a neutral dir shows `Container dzhoof-api Running`, not `Creating`. |
| `deploy-production.sh` and `atomic-deploy.sh` export `COMPOSE_PROJECT_NAME=dzhoot` | covers every compose call in the deploy path, including the rollback `compose up` — and the `/etc/dzhoot` override file, which replaces the repo compose in production and has no `name:` of its own. |
| `atomic-deploy.sh` takes an exclusive `flock` on `/run/lock/dzhoof-deploy.lock`; `deploy-production.sh` takes it only when run standalone | two deploys can no longer interleave; the second runner is **refused** immediately (clean rejection, no misleading FAILED row, no rollback noise). Verified: holder 2 → `REFUSED` while holder 1 still holds. |

**Left as an operator decision (deliberately):** the stray `server_dzhoof-network` (empty, left by a
past project-mismatched deploy) and the 58 accumulated `.env.production.bak-*` files in `/etc/dzhoot`.
Removing them is housekeeping, not a code change.

## Re-verified 2026-09-21 (admin panel reported a release outage that did not exist)

**What the panel said:** `GET /api/v1/admin/diagnostics` returned `overall: fail` with
`release_published: fail` — «لا يوجد أي إصدار مُفعَّل — كل الأجهزة ستحصل على «لا يوجد تحديث»» — and every
`release.*` field `null`.

**What was actually true:** the update path was healthy. `GET /api/v1/app/version?currentVersion=10001`
answered `updateAvailable: true` for **1.3.10 (10310)** with a verified `sha256`
(`checksumSource: manifest`) served straight from GitHub Releases.

**Root cause — two truths, one of them stale.** `resolvePublishedRelease()` (in
`routes/app-update.js`, documented in-file as *the single source of truth for "what is published, and
may it be advertised?"*) builds its candidates from **both** the active `AppVersion` row **and** the
latest GitHub release, then advertises the highest `versionCode`. The diagnostics probe never called
it: it read `AppVersion.findOne({ isActive: true })` directly. Production's table holds 26 rows, every
one `isActive: false`, newest `1.2.2` — the pipeline publishes through GitHub tags and stopped writing
rows after 1.2.2. So the panel reported a total release outage for a fleet that was updating fine.

This is the failure mode the in-file comment on `resolvePublishedRelease` was written to prevent: the
two paths drifted apart, and the drift was invisible because nothing asserted they agreed.

**Fix shipped:**

| Fix | Root |
|---|---|
| `admin-diagnostics.js` resolves through `resolvePublishedRelease(req)` (now exported via `_private`) instead of reading the table | the probe re-derived "what is published" and re-derived it differently |
| a resolution failure is caught and reported as the `fail` it is, never a 500 | diagnostics is a health probe: a provider outage with no database fallback is the finding, not a crash |
| `fetchLatestRelease()` gets an 8s axios timeout | the call had none, so a stalled `api.github.com` connection could hang `/version` — and, newly, the diagnostics probe — until the client gave up |
| `release_published` now names its source (`GitHub Releases` / `سجل قاعدة البيانات`) | an operator could not tell which of the two sources answered |

**Measured:** 4 regression tests added (GitHub-only source passes; provider outage with no active row
fails; an unreadable `.sha256` fails the artifact check; the newer of the two sources wins).
Backend suite 1052 tests / 121 suites green, `typecheck`, `lint` (0 errors) and `build:backend` green.

**Not changed here (deliberately):** the 26 stale rows, 19 of which carry `sha256: null`. They are not
what devices read, and rewriting release history is an operator decision, not a diagnostics fix.

## Re-verified 2026-09-21 (primary provider incident — the conclusion was wrong)

**What the platform believed:** the primary provider's account had expired on 2026-09-15, ~52% of
the catalog (16,707 of 31,868 channels) was dead, and the backup source failed to sync (HTTP 503).
That belief had been carried for five days and had reached the audit and the handover notes.

**What was actually true**, once the provider was probed with the project's own client
(`testXtreamConnection` / `diagnoseXtreamSource`) instead of inferred from internal symptoms:

- The account is **Active** (valid to ~2026-10-01) and its panel serves live: sampled streams
  answer `200 video/mp2t` in ~160ms, and the upstream catalog is 16,571 channels / 67,558 movies
  / 17,175 series.
- The 16,706 "dead" channels were the provider's own channels left **orphaned** when the source
  row was replaced during a re-registration. Their primary URLs still carried the retired
  account's credentials (so they were genuinely unplayable), while the live stream sat attached
  to them as an **enabled failover backup**. The visibility gate treats "source missing" as
  unverified, so all of them were hidden: a healthy provider with an invisible catalog.
- The catalog the customer could open was ~2,821 channels instead of ~16,500.

**Root fixes shipped** (each with tests, CI green, deployed):

| Fix | Root |
|---|---|
| `mergeCatalog` sync adopts a matched channel whose source is gone (same `_id`, identities, EPG, order; only ownership moves) | a re-registration used to hide the whole catalog behind failover maps |
| Sync snapshots chunked into `SyncSnapshotChunk` (2,000 channels/doc) | one document per snapshot hit MongoDB's 16MB cap, so every sync of a large source failed before writing |
| Playback resolves a retired `channelId` by stream id (playable copy wins) | re-registration renumbers channel ids, and cached clients sent the old ones → 404 on every tap |
| One shared visibility gate (`utils/verified-channel-query.js`) used by list, search, catalog search, categories, discover rails, home and the user playlist | four endpoints re-implemented the filters by hand and dropped the health clauses |
| Daily expiry scan marks past-expiry subscriptions `EXPIRED` before scanning renewals | rows stayed `ACTIVE` after expiry: the panel claimed 17 active while 9 could play |
| Daily report carries catalog health (active/visible/dead/orphaned) and delivery reach (devices / push-capable / expiring) | the report showed healthy activations while the catalog was half invisible |

**Measured after**: dead 16,707 → **1** · orphaned 16,714 → **0** · active channels 16,238 →
**16,579** · customer playlist 2,821 → **16,190** · sync **succeeds in 137s** · playback verified
end-to-end (18.8MB MPEG-TS through the relay) · subscriptions 17 (8 expired) → **9 valid**.

**Still owner-side**: renew/replace nothing on the provider (it is fine); the open items are
payment keys, secrets rotation, FCM (APKs built without Firebase ⇒ 19 devices, 0 push tokens),
the support channel URL, and the Play distribution decision.

**Lesson for the next reader:** do not conclude "the provider is down" from internal counters.
Probe the panel with the project's own client first — the internal symptom (dead channels,
failing sync, hidden catalog) had three different causes, and none of them was the provider.

## Re-verified 2026-09-20 (operations hardening pass)

Measured on the production host, 2026-09-20. Production was **39 commits behind `main`**
when this pass started; it now runs the tip of `main` (`c9464985`), and the controls that
were supposed to catch the next failure were repaired — **three of them were "running"
while unable to tell anyone anything**.

### Shipped

- **Deployed** `9281006` → `c9464985` in three atomic deploys (each with a verified
  mongodump, `smoke 15/15`/`17/17`, and a rollback point under `/opt/dzhoot.previous-*`).
  The deploy failures of 2026-09-19 were caused by a missing `COMPOSE_PROJECT_NAME=dzhoot`
  (compose ran from `/opt/dzhoot/server`, i.e. a different project, and collided on the
  explicit `container_name`s) — recorded in `docs/ops` history and in the deploy notes.
- **Customer problem reports** (PR #305): in-app "report a problem", the public ingest
  endpoint `POST /api/v1/app/report-problem`, and the admin triage view over customer
  reports plus automatically captured crashes. Unauthenticated by design (the report that
  matters most comes from a device that cannot sign in), with a closed diagnostic shape,
  field-level redaction on ingest, its own rate limiter, and `requireAuth`+`requireAdmin`
  on the admin routes. **Verified live**: empty body → `400 REPORT_CONTENT_REQUIRED`;
  a real report → `201` with a quotable `DZR-…` id.
- **Arabic customer surface** (PR #318) and the **hardening pass** (PR #317: repo cleanup,
  no raw `err.message` in API responses, AdMob test-ID fallback, disk-usage alert) are
  deployed.

### Controls repaired (each verified on the host)

| Control | What it was doing | Now |
|---|---|---|
| Monthly **restore drill** | Failing every month **silently**: authenticated as `dzhoof-admin` (a user that does not exist; the instance has one user, `dzhoof`), swallowed the `Authentication failed` line inside a `grep`, and alerted through an empty webhook | Reads `MONGODB_URI` (the credential the backups are taken with), prints the real error, alerts on success **and** failure: `1,519,308 documents across 45 collections` |
| Nightly **off-site backup** | Marked `FAILED` every night *after* writing its snapshot: `ProtectHome=true` made restic's cache read-only (so every run re-fetched all metadata over rclone → Drive rate limits), and a held lock aborted `forget --prune` | `CacheDirectory=dzhoof-restic` + `--retry-lock 15m`: `Off-site backup completed successfully`, 0 failed units |
| **systemd failure notifier** | Ran, reported "Deactivated successfully", and told nobody — it read `ALERT_WEBHOOK_URL` (empty) into a variable named `UNIT` and never learned which unit failed | `dzhoof-failure-notify` takes the unit name, alerts through `dzhoof-alert.sh` (the path proven to deliver), logs every failure to `/var/log/dzhoof-failures.log` |
| **Disk-usage alert** | Died with `exit 127` before measuring anything (`source /etc/dzhoot/.env.production` executed an unquoted value) | Reads only the two variables it needs; installed with a 30-minute cron and exercised |
| **Daily operations report** | Lost every day: the email channel has no credentials, and the report had no other channel | Falls back to the alert channels (Telegram) when email reaches nobody; `channel` is recorded in the task history |
| **Automatic security updates** | Disabled at the APT level (`APT::Periodic::* = "0"`) while the service still reported `active` — 205 security updates pending, log frozen since 2024-04-26 | Restored and applied (363 → 0 pending); verified |
| **`grub-pc`** | Left half-configured by the upgrade: its `install_devices` pointed at `/dev/vda`, which does not exist on this host (`/dev/sda`) | Pointed at the real disk, MBR backed up to `/var/backups/dzhoot/mbr-*.bin`, `dpkg --audit` clean, boot entry for `6.8.0-139` present |

### Open, with the owner

- **Email credentials**: `BREVO_USER`/`BREVO_PASSWORD` are empty, so password reset and
  subscription-expiry mail to customers cannot be delivered. Set them in
  `/admin/settings` or `/etc/dzhoot/.env.production`. The daily report already survives
  this (Telegram fallback).
- **CodeQL exclusion not wired**: `js/missing-token-validation` is a documented false
  positive (the server uses `middleware/csrfProtection`, which the query cannot see).
  `.github/codeql/codeql-config.yml` records the exclusion, but the analysis is never told
  to read it — `codeql.yml` has no `config-file:` input. Wiring it (or dismissing the
  alert in the Security tab) needs a permission this agent does not hold.
- **Kernel reboot**: `6.8.0-139` and `libc6` are installed and the host still runs
  `6.8.0-31`; a one-shot timer (`dzhoof-planned-reboot.timer`) reboots at 02:00 UTC on
  2026-09-21 with a verification pass 20 minutes later.
- **Secrets to rotate**: root passwords exposed in a chat transcript, the historical
  `dzhoof-admin-key` in the repository history, and the admin password written in
  `reports/HANDOVER_REPORT_2026-08-25_FINAL_AR.md`.
- **Android dependency majors** (media3, navigation, firebase-bom, gradle-wrapper) need a
  real-device pass; CI cannot cover them. `codeql-action` (#280 + #283) must be merged
  **together** — each alone leaves `init` and `analyze` on different versions.


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
- **Stack**: `dzhoof-api`, `dzhoof-scheduler`, `dzhoof-frontend`, `dzhoof-mongodb`, `dzhoof-redis`, `dzhoof-caddy` — all healthy on the VPS (`5.196.51.152`).
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
