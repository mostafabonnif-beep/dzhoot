#!/usr/bin/env bash
# DZ HOOF deploy preflight (audit-remediation-v1).
# Read-only: validates the local checkout + .env + compose before touching a
# server. Fails with a non-zero exit code on any blocking problem.
#
# Usage:
#   ENV_FILE=/etc/dzhoot/.env.production ./scripts/deploy/preflight.sh
#   ENV_FILE=server/.env ./scripts/deploy/preflight.sh  (local/staging)
set -uo pipefail

ENV_FILE="${ENV_FILE:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
failures=0
warnings=0

say()  { printf '\033[1;34m[preflight]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[preflight][FAIL]\033[0m %s\n' "$*"; failures=$((failures + 1)); }
warn() { printf '\033[1;33m[preflight][WARN]\033[0m %s\n' "$*"; warnings=$((warnings + 1)); }
ok()   { printf '\033[1;32m[preflight][ok]\033[0m %s\n' "$*"; }

cd "$(dirname "$0")/../.." || exit 1

# ── 1. Secrets must not be committed ─────────────────────────────────────────
say "Checking for committed secrets…"
for bad in '.env' 'local.properties' 'google-services.json' '*.keystore' '*.jks' '*.pem' '*.key'; do
  # shellcheck disable=SC2046
  found=$(git ls-files 2>/dev/null | grep -E "(^|/)${bad}$" || true)
  if [ -n "$found" ]; then
    fail "committed secret-like file: ${found}"
  fi
done
# .env.example is fine; a real .env in the tree is not.
if git ls-files 2>/dev/null | grep -qE '(^|/)\.env$'; then
  fail "a real .env is tracked in git — move it out of the repo and chmod 600"
fi

# ── 2. Environment file ──────────────────────────────────────────────────────
if [ -n "$ENV_FILE" ]; then
  say "Validating $ENV_FILE…"
  [ -f "$ENV_FILE" ] || { fail "ENV_FILE not found: $ENV_FILE"; exit 1; }
  [ "$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')" = "600" ] || warn "ENV_FILE permissions are not 0600 (chmod 600 $ENV_FILE)"
  if ! grep -qE '^NODE_ENV=production' "$ENV_FILE"; then
    warn "NODE_ENV=production not set in $ENV_FILE"
  fi
  if grep -qE '^ALLOWED_ORIGINS=\*' "$ENV_FILE"; then
    fail "ALLOWED_ORIGINS=* is not allowed — use explicit HTTPS origins"
  fi
  for key in JWT_ACCESS_SECRET JWT_REFRESH_SECRET PLAYBACK_TOKEN_SECRET XTREAM_SECRET_KEY TOTP_ENCRYPTION_KEY SUPER_ADMIN_PASSWORD; do
    val=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
    case "$val" in
      ''|*'CHANGE-ME'*|*'change-me'*|*'your-'*) fail "${key} is empty/placeholder" ;;
    esac
    [ "${#val}" -lt 32 ] && [ "$key" != "SUPER_ADMIN_PASSWORD" ] && [ -n "$val" ] && fail "${key} shorter than 32 chars"
  done
else
  warn "ENV_FILE not provided — skipping env validation (pass ENV_FILE=/path/to/.env.production)"
fi

# ── 3. Compose sanity ────────────────────────────────────────────────────────
say "Validating compose file $COMPOSE_FILE…"
if command -v docker >/dev/null 2>&1; then
  if docker compose -f "$COMPOSE_FILE" config >/dev/null 2>&1; then
    ok "compose config parses"
  else
    fail "compose config failed — run: docker compose -f $COMPOSE_FILE config"
  fi
  # Images must be explicitly tagged (no floating 'latest' for the stack).
  for img in $(docker compose -f "$COMPOSE_FILE" config 2>/dev/null | grep -E '^\s+image:' | sed -E 's/.*image: //'); do
    case "$img" in
      *':latest') fail "floating image tag latest: $img" ;;
      *'@sha256:'*) : ;; # Immutable digests are allowed.
      *':') fail "image has no tag: $img" ;;
    esac
  done
else
  warn "docker CLI not available — skipping compose validation"
fi

# ── 4. Repository hygiene ────────────────────────────────────────────────────
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  say "Repository state…"
  branch=$(git branch --show-current)
  [ "$branch" = "release/audit-remediation-v1" ] || [ "$branch" = "main" ] || [ "$branch" = "develop" ] || warn "on unexpected branch: ${branch:-detached}"
else
  warn "not a git checkout"
fi

echo ""
if [ "$failures" -gt 0 ]; then
  printf '\033[1;31m[preflight] FAILED with %d blocking problem(s) — fix before deploying\033[0m\n' "$failures"
  exit 1
fi
if [ "$warnings" -gt 0 ]; then
  printf '\033[1;33m[preflight] PASSED with %d warning(s)\033[0m\n' "$warnings"
else
  printf '\033[1;32m[preflight] ALL CHECKS PASSED\033[0m\n'
fi
exit 0
