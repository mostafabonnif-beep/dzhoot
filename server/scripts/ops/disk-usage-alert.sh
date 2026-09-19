#!/usr/bin/env bash
# disk-usage-alert.sh — warn on Telegram before the disk fills up.
#
# Why: the production VPS runs MongoDB, restic-local and daily mongodumps on
# one volume. If it fills, MongoDB and atomic deploys stop silently. Backup
# alerts already exist; disk space had none (audit 2026-09-17, disk was 76%).
#
# Install (host, as root — nothing is installed by this repo automatically):
#   install -m 0755 disk-usage-alert.sh /usr/local/sbin/dzhoof-disk-usage-alert
#   printf '*/30 * * * * root /usr/local/sbin/dzhoof-disk-usage-alert\n' > /etc/cron.d/dzhoof-disk-usage-alert
#
# Config: reads ALERT_TELEGRAM_BOT_TOKEN / ALERT_CHAT_ID from
# /etc/dzhoot/.env.production (same variables the API alerting uses).
# Overrides: DISK_ALERT_THRESHOLD (default 85), DISK_ALERT_PATH (default /),
# DISK_ALERT_STATE (state file for the once-per-6h repeat limit).
set -Eeuo pipefail

THRESHOLD="${DISK_ALERT_THRESHOLD:-85}"
WATCH_PATH="${DISK_ALERT_PATH:-/}"
STATE_FILE="${DISK_ALERT_STATE:-/var/run/dzhoof-disk-alert.last}"
REPEAT_AFTER_SEC=21600 # re-alert at most every 6h while above threshold

ENV_FILE="${DZHOOF_ENV_FILE:-/etc/dzhoot/.env.production}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

USAGE_PCT="$(df -P "$WATCH_PATH" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
[ -n "${USAGE_PCT:-}" ] || { echo '[disk-alert][ABORT] could not read df usage' >&2; exit 1; }

if [ "$USAGE_PCT" -lt "$THRESHOLD" ]; then
  # Back below threshold: reset the repeat limiter so the next crossing alerts.
  rm -f "$STATE_FILE"
  exit 0
fi

NOW="$(date +%s)"
if [ -f "$STATE_FILE" ]; then
  LAST="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
  if [ $((NOW - LAST)) -lt "$REPEAT_AFTER_SEC" ]; then
    exit 0
  fi
fi

AVAIL_HUMAN="$(df -hP "$WATCH_PATH" | awk 'NR==2 {print $4}')"
MSG="⚠️ DZ HOOF disk alert: ${WATCH_PATH} is ${USAGE_PCT}% full (threshold ${THRESHOLD}%, ${AVAIL_HUMAN} free) on $(hostname). Consider: restic prune, deploy-artifact prune, docker image prune."

if [ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_CHAT_ID:-}" ]; then
  curl -fsS --max-time 15 \
    -d "chat_id=${ALERT_CHAT_ID}" \
    --data-urlencode "text=${MSG}" \
    "https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage" >/dev/null \
    && echo "$NOW" > "$STATE_FILE" \
    && echo "[disk-alert] telegram alert sent (usage ${USAGE_PCT}%)"
else
  echo "[disk-alert] ${MSG}" >&2
  echo '[disk-alert][ABORT] ALERT_TELEGRAM_BOT_TOKEN / ALERT_CHAT_ID not set' >&2
  exit 1
fi
