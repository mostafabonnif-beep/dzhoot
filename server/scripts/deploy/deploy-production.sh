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
export ENV_FILE COMPOSE_FILE
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

cd "$(dirname "$0")/../.." || exit 1

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
    say "[dry-run] $label: $*"
  fi
}

if [ "$APPLY" -eq 0 ]; then
  say "DRY-RUN — printing the exact deploy plan, changing nothing."
  say "Re-run with --apply after explicit operator approval."
fi

[ -f "$ENV_FILE" ] || die "ENV_FILE not found: $ENV_FILE"
[ "$(stat -c '%a' "$ENV_FILE")" = "600" ] || die "ENV_FILE must be chmod 600: $ENV_FILE"

step "1/7  Preflight"
run "preflight" env ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" ./scripts/deploy/preflight.sh || die "preflight failed — fix before deploying"
# Caddy-independent pre-deploy gate: the API container itself must be healthy
# before we touch anything. Local port-80 checks are unreliable because Caddy
# auto-redirects all :80 traffic to HTTPS (308), so we never depend on them.
run "docker health api (pre)" sh -c 'docker inspect -f "{{.State.Health.Status}}" dzhoof-api 2>/dev/null | grep -qx healthy' || die "dzhoof-api is not healthy — refusing to deploy over a sick stack"

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
APP_VERSION="$(sed -n 's/^APP_VERSION=//p' "$ENV_FILE" | tail -n 1)"
APP_VERSION="${APP_VERSION:-1.0.1}"
RELEASE_COMMIT="${RELEASE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
RELEASE_BUILT_AT="${RELEASE_BUILT_AT:-$(date -u +%FT%TZ)}"
if [[ "$RELEASE_COMMIT" != "unknown" && ! "$RELEASE_COMMIT" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  die "RELEASE_COMMIT must be a Git SHA or 'unknown'"
fi
export RELEASE_COMMIT RELEASE_BUILT_AT
BUILD_TAG="v${APP_VERSION}-$STAMP"
OLD_API="$(grep -E '^DOCKER_IMAGE=' "$ENV_FILE" | cut -d= -f2-)"
OLD_FE="$(grep -E '^DOCKER_FRONTEND_IMAGE=' "$ENV_FILE" | cut -d= -f2-)"
say "previous images: ${OLD_API:-<unset>} / ${OLD_FE:-<unset>} (kept for rollback)"
say "release metadata: commit=${RELEASE_COMMIT}, built_at=${RELEASE_BUILT_AT}"
run "build api" docker build --build-arg "APP_VERSION=${APP_VERSION}" --build-arg "RELEASE_COMMIT=${RELEASE_COMMIT}" --build-arg "RELEASE_BUILT_AT=${RELEASE_BUILT_AT}" -t "dzhoof-api:${BUILD_TAG}" . || die "api build failed"
run "tag api current" docker tag "dzhoof-api:${BUILD_TAG}" "dzhoof-api:current" || die "api tag failed"
run "build frontend" docker build -f Dockerfile.frontend --build-arg "APP_VERSION=${APP_VERSION}" --build-arg "RELEASE_COMMIT=${RELEASE_COMMIT}" --build-arg "RELEASE_BUILT_AT=${RELEASE_BUILT_AT}" -t "dzhoof-frontend:${BUILD_TAG}" . || die "frontend build failed"
run "tag frontend current" docker tag "dzhoof-frontend:${BUILD_TAG}" "dzhoof-frontend:current" || die "frontend tag failed"

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
# Health is verified via the public HTTPS endpoint (through Caddy) and directly
# via the API container healthcheck. Do NOT use http://127.0.0.1/health here:
# Caddy's automatic HTTPS redirect answers 308 on :80, which would abort every
# deploy even when the stack is perfectly healthy.
DOMAIN="$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | tr -d '"' | tr -d "'")"
[ -n "$DOMAIN" ] || die "DOMAIN missing from $ENV_FILE — cannot verify public health"
run "docker health api" sh -c 'docker inspect -f "{{.State.Health.Status}}" dzhoof-api | grep -qx healthy'
run "public health" curl -fsS "https://${DOMAIN}/health"
if [ "$RELEASE_COMMIT" != "unknown" ]; then
  run "release trace health" sh -c "curl -fsS 'https://${DOMAIN}/health' | grep -F '\"commit\":\"${RELEASE_COMMIT}\"' >/dev/null"
fi
run "details health" sh -c "curl -fsS 'https://${DOMAIN}/health?details=true' | head -c 400; echo"
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
run "record deploy" sh -c "printf '%s\t%s\t%s\t%s\t%s\n' \"$(date -u +%FT%TZ)\" \"${BUILD_TAG}\" \"${RELEASE_COMMIT}\" \"${RELEASE_BUILT_AT}\" \"$OUT\" >> /var/log/dzhoof-deploys.log"
say "deploy log target: /var/log/dzhoof-deploys.log"

if [ "$APPLY" -eq 0 ]; then
  say "DRY-RUN COMPLETE — nothing was changed. Run with --apply after approval."
else
  say "DEPLOY COMPLETE — ${BUILD_TAG}"
fi
