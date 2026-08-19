#!/usr/bin/env bash
# DZ HOOF periodic health check (audit-remediation-v1) — cron-able.
#
# Hits /health (and ?details=true), validates the payload, and reports failures
# to a webhook (Telegram/Slack/any) when ALERT_WEBHOOK_URL is configured.
# Safe to run every minute from cron:
#   * * * * * /opt/dzhoot/server/scripts/ops/health-check.sh >> /var/log/dzhoof-health.log 2>&1
set -uo pipefail

BASE_URL="${BASE_URL:-https://iptv.ld-11.net}"
ALERT_URL="${ALERT_WEBHOOK_URL:-}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

payload="$(curl -fsS --max-time 15 "$BASE_URL/health" 2>"$TMP")" || {
  msg="DZ HOOF health check FAILED (HTTP/network): $(cat "$TMP")"
  echo "$(date -u +%FT%TZ) $msg"
  [ -n "$ALERT_URL" ] && curl -fsS --max-time 10 -H 'Content-Type: application/json' \
    -d "{\"text\":\"$msg\"}" "$ALERT_URL" >/dev/null 2>&1
  exit 1
}

status="$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","?"))' 2>/dev/null)"
version="$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version","?"))' 2>/dev/null)"
if [ "$status" = "ok" ]; then
  echo "$(date -u +%FT%TZ) OK version=$version"
  exit 0
fi

msg="DZ HOOF health DEGRADED: $payload"
echo "$(date -u +%FT%TZ) $msg"
[ -n "$ALERT_URL" ] && curl -fsS --max-time 10 -H 'Content-Type: application/json' \
  -d "{\"text\":\"$msg\"}" "$ALERT_URL" >/dev/null 2>&1
exit 2
