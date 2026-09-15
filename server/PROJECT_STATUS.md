# DZ HOOF — Server Project Status

_Last verified: 2026-09-15 (production VPS + CI). See "Re-verified 2026-09-15" below:
two claims in this file were out of date, and several defects were found and fixed on a
branch (`fix/production-integrity-and-diagnostics`, PR #289)._

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
- IPv6 is not covered by the crash-report redaction rules
  (see `docs/DIAGNOSTICS_AND_CRASH_REPORTS.md`).
