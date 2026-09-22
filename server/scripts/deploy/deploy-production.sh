#!/usr/bin/env bash
# DZ HOOF production deploy (audit-remediation-v1) — THE PRECISE PLAN.
#
# This script is the exact, reviewable deploy procedure for the production
# server (5.196.51.152). It is intentionally SAFE-BY-DEFAULT:
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

# Compose project: the running stack was created under `dzhoot`. Derived from the
# release directory it would be `server`, and the hard-coded `container_name`s then
# collide (deploy failures of 2026-09-19 and 2026-09-21). Pin it so the project can
# never again depend on the directory the deploy runs from; an operator can still
# override it explicitly.
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dzhoot}"

cd "$(dirname "$0")/../.." || exit 1

say() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
step() { printf '\033[1;36m[deploy] %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[deploy][ABORT]\033[0m %s\n' "$*"; exit 1; }

# redact <text>: mask credentials embedded in URIs (mongodb://user:pass@host,
# redis://:pass@host, ...) so dry-run output can never leak the DB password to
# the terminal or logs. Only the userinfo password is replaced.
redact() {
  printf '%s' "$1" | sed -E 's#([[:alnum:]][[:alnum:]+.-]*://[^:/@[:space:]]*:)[^@[:space:]]*@#\1***@#g'
}

# run <step-label> <command...>: executes the command ONLY in --apply mode;
# in dry-run mode it prints what would run (credentials redacted). This keeps
# dry-run truly read-only and safe to paste into a ticket/chat.
run() {
  local label="$1"; shift
  if [ "$APPLY" -eq 1 ]; then
    "$@"
  else
    say "[dry-run] $label: $(redact "$*")"
  fi
}

# Mutual exclusion with atomic-deploy.sh, which already holds this lock and marks
# it via DZHOOF_DEPLOY_LOCK_HELD=1. Only a standalone invocation takes it; a child
# must not re-acquire the same lock on a fresh descriptor or it deadlocks its own
# parent. This is what stops two deploys from interleaving the container swap.
if [ "$APPLY" -eq 1 ] && [ "${DZHOOF_DEPLOY_LOCK_HELD:-0}" != "1" ]; then
  DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-/run/lock/dzhoof-deploy.lock}"
  exec 9>"$DEPLOY_LOCK_FILE"
  flock -n 9 || die "another deploy already holds $DEPLOY_LOCK_FILE — refusing to start a concurrent deploy"
  say "deploy lock acquired: $DEPLOY_LOCK_FILE"
fi

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
# Mongo has been auth-protected since 2026-08-30. The old unauthenticated URI
# silently produced 23-byte (empty) archives on every deploy. Pull the app's
# authenticated URI from the running API container so the pre-deploy backup is
# real, and fail the deploy if the backup cannot be verified (no silent gaps).
MONGODB_URI_BACKUP="$(docker exec dzhoof-api printenv MONGODB_URI 2>/dev/null || true)"
if [ -z "$MONGODB_URI_BACKUP" ]; then
  die "could not obtain authenticated MONGODB_URI from dzhoof-api — refusing to deploy without a verifiable backup"
fi
run "mongodump" docker exec dzhoof-mongodb mongodump --uri="$MONGODB_URI_BACKUP" --gzip --archive=/tmp/deploy.archive.gz || die "mongodump failed — refusing to deploy without a verifiable backup"
run "copy archive" docker cp dzhoof-mongodb:/tmp/deploy.archive.gz "$OUT/dzhoof-iptv.archive.gz" || die "failed to copy backup archive to $OUT"
run "cleanup tmp" docker exec dzhoof-mongodb rm -f /tmp/deploy.archive.gz || true
run "checksum" sh -c "cd '$OUT' && sha256sum dzhoof-iptv.archive.gz > SHA256SUMS && sha256sum -c SHA256SUMS" || die "backup checksum verification failed"
# A real archive is far larger than 1KB; the pre-fix empty backups were 23 bytes.
run "archive sanity" sh -c "test \"\$(stat -c %s '$OUT/dzhoof-iptv.archive.gz')\" -gt 1024" || die "backup archive is suspiciously small — refusing to deploy"
say "backup target: $OUT"

step "3/7  Build images (tagged, not latest) + promote :current"
APP_VERSION="$(sed -n 's/^APP_VERSION=//p' "$ENV_FILE" | tail -n 1)"
APP_VERSION="${APP_VERSION:-1.0.1}"
RELEASE_COMMIT="${RELEASE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || cat .commit 2>/dev/null || echo unknown)}"
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
run "build frontend" docker build -f Dockerfile.frontend --build-arg "APP_VERSION=${APP_VERSION}" --build-arg "RELEASE_COMMIT=${RELEASE_COMMIT}" --build-arg "RELEASE_BUILT_AT=${RELEASE_BUILT_AT}" --build-arg "NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL:-https://iptv.ld-11.net}" -t "dzhoof-frontend:${BUILD_TAG}" . || die "frontend build failed"
run "tag frontend current" docker tag "dzhoof-frontend:${BUILD_TAG}" "dzhoof-frontend:current" || die "frontend tag failed"

# Identity of the image just built. A commit SHA is not enough: two builds of the
# same commit produce different images, and only the image id proves which bytes are
# running. Persisted into ENV_FILE below so /health/version can be checked after the
# fact, and so a rollback restores the right pair.
RELEASE_IMAGE_ID="$(docker inspect -f '{{.Id}}' dzhoof-api:current 2>/dev/null || true)"
# A missing id must stop the deploy, not silently keep the previous value in ENV_FILE:
# two builds of the same commit would then compare equal at the verification step below
# and a rebuild could masquerade as the reviewed release.
[ -n "$RELEASE_IMAGE_ID" ] || die "could not read the id of dzhoof-api:current — cannot record the release image"
RELEASE_IMAGE_DIGEST="$(docker inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' dzhoof-api:current 2>/dev/null | head -n 1 || true)"
RELEASE_FRONTEND_IMAGE_ID="$(docker inspect -f '{{.Id}}' dzhoof-frontend:current 2>/dev/null || true)"
export RELEASE_IMAGE_ID RELEASE_IMAGE_DIGEST RELEASE_FRONTEND_IMAGE_ID
say "release images: api=${RELEASE_IMAGE_ID:-<unknown>} frontend=${RELEASE_FRONTEND_IMAGE_ID:-<unknown>} digest=${RELEASE_IMAGE_DIGEST:-<none>}"

step "3b/7  Point compose at :current (old refs recorded above for rollback)"
if [ "$APPLY" -eq 1 ]; then
  # Back up the env file (0600) before the in-place sed rewrites, so a bad edit
  # can be recovered. Timestamped per deploy; only when the file exists.
  if [ -f "$ENV_FILE" ]; then
    ENV_BACKUP="${ENV_FILE}.bak-${STAMP}"
    install -m 600 "$ENV_FILE" "$ENV_BACKUP"
    say "ENV_FILE backup: $ENV_BACKUP"
  fi
  sed -i "s|^DOCKER_IMAGE=.*|DOCKER_IMAGE=dzhoof-api:current|" "$ENV_FILE"
  sed -i "s|^DOCKER_FRONTEND_IMAGE=.*|DOCKER_FRONTEND_IMAGE=dzhoof-frontend:current|" "$ENV_FILE"
  say "ENV_FILE updated to dzhoof-api:current / dzhoof-frontend:current"
  # Persist the release provenance into the env file as well. compose resolves
  # RELEASE_COMMIT/RELEASE_BUILT_AT from --env-file, so a later manual
  # `docker compose up -d` (which does not export them) would otherwise
  # re-apply a stale value and make /health report the wrong commit — and any
  # `release trace health` check would fail (observed 2026-09-13).
  if [ "$RELEASE_COMMIT" != "unknown" ]; then
    if grep -q '^RELEASE_COMMIT=' "$ENV_FILE"; then
      sed -i "s|^RELEASE_COMMIT=.*|RELEASE_COMMIT=${RELEASE_COMMIT}|" "$ENV_FILE"
    else
      printf 'RELEASE_COMMIT=%s\n' "$RELEASE_COMMIT" >> "$ENV_FILE"
    fi
    if grep -q '^RELEASE_BUILT_AT=' "$ENV_FILE"; then
      sed -i "s|^RELEASE_BUILT_AT=.*|RELEASE_BUILT_AT=${RELEASE_BUILT_AT}|" "$ENV_FILE"
    else
      printf 'RELEASE_BUILT_AT=%s\n' "$RELEASE_BUILT_AT" >> "$ENV_FILE"
    fi
    # Image identity, for the same reason: a manual `docker compose up -d` resolves
    # the release metadata from this file, and /health/version must keep reporting
    # the image that is actually running.
    persist_env() {
      local key="$1" value="$2"
      [ -n "$value" ] || return 0
      if grep -q "^${key}=" "$ENV_FILE"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
      else
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
      fi
    }
    persist_env RELEASE_IMAGE_ID "$RELEASE_IMAGE_ID"
    persist_env RELEASE_IMAGE_DIGEST "$RELEASE_IMAGE_DIGEST"
    persist_env RELEASE_FRONTEND_IMAGE_ID "$RELEASE_FRONTEND_IMAGE_ID"
    say "release metadata persisted to ENV_FILE (${RELEASE_COMMIT})"
  fi
else
  say "[dry-run] would update $ENV_FILE to dzhoof-api:current / dzhoof-frontend:current"
fi

step "4/7  Compose up (api, frontend, scheduler) — caddy/mongo/redis untouched"
run "compose up" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps api frontend scheduler

step "4b/7  Apply the Caddyfile from this release"
# A bind mount is anchored to the inode resolved when the container STARTED, while the
# atomic deploy swaps release directories by renaming. The running Caddy therefore kept
# reading the Caddyfile of a release that had long been moved to .previous-* — every
# reload re-applied the OLD config, reported success, and the change was silently
# inactive (measured 2026-09-15: `docker exec dzhoof-caddy grep -c documentRoute
# /etc/caddy/Caddyfile` = 0 while the active release had it; docker inspect still
# prints the current path, which is what makes this so easy to miss).
#
# So: validate the NEW file first (copied into the container), then recreate the caddy
# container so the mount resolves against the release that is active now. Recreating
# costs a few seconds of downtime and is the only way the mount follows the swap; a
# plain SIGUSR1 reload cannot fix a stale mount. Extra networks the operator attached
# by hand (e.g. the neighbouring dz1-tv stack) are re-attached right away instead of
# waiting for the host's watchdog timer.
if [ "$APPLY" -eq 1 ]; then
  # Everything is compared INSIDE the container: a host path does not exist in the
  # container namespace, and `cmp` against a missing file reports "different", which
  # is how an earlier version of this check aborted a perfectly good deploy with
  # "caddy still does not read this release's Caddyfile".
  copy_release_caddyfile() {
    docker cp "$PWD/Caddyfile" dzhoof-caddy:/tmp/Caddyfile.release
  }

  copy_release_caddyfile || die "could not copy the release Caddyfile into the caddy container"
  run "caddy validate (release file)" docker exec dzhoof-caddy caddy validate --config /tmp/Caddyfile.release --adapter caddyfile \
    || die "the Caddyfile in this release is invalid — refusing to continue"

  # Content equality is not enough: the mount is anchored to the inode it resolved at
  # container start, so a container can read a file that is byte-identical to the
  # release's yet lives in a directory the atomic swap moved to .previous-*/.failed-*.
  # Compare inodes too — the container sees the host inode through the bind mount
  # (measured on 2026-09-15: container inode 564445 vs release inode 262990, identical
  # content, mount still anchored to the failed release).
  RELEASE_INODE="$(stat -c %i "$PWD/Caddyfile")"
  CONTAINER_INODE="$(docker exec dzhoof-caddy stat -c %i /etc/caddy/Caddyfile 2>/dev/null || echo '?')"

  if docker exec dzhoof-caddy cmp -s /etc/caddy/Caddyfile /tmp/Caddyfile.release \
     && [ "$CONTAINER_INODE" = "$RELEASE_INODE" ]; then
    say "Caddy already serves this release's Caddyfile (inode $RELEASE_INODE) — no recreate needed"
  else
    say "Caddy does not serve this release's Caddyfile (container inode $CONTAINER_INODE, release inode $RELEASE_INODE) — recreating it"
    run "recreate caddy" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps --force-recreate caddy \
      || die "could not recreate the caddy container"
    run "sleep" sleep 5
    # Re-attach any network that is not in this compose file (dz1-tv-internal, …).
    if [ -x /usr/local/sbin/ensure-dz1tv-caddy-net.sh ]; then
      run "reattach auxiliary networks" /usr/local/sbin/ensure-dz1tv-caddy-net.sh || say "WARNING: network reattach failed"
    fi
    run "caddy running" sh -c 'docker inspect -f "{{.State.Running}}" dzhoof-caddy | grep -qx true' \
      || die "caddy is not running after the recreate"
    copy_release_caddyfile || die "could not copy the release Caddyfile into the recreated container"
    run "caddy serves the release file" docker exec dzhoof-caddy cmp -s /etc/caddy/Caddyfile /tmp/Caddyfile.release \
      || die "caddy still does not serve this release's Caddyfile"
  fi
  say "Caddyfile applied from $PWD/Caddyfile"
else
  say "[dry-run] would validate the release Caddyfile and recreate caddy if its bind mount is stale"
fi

step "5/7  Health verification"
run "sleep" sleep 20
# Health is verified via the public HTTPS endpoint (through Caddy) and directly
# via the API container healthcheck. Do NOT use http://127.0.0.1/health here:
# Caddy's automatic HTTPS redirect answers 308 on :80, which would abort every
# deploy even when the stack is perfectly healthy.
DOMAIN="$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | tr -d '"' | tr -d "'")"
[ -n "$DOMAIN" ] || die "DOMAIN missing from $ENV_FILE — cannot verify public health"
run "docker health api" sh -c 'docker inspect -f "{{.State.Health.Status}}" dzhoof-api | grep -qx healthy' || die "dzhoof-api not healthy after compose up"
run "public health" curl -fsS "https://${DOMAIN}/health" || die "public health check failed after deploy"
if [ "$RELEASE_COMMIT" != "unknown" ]; then
  run "release trace health" sh -c "curl -fsS 'https://${DOMAIN}/health' | grep -F '\"commit\":\"${RELEASE_COMMIT}\"' >/dev/null" \
    || die "the running API does not report the deployed commit (${RELEASE_COMMIT})"
fi
# The commit alone does not prove which image is running (a rebuild of the same
# commit is a different image). Compare the image id the build just produced.
if [ -n "${RELEASE_IMAGE_ID:-}" ]; then
  run "release trace image" sh -c "curl -fsS 'https://${DOMAIN}/health/version' | grep -F '\"imageId\":\"${RELEASE_IMAGE_ID}\"' >/dev/null" \
    || die "the running API does not report the image that was just built (${RELEASE_IMAGE_ID})"
fi
run "details health" sh -c "curl -fsS 'https://${DOMAIN}/health?details=true' | head -c 400; echo"
# Full post-deploy smoke: the four health endpoints, the update contract (an offered
# update must carry a verifiable checksum), the public page, the admin shell and the
# static chunks the served HTML references. A failure here fails the deploy, which
# makes atomic-deploy.sh restore the previous release.
SMOKE_ENV=(DZHOOF_DOMAIN="$DOMAIN")
if [ "$RELEASE_COMMIT" != "unknown" ]; then SMOKE_ENV+=(EXPECTED_COMMIT="$RELEASE_COMMIT"); fi
if [ -n "${RELEASE_IMAGE_ID:-}" ]; then SMOKE_ENV+=(EXPECTED_IMAGE_ID="$RELEASE_IMAGE_ID"); fi
run "post-deploy smoke test" env "${SMOKE_ENV[@]}" ./scripts/deploy/smoke-test.sh \
  || die "post-deploy smoke test failed — the release is not healthy"
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
