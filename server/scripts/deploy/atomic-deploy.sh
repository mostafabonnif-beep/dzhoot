#!/usr/bin/env bash
# Atomic DZ HOOF production deploy: swap a staged release into /opt/dzhoot
# with a verifiable backup and automatic rollback, then apply the deploy plan.
#
# This generalizes the per-release wrapper previously generated ad-hoc on the
# production server. Behavior:
#   - APPLY=0 (default): dry-run — stages nothing, prints the full plan.
#   - APPLY=1: takes a pre-deploy health gate, backs up the current source,
#     swaps /opt/dzhoot -> .previous-<stamp>, runs deploy-production.sh --apply,
#     verifies health, and on ANY failure restores the previous release and
#     retags the previous images (rollback).
#
# Usage:
#   ./scripts/deploy/atomic-deploy.sh <sha>            # dry-run
#   APPLY=1 ./scripts/deploy/atomic-deploy.sh <sha>    # apply
#
# Environment:
#   ENV_FILE=/etc/dzhoot/.env.production (default)
#   RELEASES_ROOT=/opt/dzhoot-releases (default)
#   ACTIVE_ROOT=/opt/dzhoot (default)
set -Eeuo pipefail

SHA="${1:?usage: atomic-deploy.sh <sha>  (APPLY=1 for a real deploy)}"
RELEASES_ROOT="${RELEASES_ROOT:-/opt/dzhoot-releases}"
ACTIVE="${ACTIVE_ROOT:-/opt/dzhoot}"
ENV_FILE="${ENV_FILE:-/etc/dzhoot/.env.production}"
RELEASE="$RELEASES_ROOT/$SHA"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PREVIOUS="${ACTIVE}.previous-${STAMP}"
FAILED="${ACTIVE}.failed-${STAMP}"
SOURCE_BACKUP="/var/backups/dzhoot/source/pre-${SHA}-${STAMP}.tar.gz"
APPLY="${APPLY:-0}"
SWAPPED=0
API_IMAGE_ID=""
FRONTEND_IMAGE_ID=""

say() { printf '[atomic-deploy] %s\n' "$*"; }
die() { printf '[atomic-deploy][ABORT] %s\n' "$*" >&2; exit 1; }

rollback() {
  code=$?
  if [ "$SWAPPED" -eq 1 ]; then
    say "deployment failed (exit ${code}); restoring source and running images"
    if [ -n "$API_IMAGE_ID" ]; then docker tag "$API_IMAGE_ID" dzhoof-api:current || true; fi
    if [ -n "$FRONTEND_IMAGE_ID" ]; then docker tag "$FRONTEND_IMAGE_ID" dzhoof-frontend:current || true; fi
    if [ -d "$ACTIVE" ]; then mv "$ACTIVE" "$FAILED" || true; fi
    if [ -d "$PREVIOUS" ]; then mv "$PREVIOUS" "$ACTIVE" || true; fi
    if [ -d "$ACTIVE" ]; then
      # Do not retain release metadata from the failed deploy when starting the
      # restored source. Older releases fall back to compose's safe `unknown` value.
      unset RELEASE_COMMIT RELEASE_BUILT_AT
      cd "$ACTIVE/server"
      docker compose -f docker-compose.production.yml --env-file "$ENV_FILE" up -d --no-deps api frontend scheduler || true
    fi
  fi
  exit "$code"
}
trap rollback ERR

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -d "$RELEASE" ] || die "staged release missing: $RELEASE — run scripts/deploy/stage-release.sh $SHA first"
[ -f "$RELEASE/server/docker-compose.production.yml" ] || die "invalid staged release: $RELEASE"
[ -f "$ENV_FILE" ] || die "environment file missing: $ENV_FILE"
[ "$(stat -c '%a' "$ENV_FILE")" = "600" ] || die "environment file permissions must be 600: $ENV_FILE"

say "target release: $RELEASE"
say "environment: $ENV_FILE"

if [ "$APPLY" -ne 1 ]; then
  say "DRY-RUN — nothing will change. Re-run with APPLY=1 to execute."
  say "plan: pre-deploy health gate -> source backup -> swap $ACTIVE -> deploy-production.sh --apply -> health verification -> rollback on failure"
  echo "DRY-RUN $SHA"
  exit 0
fi

say "pre-deploy health gate (Caddy-independent)"
docker inspect -f '{{.State.Health.Status}}' dzhoof-api | grep -qx healthy || die "dzhoof-api not healthy before deploy"
curl -fsS --max-time 15 "https://$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | tr -d '"' | tr -d "'")/health" >/dev/null || die "public health check failed before deploy"

API_IMAGE_ID="$(docker inspect -f '{{.Image}}' dzhoof-api)"
FRONTEND_IMAGE_ID="$(docker inspect -f '{{.Image}}' dzhoof-frontend)"
docker tag "$API_IMAGE_ID" "dzhoof-api:rollback-${STAMP}"
docker tag "$FRONTEND_IMAGE_ID" "dzhoof-frontend:rollback-${STAMP}"
say "rollback image tags created: dzhoof-api:rollback-${STAMP}, dzhoof-frontend:rollback-${STAMP}"

say "backing up current source to $SOURCE_BACKUP"
install -d -m 700 /var/backups/dzhoot/source
tar -C /opt -czf "$SOURCE_BACKUP" dzhoot
sha256sum "$SOURCE_BACKUP" > "${SOURCE_BACKUP}.sha256"
sha256sum -c "${SOURCE_BACKUP}.sha256"

say "switching active source to release $SHA"
mv "$ACTIVE" "$PREVIOUS"
mv "$RELEASE" "$ACTIVE"
SWAPPED=1

# stage-release.sh verified this full SHA before staging it. Pass only this
# non-secret provenance metadata into compose and image labels for the deploy.
export RELEASE_COMMIT="$SHA"
export RELEASE_BUILT_AT="$(date -u +%FT%TZ)"

say "running verified production deployment"
cd "$ACTIVE/server"
./scripts/deploy/deploy-production.sh --apply

say "verifying local health and containers"
docker inspect -f '{{.State.Health.Status}}' dzhoof-api | grep -qx healthy || die "dzhoof-api not healthy after deploy"
curl -fsS --max-time 15 "https://$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | tr -d '"' | tr -d "'")/health" >/dev/null || die "public health check failed after deploy"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'

say "deployment and health verification completed: $SHA"
echo "DEPLOYED $SHA"
