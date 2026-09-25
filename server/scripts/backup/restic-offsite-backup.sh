#!/usr/bin/env bash
# DZ HOOF — encrypted off-site recovery backup.
#
# Reads a root-owned environment file that is never committed. The repository
# supports any restic backend, including SFTP and S3-compatible storage.
# It is intentionally inactive until a real off-site repository and password
# file have been configured by an authorized operator.
set -euo pipefail

CONFIG_FILE="${CONFIG_FILE:-/etc/dzhoot/restic-offsite.env}"
WORK_ROOT="${WORK_ROOT:-/var/backups/dzhoot/offsite-staging}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/dzhoot/server}"
MONGO_CONTAINER="${MONGO_CONTAINER:-dzhoof-mongodb}"
DATABASE_NAME="${DATABASE_NAME:-dzhoof-iptv}"
# Root-only production env file that holds MONGODB_URI for authenticated dumps.
MONGO_PROD_ENV="${MONGO_PROD_ENV:-/etc/dzhoot/.env.production}"
MODE="${1:---backup}"

say() { printf '[offsite-backup] %s\n' "$*"; }
die() { printf '[offsite-backup][ERROR] %s\n' "$*" >&2; exit 1; }

# Bounded retry for commands that talk to the off-site repository.
#
# Why this exists (measured 2026-09-25): the rclone backend starts a helper process per
# restic invocation, and that helper intermittently fails to answer restic's HTTP client
# in time, aborting the run with
#   Fatal: unable to open repository at rclone:...: error talking HTTP to rclone:
#   context deadline exceeded (Client.Timeout exceeded while awaiting headers)
# 5 of the previous 11 nightly runs failed that way. The failures were always the FIRST
# repository call and always ~90 s in, while successful runs took 6-7 minutes — i.e. the
# helper's cold start, never a mid-transfer error. A retry spawns a fresh helper, which
# is what changes the outcome; per-attempt success was ~55%, so three attempts put the
# nightly job above 90%.
#
# Knobs (defaults chosen for the numbers above; override in $CONFIG_FILE):
#   OFFSITE_REPO_ATTEMPTS        attempts per repository command (default 3)
#   OFFSITE_REPO_DELAY_SECONDS   pause between attempts (default 20)
with_repo_retry() {
  local label="$1"; shift
  local attempts="${OFFSITE_REPO_ATTEMPTS:-3}"
  local delay="${OFFSITE_REPO_DELAY_SECONDS:-20}"
  local attempt=1
  while :; do
    if "$@"; then
      return 0
    fi
    if [ "$attempt" -ge "$attempts" ]; then
      return 1
    fi
    say "$label failed (attempt $attempt/$attempts) — retrying in ${delay}s"
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

case "$MODE" in
  --backup|--check|--dry-run|--init) ;;
  *) die "Usage: $0 [--backup|--check|--dry-run|--init]" ;;
esac

[ "$(id -u)" -eq 0 ] || die 'Run as root so backup material stays restricted.'
[ -f "$CONFIG_FILE" ] || die "Configuration file not found: $CONFIG_FILE"
[ "$(stat -c '%a' "$CONFIG_FILE")" = '600' ] || die "Configuration must be chmod 600: $CONFIG_FILE"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

: "${OFFSITE_RESTIC_REPOSITORY:?OFFSITE_RESTIC_REPOSITORY is required}"
: "${OFFSITE_RESTIC_PASSWORD_FILE:?OFFSITE_RESTIC_PASSWORD_FILE is required}"
[ -f "$OFFSITE_RESTIC_PASSWORD_FILE" ] || die 'Restic password file is missing.'
[ "$(stat -c '%a' "$OFFSITE_RESTIC_PASSWORD_FILE")" = '600' ] || die 'Restic password file must be chmod 600.'
if [ -n "${OFFSITE_RCLONE_CONFIG:-}" ]; then
  [ -f "$OFFSITE_RCLONE_CONFIG" ] || die 'Rclone configuration file is missing.'
  [ "$(stat -c '%a' "$OFFSITE_RCLONE_CONFIG")" = '600' ] || die 'Rclone configuration file must be chmod 600.'
fi
command -v restic >/dev/null 2>&1 || die 'restic is not installed.'
command -v docker >/dev/null 2>&1 || die 'docker is not installed.'

# A lock held by another process (or another host sharing the repository) used to fail
# the whole job right after a successful backup, and systemd marked the unit failed even
# though the snapshot had been saved. Wait for the lock instead.
RETRY_LOCK="${OFFSITE_RESTIC_RETRY_LOCK:-15m}"

# Cache: the systemd unit runs with ProtectHome=true, so the default ~/.cache/restic is
# read-only there ("unable to open cache: mkdir /root/.cache: read-only file system").
if [ -z "${RESTIC_CACHE_DIR:-}" ] && [ -d /var/cache/dzhoof-restic ]; then
  export RESTIC_CACHE_DIR=/var/cache/dzhoof-restic
fi

export RESTIC_REPOSITORY="$OFFSITE_RESTIC_REPOSITORY"
export RESTIC_PASSWORD_FILE="$OFFSITE_RESTIC_PASSWORD_FILE"
[ -n "${OFFSITE_RCLONE_CONFIG:-}" ] && export RCLONE_CONFIG="$OFFSITE_RCLONE_CONFIG"
# S3-compatible backends use these only when they are present in the protected
# config. SFTP repositories need none of them.
[ -n "${OFFSITE_AWS_ACCESS_KEY_ID:-}" ] && export AWS_ACCESS_KEY_ID="$OFFSITE_AWS_ACCESS_KEY_ID"
[ -n "${OFFSITE_AWS_SECRET_ACCESS_KEY:-}" ] && export AWS_SECRET_ACCESS_KEY="$OFFSITE_AWS_SECRET_ACCESS_KEY"
[ -n "${OFFSITE_AWS_DEFAULT_REGION:-}" ] && export AWS_DEFAULT_REGION="$OFFSITE_AWS_DEFAULT_REGION"

if [ "$MODE" = '--dry-run' ]; then
  say 'Configuration and permissions are valid. No backup, network request, or database operation was performed.'
  exit 0
fi

if [ "$MODE" = '--backup' ]; then
  # Open the repository BEFORE doing any work. Two reasons: a genuinely unreachable
  # repository now fails in seconds instead of after a full mongodump, and the retry
  # below gives the rclone helper a second chance at the step that actually fails
  # (see with_repo_retry). Read-only — no data is written.
  say 'Opening the off-site repository.'
  with_repo_retry 'repository open' \
    restic snapshots --latest 1 --retry-lock "$RETRY_LOCK" >/dev/null \
    || die "Off-site repository is unreachable after ${OFFSITE_REPO_ATTEMPTS:-3} attempts."
fi

if [ "$MODE" = '--init' ]; then
  say 'Initializing the encrypted off-site repository.'
  restic init
  say 'Repository initialization completed successfully.'
  exit 0
fi

if [ "$MODE" = '--check' ]; then
  say 'Checking the encrypted off-site repository using a small random data subset.'
  restic check --read-data-subset=1/20 --retry-lock "$RETRY_LOCK"
  say 'Repository check completed successfully.'
  exit 0
fi

sudo docker inspect -f '{{.State.Health.Status}}' "$MONGO_CONTAINER" 2>/dev/null | grep -qx healthy || \
  die "MongoDB container is not healthy: $MONGO_CONTAINER"

umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGING="$WORK_ROOT/$STAMP"
cleanup() { rm -rf -- "$STAGING"; }
trap cleanup EXIT
install -d -m 700 "$STAGING/recovery"

say 'Creating a MongoDB recovery archive.'
# MongoDB requires auth since the Aug 2026 hardening. Credentials are read from
# the root-only production env file (never embedded in this script); the dump
# runs INSIDE the mongo container, so the URI host is rewritten to loopback.
if [ -z "${MONGO_DUMP_URI:-}" ] && [ -n "${MONGO_PROD_ENV:-}" ] && [ -f "$MONGO_PROD_ENV" ]; then
  MONGO_DUMP_URI="$(grep -E '^MONGODB_URI=' "$MONGO_PROD_ENV" | head -1 | cut -d= -f2- | tr -d "\"'" 2>/dev/null || true)"
fi
: "${MONGO_DUMP_URI:?MONGODB_URI is missing — set MONGO_DUMP_URI or MONGODB_URI in $MONGO_PROD_ENV}"
MONGO_DUMP_URI="$(printf '%s' "$MONGO_DUMP_URI" | sed -E 's#^(mongodb(\+srv)?://[^@]*@)[^/]+#\1127.0.0.1#')"
docker exec "$MONGO_CONTAINER" mongodump --uri "$MONGO_DUMP_URI" --gzip --archive=/tmp/dzhoof-offsite-backup.archive.gz
docker cp "$MONGO_CONTAINER":/tmp/dzhoof-offsite-backup.archive.gz "$STAGING/recovery/mongodb.archive.gz"
docker exec "$MONGO_CONTAINER" rm -f /tmp/dzhoof-offsite-backup.archive.gz

test -s "$STAGING/recovery/mongodb.archive.gz" || die 'MongoDB archive is empty.'
gzip -t "$STAGING/recovery/mongodb.archive.gz"

say 'Collecting protected recovery configuration and source snapshot.'
install -m 600 /etc/dzhoot/.env.production "$STAGING/recovery/.env.production"
install -m 600 "$COMPOSE_DIR/docker-compose.production.yml" "$STAGING/recovery/docker-compose.production.yml"
install -m 600 "$COMPOSE_DIR/Caddyfile" "$STAGING/recovery/Caddyfile"
tar -C "$(dirname "$COMPOSE_DIR")" -czf "$STAGING/recovery/server-source.tar.gz" \
  --exclude='server/node_modules' \
  --exclude='server/backend/node_modules' \
  --exclude='server/frontend/node_modules' \
  --exclude='server/.env' \
  --exclude='server/.env.*' \
  --exclude='server/downloads' \
  --exclude='server/.git' \
  "$(basename "$COMPOSE_DIR")"
(
  cd "$STAGING/recovery"
  sha256sum mongodb.archive.gz server-source.tar.gz > SHA256SUMS
)

say 'Uploading encrypted recovery snapshot to the configured off-site repository.'
# `restic backup` is idempotent: a retry after a failed attempt re-reads the snapshot and
# uploads only what is still missing, so retrying can never duplicate or corrupt data.
with_repo_retry 'off-site upload' \
  restic backup "$STAGING/recovery" --retry-lock "$RETRY_LOCK" --tag dzhoof --tag production --tag "created-$STAMP" \
  || die "Off-site upload failed after ${OFFSITE_REPO_ATTEMPTS:-3} attempts."
# Retention stays fatal: the job's contract includes it, and a repo that silently stops
# pruning is its own incident. It gets the same retry for the same helper-startup reason.
with_repo_retry 'retention/prune' \
  restic forget --prune --retry-lock "$RETRY_LOCK" --keep-daily 7 --keep-weekly 4 --keep-monthly 3 \
  || die "Retention/prune failed after ${OFFSITE_REPO_ATTEMPTS:-3} attempts."
restic snapshots --latest 1 --retry-lock "$RETRY_LOCK" >/dev/null
say 'Off-site backup completed successfully.'
