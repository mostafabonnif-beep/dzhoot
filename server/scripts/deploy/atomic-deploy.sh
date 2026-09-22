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
# Where deploy outcomes are recorded. `deploy-production.sh` writes the success rows;
# this script adds the failure rows (see rollback()).
DEPLOY_LOG="${DEPLOY_LOG:-/var/log/dzhoof-deploys.log}"
FAILED="${ACTIVE}.failed-${STAMP}"
SOURCE_BACKUP="/var/backups/dzhoot/source/pre-${SHA}-${STAMP}.tar.gz"
APPLY="${APPLY:-0}"
SWAPPED=0
API_IMAGE_ID=""
FRONTEND_IMAGE_ID=""

say() { printf '[atomic-deploy] %s\n' "$*"; }
die() {
  printf '[atomic-deploy][ABORT] %s\n' "$*" >&2
  # An explicit exit does NOT fire the ERR trap, so a die() here would
  # otherwise skip the rollback and leave production on a broken release
  # (seen 2026-08-30: API crash-looped with 'find requires authentication'
  # because the swapped-in repo compose dropped the mongo auth URI).
  # Pass the real status explicitly: inside rollback() the first command is a
  # printf, so `$?` would read 0 and rollback would exit 0 (success).
  rollback 1
  exit 1
}

# rollback [status]
#   Called by the ERR trap with no arguments ($? still holds the failing
#   command's status), or explicitly by die() with the real status. It only
#   exits on the trap path; on the die() path it returns so die() can exit 1.
rollback() {
  code="${1:-$?}"
  # Record the failure. `deploy-production.sh` appends a row only when it reaches step 7/7
  # "Record deploy", so a deploy that fails and rolls back leaves nothing in
  # /var/log/dzhoof-deploys.log — the rollback did its job and no trace of why survived. That
  # is how three failed deploys on 2026-09-15 became invisible. The row uses the same five
  # tab-separated columns as a success row with `FAILED` in the tag column, so `grep FAILED`
  # finds every failed deploy next to the ones that worked. Logging must never break the
  # rollback: failures here are swallowed.
  printf '%s\tFAILED\t%s\t-\tatomic-deploy abort (exit %s%s)\n' \
    "$(date -u +%FT%TZ)" "${SHA:-unknown}" "$code" \
    "$([ "${SWAPPED:-0}" -eq 1 ] && printf ', production source swapped and restored')" \
    >> "$DEPLOY_LOG" 2>/dev/null || true
  if [ "$SWAPPED" -eq 1 ]; then
    say "deployment failed (exit ${code}); restoring source and running images"
    if [ -n "$API_IMAGE_ID" ]; then docker tag "$API_IMAGE_ID" dzhoof-api:current || true; fi
    if [ -n "$FRONTEND_IMAGE_ID" ]; then docker tag "$FRONTEND_IMAGE_ID" dzhoof-frontend:current || true; fi
    if [ -d "$ACTIVE" ]; then mv "$ACTIVE" "$FAILED" || true; fi
    if [ -d "$PREVIOUS" ]; then mv "$PREVIOUS" "$ACTIVE" || true; fi
    # The failed deploy rewrote the release metadata in ENV_FILE (RELEASE_COMMIT,
    # RELEASE_BUILT_AT and the image ids). Without restoring it, the *rolled-back*
    # release keeps reporting the failed commit from /health — production lying about
    # what it actually runs, which is the very thing the provenance work exists to
    # prevent (observed 2026-09-15, twice). deploy-production.sh takes a timestamped
    # copy before its rewrites; put the newest one back.
    ENV_BACKUP="$(ls -1t "${ENV_FILE}".bak-* 2>/dev/null | head -1 || true)"
    if [ -n "$ENV_BACKUP" ] && [ "$ENV_BACKUP" -nt "$PREVIOUS" ]; then
      if cp "$ENV_BACKUP" "$ENV_FILE"; then
        say "restored release metadata in ENV_FILE from $ENV_BACKUP"
      else
        say "WARNING: could not restore $ENV_FILE from $ENV_BACKUP — /health may report the failed commit"
      fi
    fi
    if [ -d "$ACTIVE" ]; then
      # Do not retain release metadata from the failed deploy when starting the
      # restored source. Older releases fall back to compose's safe `unknown` value.
      unset RELEASE_COMMIT RELEASE_BUILT_AT
      cd "$ACTIVE/server"
      docker compose -f docker-compose.production.yml --env-file "$ENV_FILE" up -d --no-deps api frontend scheduler || true
      # Caddy keeps the config it loaded when its container started, and the failed
      # deploy may have recreated it against the release that was active then. Reload
      # so the restored release is the one actually served.
      docker kill --signal=USR1 dzhoof-caddy >/dev/null 2>&1 || say "WARNING: could not reload caddy after rollback"
    fi
  fi
  # Only the ERR-trap path exits here; die() owns the exit status (1) when it
  # calls rollback explicitly, so a failed deploy can never report success.
  if [ "$#" -eq 0 ]; then
    exit "$code"
  fi
  return 0
}
trap rollback ERR

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -d "$RELEASE" ] || die "staged release missing: $RELEASE — run scripts/deploy/stage-release.sh $SHA first"
[ -f "$RELEASE/server/docker-compose.production.yml" ] || die "invalid staged release: $RELEASE"
[ -f "$ENV_FILE" ] || die "environment file missing: $ENV_FILE"
[ "$(stat -c '%a' "$ENV_FILE")" = "600" ] || die "environment file permissions must be 600: $ENV_FILE"

say "target release: $RELEASE"
say "environment: $ENV_FILE"

# Provenance gate (2026-09-15): a staged SHA is not proof that the commit is
# deployable. Refuse anything that is not an ancestor of an approved ref, and
# anything whose required CI workflows are not green — production was running a
# commit whose `DZ HOOF CI` (android) run had failed or been cancelled, and the
# swap had no way to notice. Override only deliberately:
#   ALLOW_UNVERIFIED_REF=1 (lineage) / REQUIRE_CI=0 (CI) / APPROVED_REFS=...
# Runs only for a real deploy: a dry-run must stay usable on a host with no egress.
if [ "$APPLY" -ne 1 ]; then
  say "DRY-RUN — nothing will change. Re-run with APPLY=1 to execute."
  say "plan: pre-deploy health gate -> provenance gate -> source backup -> swap $ACTIVE -> deploy-production.sh --apply -> health verification -> post-deploy smoke -> rollback on failure"
  echo "DRY-RUN $SHA"
  exit 0
fi

# Single-flight deploys: two concurrent atomic-deploy runs can interleave the
# /opt/dzhoot swap and corrupt the active release — there is no other mutual
# exclusion on this host, and more than one operator/agent works on it. flock(1)
# holds an exclusive advisory lock for the lifetime of this process; the second
# runner gets an immediate, clear refusal instead of a corrupted swap. The lock is
# taken before the first real step (provenance), not only before the swap, so a
# queued deploy cannot race the health gate either.
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-/run/lock/dzhoof-deploy.lock}"
exec 9>"$DEPLOY_LOCK_FILE"
if ! flock -n 9; then
  # Refuse without die(): nothing has happened yet, so the ERR-trap rollback (and a
  # misleading FAILED row in the deploy log) must not fire — this is a clean
  # rejection of a concurrent run, not a failed deploy.
  printf '[atomic-deploy][REFUSED] another deploy already holds %s\n' "$DEPLOY_LOCK_FILE" >&2
  exit 1
fi
say "deploy lock acquired: $DEPLOY_LOCK_FILE"
# Tell the child deploy-production.sh the lock is already held, so it does not try
# to take the same lock on a new descriptor and deadlock against its own parent.
export DZHOOF_DEPLOY_LOCK_HELD=1
# The compose stack on this host was created under project `dzhoot`. Derived from
# the release directory it would be `server`, and the hard-coded `container_name`s
# then collide (deploy failures of 2026-09-19 and 2026-09-21). Pin it so the
# project can never again depend on the directory the deploy happens to run from.
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dzhoot}"

say "verifying release provenance for $SHA"
"$(dirname "$0")/verify-commit-provenance.sh" "$SHA" \
  || die "commit $SHA is not proven deployable — refusing to swap it into production"

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

# Production operator overrides: the deployed docker-compose.production.yml may
# carry environment-specific hardening (mongo --auth + credentials, redis
# requirepass, shared-network wiring) that is intentionally NOT in the repo.
# If the operator keeps that file at PROD_COMPOSE_OVERRIDE (default
# /etc/dzhoot/docker-compose.production.yml), apply it to the release BEFORE
# compose up — otherwise a fresh tarball compose (no auth) would make the API
# crash-loop against an auth-enabled mongo (seen 2026-08-30: rollback skipped).
PROD_COMPOSE_OVERRIDE="${PROD_COMPOSE_OVERRIDE:-/etc/dzhoot/docker-compose.production.yml}"
if [ -f "$PROD_COMPOSE_OVERRIDE" ]; then
  say "applying production compose override: $PROD_COMPOSE_OVERRIDE"
  install -m 644 "$PROD_COMPOSE_OVERRIDE" "$ACTIVE/server/docker-compose.production.yml"
else
  say "no production compose override at $PROD_COMPOSE_OVERRIDE — deploying the repo compose as-is"
fi

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

# Post-deploy smoke. This script's own DRY-RUN plan has advertised a "post-deploy smoke"
# step since it was written, but the code path above only checked container health and
# /health — so a release could pass the gate with a broken update contract, a mixed-version
# chunk set, or an HTML page cached for a year, and the rollback below would never see it.
# `smoke-test.sh` asserts exactly those (18+ checks, each failing closed); it was only ever
# run by hand. Exit non-zero here and the automatic rollback takes over.
SMOKE_DOMAIN="$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | tr -d '"' | tr -d "'")"
if [ -x ./scripts/deploy/smoke-test.sh ]; then
  say "post-deploy smoke test"
  DZHOOF_DOMAIN="$SMOKE_DOMAIN" ./scripts/deploy/smoke-test.sh \
    || die "post-deploy smoke test failed — rolling back"
else
  say "WARNING: scripts/deploy/smoke-test.sh is missing or not executable; post-deploy verification skipped"
fi

say "deployment and health verification completed: $SHA"
echo "DEPLOYED $SHA"
