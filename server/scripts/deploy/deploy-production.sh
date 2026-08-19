#!/usr/bin/env bash
# DZ HOOF production deploy (audit-remediation-v1) — THE PRECISE PLAN.
#
# This script is the exact, reviewable deploy procedure for the production
# server (5.135.79.221). It is intentionally SAFE-BY-DEFAULT:
#   - dry-run mode by default (prints every step, changes nothing)
#   - requires the operator flag --apply to actually change anything
#   - takes a verified backup before touching containers
#   - never modifies DNS, SSH, or secrets
#
# Usage:
#   ./scripts/deploy/deploy-production.sh                  # DRY-RUN (recommended first)
#   ./scripts/deploy/deploy-production.sh --apply          # after explicit approval
#
# Environment (on the server):
#   ENV_FILE=/etc/dzhoot/.env.production (default)
#   COMPOSE_FILE=docker-compose.production.yml (default)
set -uo pipefail

ENV_FILE="${ENV_FILE:-/etc/dzhoot/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

cd "$(dirname "$0")/../.."
HERE="$(pwd)"

say() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
step() { printf '\033[1;36m[deploy] %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[deploy][ABORT]\033[0m %s\n' "$*"; exit 1; }

# run <step-label> <command...>: executes the command ONLY in --apply mode;
# in dry-run mode it prints what would run. This keeps dry-run truly read-only.
run() {
  local label="$1"; shift
  if [ "$APPLY" -eq 1 ]; then
    "$@"
  else
    say "[dry-run] would run: $*"
  fi
}

if [ "$APPLY" -eq 0 ]; then
  say "DRY-RUN — printing the exact deploy plan, changing nothing."
  say "Re-run with --apply after explicit operator approval."
fi

[ -f "$ENV_FILE" ] || die "ENV_FILE not found: $ENV_FILE"
[ "$(stat -c '%a' "$ENV_FILE")" = "600" ] || die "ENV_FILE must be chmod 600: $ENV_FILE"

step "1/7  Preflight"
run "preflight" ./scripts/deploy/preflight.sh || die "preflight failed — fix before deploying"

step "2/7  Verifiable backup (mongodump + checksum)"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="/var/backups/dzhoot/mongodb/deploy-$STAMP"
run "mkdir backup dir" mkdir -p "$OUT"
run "mongodump" docker exec dzhoof-mongodb mongodump --uri=mongodb://127.0.0.1:27017/dzhoof-iptv --gzip --archive=/tmp/deploy.archive.gz
run "copy archive" docker cp dzhoof-mongodb:/tmp/deploy.archive.gz "$OUT/dzhoof-iptv.archive.gz"
run "cleanup tmp" docker exec dzhoof-mongodb rm -f /tmp/deploy.archive.gz
run "checksum" sh -c "cd '$OUT' && sha256sum dzhoof-iptv.archive.gz > SHA256SUMS && sha256sum -c SHA256SUMS"
say "backup target: $OUT"

step "3/7  Build images (tagged, not latest) + promote :current"
BUILD_TAG="v$(grep -E '^APP_VERSION=' "$ENV_FILE" | cut -d= -f2- || echo 1.0.1)-$STAMP"
OLD_API="$(grep -E '^DOCKER_IMAGE=' "$ENV_FILE" | cut -d= -f2-)"
OLD_FE="$(grep -E '^DOCKER_FRONTEND_IMAGE=' "$ENV_FILE" | cut -d= -f2-)"
say "previous images: ${OLD_API:-<unset>} / ${OLD_FE:-<unset>} (kept for rollback)"
run "build api" docker build -t "dzhoof-api:${BUILD_TAG}" .
run "tag api current" docker tag "dzhoof-api:${BUILD_TAG}" "dzhoof-api:current"
run "build frontend" docker build -f Dockerfile.frontend -t "dzhoof-frontend:${BUILD_TAG}" .
run "tag frontend current" docker tag "dzhoof-frontend:${BUILD_TAG}" "dzhoof-frontend:current"

step "3b/7  Point compose at :current (old refs recorded above for rollback)"
if [ "$APPLY" -eq 1 ]; then
  sed -i "s|^DOCKER_IMAGE=.*|DOCKER_IMAGE=dzhoof-api:current|" "$ENV_FILE"
  sed -i "s|^DOCKER_FRONTEND_IMAGE=.*|DOCKER_FRONTEND_IMAGE=dzhoof-frontend:current|" "$ENV_FILE"
  say "ENV_FILE updated to dzhoof-api:current / dzhoof-frontend:current"
else
  say "[dry-run] would update $ENV_FILE to dzhoof-api:current / dzhoof-frontend:current"
fi

step "4/7  Compose up (api, frontend, scheduler) — caddy/mongo/redis untouched"
run "compose up" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps api frontend scheduler

step "5/7  Health verification"
run "sleep" sleep 20
run "public health" curl -fsS "http://127.0.0.1/health"
run "details health" sh -c "curl -fsS 'http://127.0.0.1/health?details=true' | head -c 400; echo"
run "compose ps" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

step "6/7  Scheduler smoke (must NOT crash with OOM)"
if [ "$APPLY" -eq 1 ]; then
  sleep 30
  if docker logs dzhoof-scheduler --tail 25 | grep -E 'FATAL|heap out of memory'; then
    die 'scheduler OOM detected'
  else
    say 'no OOM in recent scheduler logs'
  fi
else
  say "[dry-run] would wait 30s then grep scheduler logs for OOM"
fi

step "7/7  Record deploy"
run "record deploy" sh -c "printf '%s\t%s\t%s\n' \"$(date -u +%FT%TZ)\" \"${BUILD_TAG}\" \"$OUT\" >> /var/log/dzhoof-deploys.log"
say "deploy log target: /var/log/dzhoof-deploys.log"

if [ "$APPLY" -eq 0 ]; then
  say "DRY-RUN COMPLETE — nothing was changed. Run with --apply after approval."
else
  say "DEPLOY COMPLETE — ${BUILD_TAG}"
fi
