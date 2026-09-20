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

# Read one variable out of the env file WITHOUT sourcing it.
#
# The script used to `set -a; . "$ENV_FILE"`, which executes the file as shell code.
# This env file legitimately holds values with unquoted spaces and commas —
# `MIRROR_DOMAIN=, iptv.5-196-51-152.sslip.io` — so sourcing it tried to run
# `iptv.5-196-51-152.sslip.io` as a command and the whole script died with exit 127
# before it ever looked at the disk (measured 2026-09-20 on the production host: the
# cron entry was installed and the alert could never fire). Two variables are all this
# script needs, so extract exactly those and leave the rest of the file alone.
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^${1}=//p" "$ENV_FILE" | tail -n 1 \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

ALERT_TELEGRAM_BOT_TOKEN="${ALERT_TELEGRAM_BOT_TOKEN:-$(env_value ALERT_TELEGRAM_BOT_TOKEN)}"
ALERT_CHAT_ID="${ALERT_CHAT_ID:-$(env_value ALERT_CHAT_ID)}"

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
