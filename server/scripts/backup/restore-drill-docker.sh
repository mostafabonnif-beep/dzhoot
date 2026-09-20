#!/usr/bin/env bash
# Docker-based monthly restore drill: prove that the latest mongodump archive
# actually restores, using a throwaway database on the running mongo container.
#
# Safe by design:
#   - restores into a dedicated drill database (never the production db)
#   - counts documents to prove data came back, then DROPS the drill database
#   - refuses to run unless ALLOW_RESTORE_DRILL=true
#   - alerts via ALERT_WEBHOOK_URL on failure
#
# Usage:
#   ALLOW_RESTORE_DRILL=true ./scripts/backup/restore-drill-docker.sh \
#     /var/backups/dzhoot/mongodb/<stamp>/dzhoof.archive.gz
#
# Environment:
#   MONGO_CONTAINER=dzhoof-mongodb (default)
#   DRILL_DB=restore_drill (default; dropped afterwards)
#   ALERT_WEBHOOK_URL (optional; alert on failure)
#   MongoDB auth (required once the instance runs with --auth):
#     MONGO_AUTH_USER=dzhoof-admin (default)
#     MONGO_AUTH_DB=admin (default)
#     MONGO_AUTH_PASSWORD_FILE=/etc/dzhoot/mongo-admin-password (default; 0600 file)
#     MONGO_AUTH_PASSWORD= (explicit override; prefer the file)
set -Eeuo pipefail

ALLOW_RESTORE_DRILL="${ALLOW_RESTORE_DRILL:-false}"
# Positional argument wins; fall back to the BACKUP_FILE env var so the
# monthly cron (/etc/cron.d/dzhoof-restore-drill) invokes the Bash launcher
# server/scripts/ops/run-restore-drill-cron.sh so cron never executes this
# script directly through its default /bin/sh interpreter.
BACKUP_FILE="${1:-${BACKUP_FILE:-}}"
MONGO_CONTAINER="${MONGO_CONTAINER:-dzhoof-mongodb}"
DRILL_DB="${DRILL_DB:-restore_drill}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
MONGO_AUTH_USER="${MONGO_AUTH_USER:-}"
MONGO_AUTH_DB="${MONGO_AUTH_DB:-}"
MONGO_AUTH_PASSWORD="${MONGO_AUTH_PASSWORD:-}"
MONGO_AUTH_PASSWORD_FILE="${MONGO_AUTH_PASSWORD_FILE:-/etc/dzhoot/mongo-admin-password}"
DZHOOF_ENV_FILE="${DZHOOF_ENV_FILE:-/etc/dzhoot/.env.production}"

# Credentials, in order of decreasing truth. The instance had exactly one user
# (`dzhoof@admin`) while this drill authenticated as `dzhoof-admin` with a password
# from a file that matched nothing — so the drill could never pass, and it failed
# silently once a month (measured 2026-09-20). The app's own MONGODB_URI is what the
# backups are taken with, so it is the source of truth; the password file is only a
# last resort for hosts that have no env file.
extract_uri_part() { # extract_uri_part <sed-expression> <uri>
  printf '%s' "$2" | sed -nE "$1" | head -n 1
}
if [ -z "$MONGO_AUTH_PASSWORD" ]; then
  MONGO_AUTH_URI="${MONGO_AUTH_URI:-}"
  if [ -z "$MONGO_AUTH_URI" ] && [ -f "$DZHOOF_ENV_FILE" ]; then
    MONGO_AUTH_URI="$(sed -n 's/^MONGODB_URI=//p' "$DZHOOF_ENV_FILE" | tail -n 1 | tr -d '"' | tr -d "'")"
  fi
  if [ -n "$MONGO_AUTH_URI" ]; then
    URI_USER="$(extract_uri_part 's#^mongodb(\+srv)?://([^:/@]+):[^@]*@.*#\2#p' "$MONGO_AUTH_URI")"
    # NOTE: the password is group 2. Group 1 is the optional `+srv`, which is empty
    # for a plain mongodb:// URI — using \1 here silently produced an empty password.
    URI_PASS="$(extract_uri_part 's#^mongodb(\+srv)?://[^:/@]+:([^@]*)@.*#\2#p' "$MONGO_AUTH_URI")"
    URI_DB="$(extract_uri_part 's#.*[?&]authSource=([^&]*).*#\1#p' "$MONGO_AUTH_URI")"
    if [ -n "$URI_USER" ] && [ -n "$URI_PASS" ]; then
      MONGO_AUTH_USER="${MONGO_AUTH_USER:-$URI_USER}"
      MONGO_AUTH_PASSWORD="$URI_PASS"
      MONGO_AUTH_DB="${MONGO_AUTH_DB:-${URI_DB:-admin}}"
      printf '[restore-drill] credentials: from MONGODB_URI (user %s, authSource %s)\n' "$MONGO_AUTH_USER" "$MONGO_AUTH_DB" >&2
    fi
  fi
fi
if [ -z "$MONGO_AUTH_PASSWORD" ] && [ -n "$MONGO_AUTH_PASSWORD_FILE" ] && [ -f "$MONGO_AUTH_PASSWORD_FILE" ]; then
  MONGO_AUTH_PASSWORD="$(tr -d '\r\n' < "$MONGO_AUTH_PASSWORD_FILE")"
  MONGO_AUTH_USER="${MONGO_AUTH_USER:-dzhoof-admin}"
  printf '[restore-drill] credentials: from %s (user %s)\n' "$MONGO_AUTH_PASSWORD_FILE" "$MONGO_AUTH_USER" >&2
fi
MONGO_AUTH_USER="${MONGO_AUTH_USER:-dzhoof-admin}"
MONGO_AUTH_DB="${MONGO_AUTH_DB:-admin}"
AUTH_ARGS=()
if [ -n "$MONGO_AUTH_PASSWORD" ]; then
  AUTH_ARGS=(--username "$MONGO_AUTH_USER" --password "$MONGO_AUTH_PASSWORD" --authenticationDatabase "$MONGO_AUTH_DB")
fi

say()  { printf '[restore-drill] %s\n' "$*" >&2; }
die()  { printf '[restore-drill][ABORT] %s\n' "$*" >&2; exit 1; }

# One alert path, the one that demonstrably works on this host: dzhoof-alert.sh posts
# to the configured channels (Telegram today). The webhook call below stays as a
# fallback for hosts that have a webhook but no dzhoof-alert.sh — but note it silently
# did nothing on production, where ALERT_WEBHOOK_URL is empty, which is how a monthly
# drill failing every month went unnoticed.
notify() { # notify <severity> <message>
  local severity="$1" message="$2"
  if [ -x /usr/local/sbin/dzhoof-alert.sh ]; then
    /usr/local/sbin/dzhoof-alert.sh "$message" "$severity" restore-drill "$(date -u +%Y%m%dT%H%M%SZ)" >&2 || true
    return 0
  fi
  [ -n "$ALERT_WEBHOOK_URL" ] && [[ "$ALERT_WEBHOOK_URL" =~ ^https?:// ]] || return 0
  printf '{"event":"restore-drill","severity":"%s","message":"%s","service":"dzhoot-restore-drill"}\n' "$severity" "$message" \
    | curl -s --max-time 5 -H 'Content-Type: application/json' --data-binary @- "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}
notify_failure() { notify critical "DZ HOOF restore drill FAILED — the latest backup is not proven restorable"; }
on_exit() { local st=$?; if [ "$st" -ne 0 ]; then notify_failure; fi; exit "$st"; }
trap on_exit EXIT

[ "$ALLOW_RESTORE_DRILL" = "true" ] || die "set ALLOW_RESTORE_DRILL=true for a deliberate drill"
[ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ] || die "BACKUP_FILE not found: ${BACKUP_FILE:-<empty>}"
command -v docker >/dev/null || die "docker is required"
docker ps --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER" || die "mongo container not running: $MONGO_CONTAINER"

say "restore drill from: $BACKUP_FILE"
say "target: $DRILL_DB on $MONGO_CONTAINER (dropped afterwards)"

IN_CONTAINER="/tmp/dzhoof-drill-$$.archive.gz"
docker cp "$BACKUP_FILE" "$MONGO_CONTAINER:$IN_CONTAINER"

# --drop gives a clean slate: re-runs must not trip unique indexes.
#
# Capture the restore output instead of piping it straight into grep: piping hid the
# only line that explained a monthly failure ("Authentication failed"), and the drill
# reported a bare "restore returned 0 documents" with no cause (measured 2026-09-20).
RESTORE_LOG="$(mktemp)"
RESTORE_STATUS=0
docker exec "$MONGO_CONTAINER" mongorestore \
  --uri="mongodb://127.0.0.1:27017" "${AUTH_ARGS[@]}" \
  --archive="$IN_CONTAINER" --gzip --drop \
  --nsFrom="dzhoof-iptv.*" --nsTo="${DRILL_DB}.*" >"$RESTORE_LOG" 2>&1 || RESTORE_STATUS=$?
docker exec "$MONGO_CONTAINER" rm -f "$IN_CONTAINER"
DOCS="$(grep -oE '[0-9]+ document\(s\) restored successfully' "$RESTORE_LOG" | grep -oE '[0-9]+' | tail -1 || true)"

if [ "$RESTORE_STATUS" -ne 0 ] || [ -z "$DOCS" ] || [ "$DOCS" -le 0 ]; then
  printf '[restore-drill] mongorestore exit=%s, documents=%s\n' "$RESTORE_STATUS" "${DOCS:-none}" >&2
  echo '--- last 15 lines of the restore output ---' >&2
  tail -n 15 "$RESTORE_LOG" >&2 || true
  rm -f "$RESTORE_LOG"
  die "restore returned no documents — drill FAILED (see the output above for the cause)"
fi
rm -f "$RESTORE_LOG"

COLS="$(docker exec "$MONGO_CONTAINER" mongosh --quiet "${AUTH_ARGS[@]}" --eval "print(db.getSiblingDB(\"$DRILL_DB\").getCollectionNames().length)" 2>/dev/null | tail -1)"
[ -n "$COLS" ] && [ "$COLS" -gt 0 ] || die "drill database has no collections — drill FAILED"

say "restored $DOCS documents across $COLS collections"
docker exec "$MONGO_CONTAINER" mongosh --quiet "${AUTH_ARGS[@]}" --eval "db.getSiblingDB(\"$DRILL_DB\").dropDatabase()" >/dev/null 2>&1
say "drill database dropped"
say "RESTORE DRILL OK ($DOCS documents)"
# Report success too: a drill that only speaks up when it fails is indistinguishable
# from a drill that never ran — which is exactly how this one behaved for months.
notify ok "DZ HOOF restore drill OK — latest backup re-imported ($DOCS documents, $COLS collections)"
