#!/usr/bin/env bash
# DZ HOOF — Offsite backup via restic (B2/S3-compatible).
#
# Protects against total server loss: MongoDB dump + production secrets
# (docker-compose, .env.production, Caddyfile) pushed to an encrypted
# restic repo. Retention: 7 daily / 4 weekly / 3 monthly.
#
# ⚠️ ACTIVATION REQUIRES USER CREDENTIALS (restic repo + S3/B2 keys) —
#    until then the script is inert and just prints what it would do.
#
# Install as a cron job (runs daily at 03:30 server time):
#   sudo bash scripts/backup/restic-backup.sh --install
#
# Manual run:
#   sudo bash scripts/backup/restic-backup.sh
#
# Restore procedure (documented at the bottom of this file).
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/dzhoot/offsite}"
RESTIC_REPO="${RESTIC_REPO:-}"            # e.g. s3:s3.eu-central-003.backblazeb2.com/dzhoof-backup
RESTIC_PASSWORD="${RESTIC_PASSWORD:-}"    # repo encryption password (keep safe!)
RESTIC_S3_KEY="${RESTIC_S3_KEY:-}"
RESTIC_S3_SECRET="${RESTIC_S3_SECRET:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"    # optional healthchecks.io ping URL
COMPOSE_DIR="${COMPOSE_DIR:-/opt/dzhoot/server}"
SECRETS_DIR="${SECRETS_DIR:-/etc/dzhoot}"

say() { printf '[backup] %s\n' "$*"; }

# ---- inert until credentials are provided --------------------------------
if [ -z "$RESTIC_REPO" ] || [ -z "$RESTIC_PASSWORD" ]; then
  say "RESTIC_REPO / RESTIC_PASSWORD not set — skipping (offsite backup pending user keys)."
  say "Add keys to /etc/dzhoot/.env.production: RESTIC_REPO, RESTIC_PASSWORD, RESTIC_S3_KEY, RESTIC_S3_SECRET."
  exit 0
fi

export RESTIC_PASSWORD AWS_ACCESS_KEY_ID="$RESTIC_S3_KEY" AWS_SECRET_ACCESS_KEY="$RESTIC_S3_SECRET"

if [ "${1:-}" = "--install" ]; then
  CRON='30 3 * * * root /bin/bash /opt/dzhoot/server/scripts/backup/restic-backup.sh >> /var/log/dzhoof-restic.log 2>&1'
  if [ -f /etc/cron.d/dzhoof-restic ]; then
    say "cron already installed."
  else
    echo "$CRON" > /etc/cron.d/dzhoof-restic
    chmod 600 /etc/cron.d/dzhoof-restic
    say "cron installed: daily 03:30 → /var/log/dzhoof-restic.log"
  fi
  exit 0
fi

fail() { say "FAILED: $*"; curl -fsS -m 10 "${HEALTHCHECK_URL}/fail" >/dev/null 2>&1 || true; exit 1; }

# 1) MongoDB dump
say "mongodump → $BACKUP_DIR/db"
mkdir -p "$BACKUP_DIR"
docker exec dzhoof-mongodb mongodump --db dzhoof-iptv --archive="$BACKUP_DIR/db.gz" --gzip || fail "mongodump"

# 2) Secrets + compose
mkdir -p "$BACKUP_DIR/secrets"
cp -a "$SECRETS_DIR"/.env.production "$BACKUP_DIR/secrets/" 2>/dev/null || true
cp -a "$SECRETS_DIR"/github.token "$BACKUP_DIR/secrets/" 2>/dev/null || true
cp -a "$COMPOSE_DIR"/docker-compose.production.yml "$BACKUP_DIR/secrets/" 2>/dev/null || true
cp -a "$COMPOSE_DIR"/Caddyfile "$BACKUP_DIR/secrets/" 2>/dev/null || true

# 3) restic backup + retention
restic -r "$RESTIC_REPO" backup "$BACKUP_DIR/db.gz" "$BACKUP_DIR/secrets" --tag dzhoof-daily || fail "restic backup"
restic -r "$RESTIC_REPO" forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 3 || fail "restic forget"

# 4) verify snapshot list
SNAP=$(restic -r "$RESTIC_REPO" snapshots --latest 1 --json 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'][:12])" 2>/dev/null || echo "?")
say "latest snapshot: $SNAP"

# 5) ping (optional monitoring)
if [ -n "$HEALTHCHECK_URL" ]; then
  curl -fsS -m 10 "$HEALTHCHECK_URL" >/dev/null 2>&1 && say "healthcheck ping OK" || say "healthcheck ping failed"
fi

say "done."
exit 0

# ═══════════════════════ RESTORE PROCEDURE ═══════════════════════
# On a NEW server (or after data loss):
#
#  1. Install restic:  apt install restic
#  2. export RESTIC_PASSWORD=<repo password> AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
#  3. restic -r <REPO> snapshots            # pick a snapshot id
#  4. restic -r <REPO> restore latest --target /tmp/restore
#  5. Restore MongoDB:
#       docker exec -i dzhoof-mongodb mongorestore --archive=/tmp/restore/<...>/db.gz --gzip
#     (first start a fresh mongodb container with the same volume)
#  6. Restore secrets: cp /tmp/restore/<...>/secrets/.env.production /etc/dzhoot/
#     (chmod 600) — then docker compose up -d with the compose file from the backup
#  7. Verify: curl https://<domain>/health/ready
#
# Test the restore at least once a month (write the date in /var/log/dzhoof-restore-tests.log).
