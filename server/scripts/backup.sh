#!/usr/bin/env bash
set -Eeuo pipefail

# DZ HOOT MongoDB backup utility.
# All configuration is supplied through environment variables so credentials
# never need to be committed to the repository or written to shell history.
MONGODB_URI="${MONGODB_URI:-}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/dzhoot/mongodb}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MONGODUMP_BIN="${MONGODUMP_BIN:-mongodump}"

if [[ -z "$MONGODB_URI" ]]; then
  echo "MONGODB_URI is required" >&2
  exit 2
fi
if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 1 )); then
  echo "RETENTION_DAYS must be a positive integer" >&2
  exit 2
fi
if ! command -v "$MONGODUMP_BIN" >/dev/null 2>&1; then
  echo "mongodump was not found; install MongoDB Database Tools or set MONGODUMP_BIN" >&2
  exit 127
fi

umask 077
mkdir -p "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$BACKUP_DIR/dzhoot-mongodb-${stamp}.archive.gz"
tmp="${output}.partial-$$"
cleanup() {
  rm -f -- "$tmp"
}
trap cleanup EXIT

# Use an archive stream so the result is a single portable, permission-restricted file.
# Do not echo MONGODB_URI: it commonly contains a username and password.
"$MONGODUMP_BIN" --uri="$MONGODB_URI" --archive="$tmp" --gzip

gzip -t -- "$tmp"
chmod 600 -- "$tmp"
mv -f -- "$tmp" "$output"
trap - EXIT

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'dzhoot-mongodb-*.archive.gz' \
  -mtime "+$RETENTION_DAYS" -delete

printf 'MongoDB backup created: %s\n' "$output"
printf 'Retention policy: %s day(s)\n' "$RETENTION_DAYS"
