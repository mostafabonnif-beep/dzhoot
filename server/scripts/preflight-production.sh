#!/usr/bin/env bash

# DZ HOOF production preflight.
# This script validates configuration without printing secret values.

set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-$SERVER_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$SERVER_DIR/docker-compose.production.yml}"

failures=0

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  failures=$((failures + 1))
}

pass() {
  printf 'OK: %s\n' "$1"
}

if [[ ! -f "$ENV_FILE" ]]; then
  fail "environment file is missing: $ENV_FILE"
else
  if [[ "$(stat -c '%a' "$ENV_FILE")" != "600" ]]; then
    fail "environment file must have mode 600"
  else
    pass "environment file permissions are 600"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  fail "docker is not installed"
elif ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose plugin is not available"
else
  pass "Docker and Compose are available"
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  fail "compose file is missing: $COMPOSE_FILE"
fi

get_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n -E "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

require_value() {
  local key="$1"
  local value
  value="$(get_value "$key")"
  if [[ -z "$value" || "$value" == *CHANGE-ME* || "$value" == *your-* || "$value" == *example.com* || "$value" == *example.invalid* ]]; then
    fail "$key is empty or still contains a placeholder"
  fi
}

require_https_url() {
  local key="$1"
  local value
  value="$(get_value "$key")"
  if [[ "$value" != https://* ]]; then
    fail "$key must use HTTPS"
  fi
}

if [[ -f "$ENV_FILE" ]]; then
  for key in NODE_ENV DOMAIN ACME_EMAIL APP_URL PUBLIC_BASE_URL ALLOWED_ORIGINS \
    DOCKER_IMAGE DOCKER_FRONTEND_IMAGE MONGODB_URI REDIS_URL \
    JWT_ACCESS_SECRET JWT_REFRESH_SECRET XTREAM_SECRET_KEY PLAYBACK_TOKEN_SECRET \
    TOTP_ENCRYPTION_KEY SUPER_ADMIN_USERNAME SUPER_ADMIN_PASSWORD SUPER_ADMIN_EMAIL \
    SUPER_ADMIN_CHANNEL_LIST_CODE SUBSCRIPTION_REQUIRED; do
    require_value "$key"
  done

  [[ "$(get_value NODE_ENV)" == production ]] || fail "NODE_ENV must be production"
  [[ "$(get_value SUBSCRIPTION_REQUIRED)" == true ]] || fail "SUBSCRIPTION_REQUIRED must be true"
  [[ "$(get_value ALLOWED_ORIGINS)" != '*' ]] || fail "ALLOWED_ORIGINS must not be wildcard in production"

  for key in APP_URL PUBLIC_BASE_URL; do
    require_https_url "$key"
  done

  for key in DOCKER_IMAGE DOCKER_FRONTEND_IMAGE; do
    image_ref="$(get_value "$key")"
    if [[ "$image_ref" == *:latest || "$image_ref" != *:* ]]; then
      fail "$key must be pinned to a specific version tag, not ':latest' or an untagged image (deploys become irreproducible and rollback is unclear)"
    fi
  done

  admin_password="$(get_value SUPER_ADMIN_PASSWORD)"
  if (( ${#admin_password} < 16 )); then
    fail "SUPER_ADMIN_PASSWORD must be at least 16 characters"
  fi

  for key in JWT_ACCESS_SECRET JWT_REFRESH_SECRET XTREAM_SECRET_KEY PLAYBACK_TOKEN_SECRET TOTP_ENCRYPTION_KEY; do
    secret="$(get_value "$key")"
    if (( ${#secret} < 32 )); then
      fail "$key must be at least 32 characters"
    fi
  done
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && [[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]]; then
  rendered_config="$(mktemp)"
  chmod 600 "$rendered_config"
  trap 'rm -f "$rendered_config"' EXIT
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >"$rendered_config"; then
    pass "Compose configuration renders successfully"
  else
    fail "Compose configuration is invalid"
  fi
fi

if (( failures > 0 )); then
  printf 'Preflight failed with %d issue(s). No services were started.\n' "$failures" >&2
  exit 1
fi

printf 'Preflight passed. It is safe to review the rendered Compose plan before starting services.\n'
