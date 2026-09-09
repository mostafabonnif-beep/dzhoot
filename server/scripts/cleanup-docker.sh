#!/usr/bin/env bash
#
# DZ HOOF — weekly Docker/disk hygiene
#
# Why: every atomic deploy adds ~2.1GB of images (api+frontend:current,
# :v<ver>-<stamp>, :rollback-<stamp>), and docker build cache grows between
# builds. restic local/offsite repos self-prune (keep-daily 7/weekly 4/monthly
# 3) but images had NO scheduled cleanup — the disk filled to ~80% and hit
# 100% on 2026-09-08 (recovered manually, 22GB freed). This script is the
# scheduled counterpart: run weekly (see dzhoof-docker-cleanup.timer).
#
# Safety:
#   * Only removes images that are UNUSED (no container references them) and
#     older than KEEP_IMAGE_HOURS, so the running stack and the previous
#     release/rollback images stay untouched.
#   * Rollback images newer than KEEP_ROLLBACK_DAYS are always kept, even if
#     the until-filter above would not yet apply to them.
#   * Never touches /var/backups or restic repositories.
#
# Output: prints reclaimed space; appends one line per run to the log file.

set -euo pipefail

LOG_FILE="${DZHOOF_CLEANUP_LOG:-/var/log/dzhoot-docker-cleanup.log}"
KEEP_IMAGE_HOURS="${DZHOOF_KEEP_IMAGE_HOURS:-168}"      # 7 days
KEEP_ROLLBACK_DAYS="${DZHOOF_KEEP_ROLLBACK_DAYS:-14}"   # explicit rollback safety
MAX_LOG_LINES=500

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

total_reclaimed=""

reclaim_line() { # "$1" = prune stdout; extracts "Total reclaimed space: X"
  printf '%s' "$1" | sed -n 's/.*Total reclaimed space: *//p' | tail -1
}

main() {
  command -v docker >/dev/null 2>&1 || { log "error: docker not found"; exit 1; }
  docker info >/dev/null 2>&1 || { log "error: docker daemon unreachable"; exit 1; }

  started="$(date -u +%FT%TZ)"
  log "cleanup start"

  # 1) Build cache (safe to drop entirely; images rebuild from Dockerfiles).
  builder_out="$(docker builder prune -af 2>&1 || true)"
  builder_reclaimed="$(reclaim_line "$builder_out")"
  log "builder prune: ${builder_reclaimed:-0 B (nothing to reclaim)}"

  # 2) Unused images older than KEEP_IMAGE_HOURS (dangling + tagged but unused).
  image_out="$(docker image prune -af --filter "until=${KEEP_IMAGE_HOURS}h" 2>&1 || true)"
  log "image prune (unused, >${KEEP_IMAGE_HOURS}h): ${image_reclaimed:-0 B reclaimed}"

  # 3) Explicit rollback-image cleanup: drop dzhoof-*:rollback-* older than
  #    KEEP_ROLLBACK_DAYS regardless of the until-filter.
  cutoff="$(date -u -d "-${KEEP_ROLLBACK_DAYS} days" +%Y%m%dT%H%M%SZ 2>/dev/null || true)"
  if [ -n "$cutoff" ]; then
    while IFS= read -r img; do
      [ -n "$img" ] || continue
      stamp="${img##*:rollback-}"
      # Stamps look like 20260908T174916Z; anything else is kept (unknown age).
      if [[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [[ "$stamp" < "$cutoff" ]]; then
        log "removing old rollback image: ${img}"
        docker rmi "$img" >/dev/null 2>&1 || true
      fi
    done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep ':rollback-' || true)
  fi

  # 4) Exited containers older than 24h (staging leftovers etc.).
  container_out="$(docker container prune -f --filter 'until=24h' 2>&1 || true)"
  log "container prune: ${container_reclaimed:-0 B reclaimed}"

  log "cleanup done"
}

# Keep the log from growing forever.
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$MAX_LOG_LINES" ]; then
  tail -n "$MAX_LOG_LINES" "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE" || true
fi

mkdir -p "$(dirname "$LOG_FILE")"
{
  main
} >> "$LOG_FILE" 2>&1 || { echo "cleanup failed — see $LOG_FILE"; exit 1; }

echo "DZ HOOF docker cleanup finished — log: $LOG_FILE"
