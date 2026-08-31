# DZ HOOF — Server Project Status

_Last verified: 2026-08-21 (production VPS + CI)_

## Production deployment (verified 2026-08-21)

- **Live at**: `https://iptv.ld-11.net` (HTTPS, Let's Encrypt, valid until 2026-11-16).
- **Stack**: `dzhoof-api`, `dzhoof-scheduler`, `dzhoof-frontend`, `dzhoof-mongodb`, `dzhoof-redis`, `dzhoof-caddy` — all healthy on the VPS (`5.135.79.221`).
- **Health**: `/health` → `{"status":"ok","version":"1.0.1"}`; scheduler syncs IPTV-org catalog (14k+ channels).
- **Deploy model**: pinned-commit staged releases (`/opt/dzhoot-releases/<sha>`) with atomic swap and automatic rollback; see `scripts/deploy/atomic-deploy.sh` and `.github/workflows/deploy.yml`.
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

- Real-device Android TV / Fire TV validation (emulator + device).
- Signed release APK pipeline end-to-end.
- Off-site restic backup (needs provider credentials).
- Full VOD/Series acceptance on a live source; cross-device watch-progress sync.
