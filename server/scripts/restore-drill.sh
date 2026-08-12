#!/usr/bin/env bash
set -Eeuo pipefail

# Restore a DZ HOOT archive into a non-production MongoDB used for a restore drill.
# This script intentionally requires an explicit opt-in to prevent accidental restores.
BACKUP_FILE="${BACKUP_FILE:-}"
MONGODB_RESTORE_URI="${MONGODB_RESTORE_URI:-}"
MONGODB_URI="${MONGODB_URI:-}"
MONGORESTORE_BIN="${MONGORESTORE_BIN:-mongorestore}"
ALLOW_RESTORE_DRILL="${ALLOW_RESTORE_DRILL:-false}"
RESTORE_DROP="${RESTORE_DROP:-false}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

notify_failure() {
  local status="$1"
  if [[ -z "$ALERT_WEBHOOK_URL" || ! "$ALERT_WEBHOOK_URL" =~ ^https?:// ]]; then
    return 0
  fi
  printf '{"event":"restore-drill:failure","severity":"critical","message":"DZ HOOT restore drill failed","status":%s,"service":"dzhoot-restore-drill"}\n' "$status" \
    | curl --silent --show-error --fail --max-time 5 \
      -H 'Content-Type: application/json' --data-binary @- "$ALERT_WEBHOOK_URL" >/dev/null || true
}

on_exit() {
  local status="$?"
  if (( status != 0 )); then notify_failure "$status"; fi
  exit "$status"
}
trap on_exit EXIT

if [[ "$ALLOW_RESTORE_DRILL" != "true" ]]; then
  echo 'Refusing to restore: set ALLOW_RESTORE_DRILL=true for a deliberate non-production drill' >&2
  exit 2
fi
if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo 'BACKUP_FILE must point to an existing archive' >&2
  exit 2
fi
if [[ -z "$MONGODB_RESTORE_URI" ]]; then
  echo 'MONGODB_RESTORE_URI is required' >&2
  exit 2
fi
if [[ -n "$MONGODB_URI" && "$MONGODB_RESTORE_URI" == "$MONGODB_URI" ]]; then
  echo 'Refusing to restore into the production URI; use a separate test database' >&2
  exit 2
fi
if ! command -v "$MONGORESTORE_BIN" >/dev/null 2>&1; then
  echo 'mongorestore was not found; install MongoDB Database Tools or set MONGORESTORE_BIN' >&2
  exit 127
fi

gzip -t -- "$BACKUP_FILE"
restore_args=("--uri=$MONGODB_RESTORE_URI" "--archive=$BACKUP_FILE" '--gzip')
if [[ "$RESTORE_DROP" == "true" ]]; then
  restore_args+=('--drop')
fi
"$MONGORESTORE_BIN" "${restore_args[@]}"
printf 'Restore drill completed successfully from %s\n' "$(basename -- "$BACKUP_FILE")"
trap - EXIT
