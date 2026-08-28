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
MODE="${1:---backup}"

say() { printf '[offsite-backup] %s\n' "$*"; }
die() { printf '[offsite-backup][ERROR] %s\n' "$*" >&2; exit 1; }

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

if [ "$MODE" = '--init' ]; then
  say 'Initializing the encrypted off-site repository.'
  restic init
  say 'Repository initialization completed successfully.'
  exit 0
fi

if [ "$MODE" = '--check' ]; then
  say 'Checking the encrypted off-site repository using a small random data subset.'
  restic check --read-data-subset=1/20
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
docker exec "$MONGO_CONTAINER" mongodump --db "$DATABASE_NAME" --gzip --archive=/tmp/dzhoof-offsite-backup.archive.gz
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
sha256sum "$STAGING/recovery/mongodb.archive.gz" "$STAGING/recovery/server-source.tar.gz" > "$STAGING/recovery/SHA256SUMS"

say 'Uploading encrypted recovery snapshot to the configured off-site repository.'
restic backup "$STAGING/recovery" --tag dzhoof --tag production --tag "created-$STAMP"
restic forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 3
restic snapshots --latest 1 >/dev/null
say 'Off-site backup completed successfully.'
