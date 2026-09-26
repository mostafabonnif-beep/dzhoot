#!/usr/bin/env bash
# DZ HOOF — restore (and prove) the encrypted OFF-SITE backup.
#
# Why this file exists (2026-09-26 audit): the off-site backup job was the only
# documented half of the recovery story. `restic restore` appeared nowhere in the
# repository — the restore procedure lived as prose in
# `server/docs/OFFSITE_BACKUP_RUNBOOK_AR.md`, so "we have off-site backups" could
# not be turned into "we restored them" by anyone who did not already know how.
# The production-readiness gate needs the second half to be runnable.
#
# Modes:
#   --dry-run       validate config, permissions and tools. No network, no writes.
#   --restore-only  restic restore -> a scratch dir; verify SHA256SUMS + gzip.
#   --verify        the above, then import into a THROWAWAY mongod on a private
#                   docker network and assert documents actually came back. This is
#                   the mode to run before declaring a backup restorable.
#
# Never touches the production database, the production containers or the
# production network: the import target is a fresh `mongo:<tag>` container on its
# own network, removed at the end.
set -euo pipefail

CONFIG_FILE="${CONFIG_FILE:-/etc/dzhoot/restic-offsite.env}"
INKEEP="${RESTORE_KEEP:-0}"
SNAPSHOT="${SNAPSHOT:-latest}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${RESTORE_TARGET:-/var/tmp/dzhoof-restore-$STAMP}"
DRILL_IMAGE="${DRILL_MONGO_IMAGE:-mongo:8.0.29}"
DRILL_NET="${DRILL_NET:-dzhoof-restore-net-$STAMP}"
DRILL_DB="dzhoof-restore-$STAMP"
# The dump inside the snapshot is a whole-instance `mongodump --archive`; the
# production database name lives in the archive itself.
EXPECTED_DB="${EXPECTED_DB:-dzhoof-iptv}"
MIN_DOCUMENTS="${MIN_DOCUMENTS:-1}"

say() { printf '[offsite-restore] %s\n' "$*"; }
die() { printf '[offsite-restore][ERROR] %s\n' "$*" >&2; exit 1; }

# Bounded retry for repository commands.
#
# Measured 2026-09-26: the rclone backend's helper process intermittently fails to answer
# restic's HTTP client on the FIRST call of a run ("context deadline exceeded"), which is
# why the nightly backup grew the same wrapper. A manual restore is subject to exactly the
# same cold start — the first `restic snapshots` of the session failed and the retry
# succeeded immediately — so an un-retried restore would fail about half the time and make
# a working recovery path look broken.
with_repo_retry() {
  local label="$1"; shift
  local attempts="${OFFSITE_REPO_ATTEMPTS:-3}"
  local delay="${OFFSITE_REPO_DELAY_SECONDS:-20}"
  local attempt=1
  while :; do
    if "$@"; then return 0; fi
    if [ "$attempt" -ge "$attempts" ]; then return 1; fi
    say "$label failed (attempt $attempt/$attempts) — retrying in ${delay}s"
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

MODE="${1:---verify}"
case "$MODE" in
  --dry-run|--restore-only|--verify) ;;
  *) die "Usage: $0 [--dry-run|--restore-only|--verify]" ;;
esac

[ "$(id -u)" = "0" ] || die "must run as root (the config and password files are 600)"
[ -f "$CONFIG_FILE" ] || die "config file not found: $CONFIG_FILE"
[ "$(stat -c '%a' "$CONFIG_FILE")" = "600" ] || die "$CONFIG_FILE must be mode 600"
command -v restic >/dev/null || die "restic not found on PATH"
command -v gzip   >/dev/null || die "gzip not found on PATH"
[ "$MODE" = "--dry-run" ] || command -v docker >/dev/null || die "docker not found on PATH (needed for --verify)"

# shellcheck disable=SC1090
set -a; . "$CONFIG_FILE"; set +a
export RESTIC_REPOSITORY="${OFFSITE_RESTIC_REPOSITORY:?OFFSITE_RESTIC_REPOSITORY missing from $CONFIG_FILE}"
export RESTIC_PASSWORD_FILE="${OFFSITE_RESTIC_PASSWORD_FILE:?OFFSITE_RESTIC_PASSWORD_FILE missing from $CONFIG_FILE}"
[ -f "$RESTIC_PASSWORD_FILE" ] || die "password file not found: $RESTIC_PASSWORD_FILE"
[ "$(stat -c '%a' "$RESTIC_PASSWORD_FILE")" = "600" ] || die "$RESTIC_PASSWORD_FILE must be mode 600"
if [ -n "${OFFSITE_RCLONE_CONFIG:-}" ]; then
  export RCLONE_CONFIG="$OFFSITE_RCLONE_CONFIG"
  [ -f "$RCLONE_CONFIG" ] || die "rclone config not found: $RCLONE_CONFIG"
  [ "$(stat -c '%a' "$RCLONE_CONFIG")" = "600" ] || die "$RCLONE_CONFIG must be mode 600"
fi
# ProtectHome=true in the systemd unit makes restic's default cache read-only; a
# manual run must not fight the service over the same cache either. Use the same
# directory the unit uses.
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-/var/cache/dzhoof-restic}"
mkdir -p "$RESTIC_CACHE_DIR"

say "repository: $(printf '%s' "$RESTIC_REPOSITORY" | sed 's#/[^/]*$#/***#')"
say "snapshot:   $SNAPSHOT"
if [ "$MODE" = "--dry-run" ]; then
  say "dry-run OK: config, permissions, tools and cache dir are all valid."
  exit 0
fi

cleanup() {
  set +e
  if [ "${DRILL_CREATED:-0}" = "1" ]; then
    docker rm -f "$DRILL_DB" >/dev/null 2>&1
    docker network rm "$DRILL_NET" >/dev/null 2>&1
  fi
  if [ "$INKEEP" != "1" ]; then
    # The restored tree contains .env.production — a copy of the production
    # secrets. Never leave it behind.
    rm -rf "$TARGET"
  else
    say "RESTORE_KEEP=1 — restored tree left at $TARGET (contains production secrets; remove it when done)"
  fi
}
trap cleanup EXIT

# ── 1. restore ────────────────────────────────────────────────────────────────
say "restoring $SNAPSHOT from the off-site repository into $TARGET"
install -d -m 700 "$TARGET"
restic restore "$SNAPSHOT" --target "$TARGET"
RECOVERY="$(find "$TARGET" -type d -name recovery -print -quit)"
[ -n "$RECOVERY" ] || die "restore produced no 'recovery' directory — refusing to continue"
say "restored tree: $RECOVERY"
ls -la "$RECOVERY"

# ── 2. integrity ──────────────────────────────────────────────────────────────
ARCHIVE="$RECOVERY/mongodb.archive.gz"
[ -s "$ARCHIVE" ] || die "mongodb.archive.gz missing or empty in the snapshot"
if [ -f "$RECOVERY/SHA256SUMS" ]; then
  say "verifying SHA256SUMS"
  ( cd "$RECOVERY" && sha256sum -c SHA256SUMS ) || die "checksum verification failed"
else
  say "WARNING: no SHA256SUMS in this snapshot — integrity relies on gzip only"
fi
gzip -t "$ARCHIVE" || die "mongodb.archive.gz is not a valid gzip stream"
say "integrity OK ($(du -h "$ARCHIVE" | cut -f1) archive)"

if [ "$MODE" = "--restore-only" ]; then
  say "restore-only complete."
  exit 0
fi

# ── 3. prove it imports, on a throwaway mongod ────────────────────────────────
say "starting throwaway $DRILL_IMAGE on private network $DRILL_NET"
docker network create "$DRILL_NET" >/dev/null
DRILL_CREATED=1
docker run -d --name "$DRILL_DB" --network "$DRILL_NET" \
  --memory 2g --ulimit nofile=64000:64000 "$DRILL_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$DRILL_DB" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$DRILL_DB" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 \
  || die "throwaway mongod did not become ready"

# The archive is 600 root and the container user cannot traverse a 700 parent, so
# stage a copy the container's importer can read.
STAGE="$(mktemp -d /var/tmp/dzhoof-restore-stage-XXXXXX)"
cp -f "$ARCHIVE" "$STAGE/mongodb.archive.gz"
chmod 755 "$STAGE"; chmod 644 "$STAGE/mongodb.archive.gz"
trap 'rm -rf "$STAGE"; cleanup' EXIT

say "importing the archive into the throwaway mongod"
docker run --rm --user 0 --network "$DRILL_NET" \
  -v "$STAGE":/restore:ro "$DRILL_IMAGE" \
  mongorestore --host "$DRILL_DB:27017" --gzip --archive=/restore/mongodb.archive.gz \
  | tail -3

read -r COLLECTIONS DOCUMENTS <<EOF
$(docker exec "$DRILL_DB" mongosh --quiet --eval "
const d = db.getSiblingDB('$EXPECTED_DB');
let total = 0;
for (const n of d.getCollectionNames()) { total += d.getCollection(n).estimatedDocumentCount(); }
print(d.getCollectionNames().length + ' ' + total);
")
EOF
say "restored database '$EXPECTED_DB': ${COLLECTIONS} collections, ${DOCUMENTS} documents"
[ "${DOCUMENTS:-0}" -ge "$MIN_DOCUMENTS" ] || die "restored 0 documents — this snapshot is NOT restorable"
[ "${COLLECTIONS:-0}" -ge 1 ] || die "restored 0 collections — this snapshot is NOT restorable"

say "RESTORE VERIFIED: $SNAPSHOT restored and imported successfully."
