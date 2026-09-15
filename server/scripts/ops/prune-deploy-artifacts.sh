#!/usr/bin/env bash
# prune-deploy-artifacts.sh — reclaim disk space left behind by repeated deploys.
#
# Why this exists: every atomic deploy builds `dzhoof-api`/`dzhoof-frontend` images and
# tags the previous pair `rollback-<timestamp>`. Those tags are the rollback safety net,
# so they are never removed automatically. After a few deploys the host held 10 tagged
# api images (1.65 GB each, 8.08 GB reclaimable) and the filesystem had reached 83% on
# 2026-09-15. This script keeps a configurable number of rollback generations and
# removes only what is older, plus unreferenced build cache.
#
# Safety properties:
#   * dry-run by default — nothing is deleted without --apply;
#   * never touches a running container's image (`dzhoof-api:current` and friends);
#   * never touches volumes, never runs `docker system prune`;
#   * never touches a `.previous-*` release directory the deploy scripts may still need
#     (they are only reported, and only those older than --keep-releases are listed);
#   * refuses to run when it cannot determine the images in use.
#
# Usage:
#   scripts/ops/prune-deploy-artifacts.sh                 # show what would be removed
#   scripts/ops/prune-deploy-artifacts.sh --apply         # do it
#   scripts/ops/prune-deploy-artifacts.sh --keep-rollback 2 --keep-releases 5 --apply
set -euo pipefail

KEEP_ROLLBACK=2
KEEP_RELEASES=4
BUILD_CACHE_HOURS=168
APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --keep-rollback) KEEP_ROLLBACK="${2:?--keep-rollback needs a number}"; shift ;;
    --keep-releases) KEEP_RELEASES="${2:?--keep-releases needs a number}"; shift ;;
    --build-cache-hours) BUILD_CACHE_HOURS="${2:?--build-cache-hours needs a number}"; shift ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

for n in "$KEEP_ROLLBACK" "$KEEP_RELEASES" "$BUILD_CACHE_HOURS"; do
  case "$n" in ''|*[!0-9]*) echo "expected a non-negative integer, got '$n'" >&2; exit 2 ;; esac
done

say() { printf '%s\n' "$*"; }
run() {
  if [ "$APPLY" = 1 ]; then
    "$@"
  else
    printf '  would run: %s\n' "$*"
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found — run this on the deploy host" >&2
  exit 2
fi

# Images backing running containers: never candidates.
in_use="$(docker ps --format '{{.Image}}' | sort -u)"
if [ -z "$in_use" ]; then
  echo "refusing to continue: no running containers found (is the stack up?)" >&2
  exit 2
fi
say "images in use by running containers:"
printf '  %s\n' $in_use

# Rollback generations, newest first, per repository.
for repo in dzhoof-api dzhoof-frontend; do
  mapfile -t tags < <(docker images --format '{{.Repository}} {{.Tag}}' \
    | awk -v r="$repo" '$1==r && $2 ~ /^rollback-/ {print $2}' | sort -r)
  total=${#tags[@]}
  if [ "$total" -eq 0 ]; then
    say "$repo: no rollback tags"
    continue
  fi
  keep=${tags[*]:0:$KEEP_ROLLBACK}
  drop=${tags[*]:$KEEP_ROLLBACK}
  say "$repo: $total rollback tag(s); keeping: ${keep:-none}"
  for t in ${drop:-}; do
    if printf '%s\n' $in_use | grep -qx "$repo:$t"; then
      say "  skipping $repo:$t (in use)"
      continue
    fi
    say "  removing $repo:$t"
    run docker image rm "$repo:$t"
  done
done

# Build cache older than the retention window (rebuildable, never a rollback input).
say "build cache older than ${BUILD_CACHE_HOURS}h:"
if [ "$APPLY" = 1 ]; then
  docker builder prune -f --filter "until=${BUILD_CACHE_HOURS}h"
else
  docker buildx du 2>/dev/null | head -5 || docker system df
  printf '  would run: docker builder prune -f --filter until=%sh\n' "$BUILD_CACHE_HOURS"
fi

# Release directories: report only. `atomic-deploy.sh` moves a failed release to
# `.failed-*` and the previous one to `.previous-*`; deleting them is the operator's call.
mapfile -t releases < <(ls -1d /opt/dzhoot.previous-* /opt/dzhoot.failed-* 2>/dev/null | sort -r)
if [ "${#releases[@]}" -gt 0 ]; then
  say "release directories: ${#releases[@]} (keeping newest $KEEP_RELEASES, reported only):"
  for r in "${releases[@]:$KEEP_RELEASES}"; do
    say "  candidate (remove by hand): $r  ($(du -sh "$r" 2>/dev/null | cut -f1))"
  done
fi

say ""
say "dry-run complete — nothing was deleted." 
if [ "$APPLY" = 1 ]; then
  say "applied. filesystem now:"
  df -h / | tail -1
fi
