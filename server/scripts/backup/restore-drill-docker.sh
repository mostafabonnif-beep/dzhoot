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
BACKUP_FILE="${1:-}"
MONGO_CONTAINER="${MONGO_CONTAINER:-dzhoof-mongodb}"
DRILL_DB="${DRILL_DB:-restore_drill}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
MONGO_AUTH_USER="${MONGO_AUTH_USER:-dzhoof-admin}"
MONGO_AUTH_DB="${MONGO_AUTH_DB:-admin}"
MONGO_AUTH_PASSWORD="${MONGO_AUTH_PASSWORD:-}"
MONGO_AUTH_PASSWORD_FILE="${MONGO_AUTH_PASSWORD_FILE:-/etc/dzhoot/mongo-admin-password}"
if [ -z "$MONGO_AUTH_PASSWORD" ] && [ -n "$MONGO_AUTH_PASSWORD_FILE" ] && [ -f "$MONGO_AUTH_PASSWORD_FILE" ]; then
  MONGO_AUTH_PASSWORD="$(tr -d '\r\n' < "$MONGO_AUTH_PASSWORD_FILE")"
fi
AUTH_ARGS=()
if [ -n "$MONGO_AUTH_PASSWORD" ]; then
  AUTH_ARGS=(--username "$MONGO_AUTH_USER" --password "$MONGO_AUTH_PASSWORD" --authenticationDatabase "$MONGO_AUTH_DB")
fi

say()  { printf '[restore-drill] %s\n' "$*"; }
die()  { printf '[restore-drill][ABORT] %s\n' "$*" >&2; exit 1; }
notify_failure() {
  [ -n "$ALERT_WEBHOOK_URL" ] && [[ "$ALERT_WEBHOOK_URL" =~ ^https?:// ]] || return 0
  printf '{"event":"restore-drill:failure","severity":"critical","message":"DZ HOOF restore drill failed","service":"dzhoot-restore-drill"}\n' \
    | curl -s --max-time 5 -H 'Content-Type: application/json' --data-binary @- "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}
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
DOCS="$(docker exec "$MONGO_CONTAINER" mongorestore \
  --uri="mongodb://127.0.0.1:27017" "${AUTH_ARGS[@]}" \
  --archive="$IN_CONTAINER" --gzip --drop \
  --nsFrom="dzhoof-iptv.*" --nsTo="${DRILL_DB}.*" 2>&1 \
  | grep -oE '[0-9]+ document\(s\) restored successfully' | grep -oE '[0-9]+' | tail -1)"
docker exec "$MONGO_CONTAINER" rm -f "$IN_CONTAINER"

[ -n "$DOCS" ] && [ "$DOCS" -gt 0 ] || die "restore returned 0 documents — drill FAILED"

COLS="$(docker exec "$MONGO_CONTAINER" mongosh --quiet "${AUTH_ARGS[@]}" --eval "print(db.getSiblingDB(\"$DRILL_DB\").getCollectionNames().length)" 2>/dev/null | tail -1)"
[ -n "$COLS" ] && [ "$COLS" -gt 0 ] || die "drill database has no collections — drill FAILED"

say "restored $DOCS documents across $COLS collections"
docker exec "$MONGO_CONTAINER" mongosh --quiet "${AUTH_ARGS[@]}" --eval "db.getSiblingDB(\"$DRILL_DB\").dropDatabase()" >/dev/null 2>&1
say "drill database dropped"
say "RESTORE DRILL OK ($DOCS documents)"
