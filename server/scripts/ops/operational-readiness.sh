#!/usr/bin/env bash
# DZ HOOF operational readiness guard.
#
# Safe by default: this script only reads health, runtime, backup, and evidence
# metadata. It never prunes Docker, creates backups, restores a database, edits
# configuration, or starts/stops containers.
#
# Example:
#   ./scripts/ops/operational-readiness.sh
#   STRICT=true MAX_BACKUP_AGE_HOURS=26 ./scripts/ops/operational-readiness.sh
set -uo pipefail

BASE_URL="${BASE_URL:-https://iptv.ld-11.net}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/dzhoot/mongodb}"
FILESYSTEM_PATH="${FILESYSTEM_PATH:-/}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-26}"
MIN_DISK_FREE_MB="${MIN_DISK_FREE_MB:-10240}"
REQUIRE_RELEASE_METADATA="${REQUIRE_RELEASE_METADATA:-false}"
OFFSITE_BACKUP_EVIDENCE="${OFFSITE_BACKUP_EVIDENCE:-}"
MAX_OFFSITE_EVIDENCE_AGE_HOURS="${MAX_OFFSITE_EVIDENCE_AGE_HOURS:-168}"
RESTORE_DRILL_EVIDENCE="${RESTORE_DRILL_EVIDENCE:-}"
MAX_RESTORE_DRILL_AGE_DAYS="${MAX_RESTORE_DRILL_AGE_DAYS:-90}"
DZHOOF_CONTAINERS="${DZHOOF_CONTAINERS:-dzhoof-api dzhoof-frontend dzhoof-scheduler dzhoof-caddy dzhoof-mongodb dzhoof-redis}"
STRICT="${STRICT:-false}"

failures=0
warnings=0

say() { printf '[ops-readiness] %s\n' "$*"; }
ok() { printf '[ops-readiness][ok] %s\n' "$*"; }
warn() { printf '[ops-readiness][warn] %s\n' "$*" >&2; warnings=$((warnings + 1)); }
fail() { printf '[ops-readiness][fail] %s\n' "$*" >&2; failures=$((failures + 1)); }

is_positive_integer() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( "$1" > 0 ))
}

age_hours() {
  local path="$1"
  local now modified
  now=$(date +%s)
  modified=$(stat -c '%Y' "$path") || return 1
  printf '%s\n' $(( (now - modified) / 3600 ))
}

check_evidence() {
  local label="$1"
  local path="$2"
  local max_age_hours="$3"
  local age

  if [[ -z "$path" ]]; then
    warn "$label evidence path is not configured"
    return
  fi
  if [[ ! -f "$path" ]]; then
    fail "$label evidence file is missing: $path"
    return
  fi
  age=$(age_hours "$path") || { fail "cannot read $label evidence metadata"; return; }
  if (( age > max_age_hours )); then
    fail "$label evidence is stale (${age}h > ${max_age_hours}h)"
  else
    ok "$label evidence age=${age}h"
  fi
}

if ! is_positive_integer "$MAX_BACKUP_AGE_HOURS" || ! is_positive_integer "$MIN_DISK_FREE_MB" || \
   ! is_positive_integer "$MAX_OFFSITE_EVIDENCE_AGE_HOURS" || ! is_positive_integer "$MAX_RESTORE_DRILL_AGE_DAYS"; then
  echo 'readiness thresholds must be positive integers' >&2
  exit 2
fi

say "checking public health at $BASE_URL"
if ! command -v curl >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  fail 'curl and python3 are required for health validation'
else
  health_payload=$(curl -fsS --max-time 15 "$BASE_URL/health" 2>/dev/null) || health_payload=''
  if [[ -z "$health_payload" ]]; then
    fail 'public /health request failed'
  else
    health_values=$(printf '%s' "$health_payload" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    release = data.get("release") or {}
    print("\t".join([str(data.get("status", "")), str(data.get("version", "")), str(release.get("commit") or ""), str(release.get("builtAt") or "")]))
except Exception:
    sys.exit(1)
' 2>/dev/null) || health_values=''
    if [[ -z "$health_values" ]]; then
      fail 'public /health returned an invalid JSON payload'
    else
      IFS=$'\t' read -r health_status app_version release_commit release_built_at <<< "$health_values"
      if [[ "$health_status" == 'ok' ]]; then
        ok "public health status=ok version=${app_version:-unknown}"
      else
        fail "public health status=${health_status:-missing}"
      fi
      if [[ -n "$release_commit" && "$release_commit" != 'unknown' && -n "$release_built_at" && "$release_built_at" != 'unknown' ]]; then
        ok "release metadata commit=$release_commit builtAt=$release_built_at"
      elif [[ "$REQUIRE_RELEASE_METADATA" == 'true' ]]; then
        fail 'release metadata is required but missing or unknown'
      else
        warn 'release metadata is missing or unknown; deploy the release-traceability change before requiring it'
      fi
    fi
  fi
fi

say "checking disk capacity for $FILESYSTEM_PATH"
if disk_line=$(df -Pm "$FILESYSTEM_PATH" 2>/dev/null | awk 'NR==2 {print $4 "\t" $5}'); then
  IFS=$'\t' read -r free_mb used_percent <<< "$disk_line"
  if [[ "$free_mb" =~ ^[0-9]+$ ]] && (( free_mb >= MIN_DISK_FREE_MB )); then
    ok "disk free=${free_mb}MB used=${used_percent}"
  else
    fail "disk free=${free_mb:-unknown}MB is below minimum ${MIN_DISK_FREE_MB}MB (used=${used_percent:-unknown})"
  fi
else
  fail "cannot inspect filesystem $FILESYSTEM_PATH"
fi

say "checking backup freshness in $BACKUP_DIR"
latest_backup=''
if [[ -d "$BACKUP_DIR" ]]; then
  latest_backup=$(find "$BACKUP_DIR" -maxdepth 2 -type f \( -name 'dzhoot-mongodb-*.archive.gz' -o -name 'dzhoof-iptv.archive.gz' \) -printf '%T@\t%p\n' 2>/dev/null | sort -nr | head -n 1 | cut -f2-)
fi
if [[ -z "$latest_backup" || ! -f "$latest_backup" ]]; then
  fail 'no MongoDB backup archive was found'
else
  backup_age=$(age_hours "$latest_backup") || backup_age=''
  if [[ "$backup_age" =~ ^[0-9]+$ ]] && (( backup_age <= MAX_BACKUP_AGE_HOURS )); then
    ok "latest backup=$(basename "$latest_backup") age=${backup_age}h"
  else
    fail "latest backup is stale (${backup_age:-unknown}h > ${MAX_BACKUP_AGE_HOURS}h)"
  fi

  sums_file="$(dirname "$latest_backup")/SHA256SUMS"
  if [[ -f "$sums_file" ]]; then
    if (cd "$(dirname "$latest_backup")" && sha256sum -c "$(basename "$sums_file")") >/dev/null 2>&1; then
      ok 'latest backup directory checksum verification passed'
    else
      fail 'backup checksum verification failed'
    fi
  else
    warn 'latest backup has no adjacent SHA256SUMS file'
  fi
fi

check_evidence 'off-site backup' "$OFFSITE_BACKUP_EVIDENCE" "$MAX_OFFSITE_EVIDENCE_AGE_HOURS"
check_evidence 'restore drill' "$RESTORE_DRILL_EVIDENCE" "$((MAX_RESTORE_DRILL_AGE_DAYS * 24))"

say 'checking required Docker containers'
if ! command -v docker >/dev/null 2>&1; then
  warn 'docker is unavailable; container health checks were skipped'
else
  for container in $DZHOOF_CONTAINERS; do
    container_state=$(docker inspect -f '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}' "$container" 2>/dev/null) || {
      fail "container missing or unreadable: $container"
      continue
    }
    IFS='|' read -r running health restarts <<< "$container_state"
    if [[ "$running" != 'true' ]]; then
      fail "container not running: $container"
      continue
    fi
    if [[ "$health" == 'unhealthy' ]]; then
      fail "container unhealthy: $container"
      continue
    fi
    if [[ "$restarts" =~ ^[0-9]+$ ]] && (( restarts > 0 )); then
      warn "container restart count=${restarts}: $container"
    else
      ok "container running: $container health=$health"
    fi
  done
fi

printf '\n[ops-readiness] failures=%d warnings=%d\n' "$failures" "$warnings"
if (( failures > 0 )); then
  exit 1
fi
if [[ "$STRICT" == 'true' && "$warnings" -gt 0 ]]; then
  exit 2
fi
exit 0
