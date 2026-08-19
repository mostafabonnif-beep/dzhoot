# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Send a private
report instead:

- **GitHub:** use the repository's private vulnerability reporting
  (Security → Report a vulnerability) if enabled.
- **Email:** report to the maintainer's contact listed in the GitHub profile.

Include:

- The affected component (`server/` backend, `server/frontend/` dashboard,
  `android/` app) and endpoint/version where relevant.
- A minimal reproduction (steps, payload, observed vs expected behavior).
- Impact assessment if you have one.

We aim to acknowledge reports within 5 working days and to ship a fix as a
patch release.

## Security principles this project follows

- **No secrets in the repository.** `.env`, `local.properties`, keystores,
  `google-services.json`, OAuth secrets and Sentry tokens must never be
  committed. Production secrets come from environment variables / the
  deployment secret store.
- **Server-side credential custody.** Xtream/M3U credentials are encrypted
  server-side; the client never receives an upstream URL with credentials —
  only short-lived encrypted playback tokens.
- **SSRF protections.** All external URLs (playlists, EPG, Xtream panels,
  stream probes) are validated with DNS pinning and private-IP blocking.
- **Playback tokens** are AES-256-GCM encrypted, short-lived (default 5 min)
  and scoped to a single user + channel list code.
- **Production startup refuses weak defaults** (placeholder secrets shorter
  than 32 chars, default admin passwords).

## Deployment hardening checklist

- Run `NODE_ENV=production` with strong secrets (>32 chars) — the server
  refuses to start otherwise.
- Put the API behind Cloudflare (or an equivalent WAF) and set
  `TRUST_CF_CONNECTING_IP=true` only then.
- Restrict MongoDB and Redis to the private network; enable auth on Redis.
- Schedule `server/scripts/backup.sh` and test `restore-drill.sh` regularly
  (see `server/docs/BACKUP_RESTORE.md`).
- Subscribe the operator's alert webhook (`ALERT_WEBHOOK_URL`) to sync/backup
  failures (see `server/docs/OBSERVABILITY.md`).
- Do not enable `ALLOW_LEGACY_RAW_PROXY` / `ALLOW_LEGACY_RAW_PLAYLIST` in
  production.

## Supported versions

Only the `main` branch (latest release) receives security fixes.
