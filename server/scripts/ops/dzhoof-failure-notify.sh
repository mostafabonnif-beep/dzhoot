#!/usr/bin/env bash
# dzhoof-failure-notify — tell a human when a dzhoof systemd unit fails.
#
# Why this exists: the previous version read ALERT_WEBHOOK_URL out of
# /etc/dzhoot/.env.production, assigned it to a variable named UNIT (the unit name was
# never passed in, so the alert did not even name what had failed) and sent nothing at
# all when that variable was empty — which it is on this host. The result: the nightly
# off-site backup failed on 2026-09-20 with the notifier "Deactivated successfully", so
# nobody learned that the only copy of the data outside this disk had stopped updating.
#
# Install (host, as root — nothing installs this automatically):
#   install -m 0755 dzhoof-failure-notify.sh /usr/local/sbin/dzhoof-failure-notify
# and the companion unit template:
#   install -m 0644 systemd/dzhoof-alert-failure@.service /etc/systemd/system/
#   systemctl daemon-reload
# then, on each unit that must not fail silently:
#   OnFailure=dzhoof-alert-failure@%n.service
#
# Usage: dzhoof-failure-notify [unit-name]
#
# Always records the failure to syslog and /var/log/dzhoof-failures.log, so the record
# survives even when every channel is down, then tries the channels in order:
# dzhoof-alert.sh (the shared path) → ALERT_WEBHOOK_URL → nothing.
set -uo pipefail

UNIT="${1:-unknown-unit}"
ENV_FILE="${DZHOOF_ENV_FILE:-/etc/dzhoot/.env.production}"
LOG_FILE="${DZHOOF_FAILURE_LOG:-/var/log/dzhoof-failures.log}"
AT="$(date -u +%FT%TZ)"
MESSAGE="DZ HOOF ALERT: ${UNIT} FAILED at ${AT} — inspect with: journalctl -u ${UNIT} -n 50"

printf '%s %s\n' "$AT" "$MESSAGE" >> "$LOG_FILE" 2>/dev/null || true
logger -t dzhoof-alert "$MESSAGE" 2>/dev/null || true

# Channel 1: the shared alert path. It reads Telegram/webhook/email from the app
# settings and the env file, and it is the only path proven to deliver on this host.
if [ -x /usr/local/sbin/dzhoof-alert.sh ]; then
  if /usr/local/sbin/dzhoof-alert.sh "$MESSAGE" critical "$UNIT" "$AT" >/dev/null 2>&1; then
    exit 0
  fi
fi

# Channel 2: a plain webhook, for hosts that have one but no dzhoof-alert.sh. Note this
# is the path that silently did nothing on production (ALERT_WEBHOOK_URL is empty there).
WEBHOOK=""
if [ -f "$ENV_FILE" ]; then
  WEBHOOK="$(sed -n 's/^ALERT_WEBHOOK_URL=//p' "$ENV_FILE" | tail -n 1 | tr -d '"' | tr -d "'")"
fi
if [ -n "$WEBHOOK" ]; then
  curl -fsS --max-time 10 -H 'Content-Type: application/json' \
    -d "$(printf '{"text":"%s"}' "$MESSAGE")" "$WEBHOOK" >/dev/null 2>&1 && exit 0
fi

# Nothing accepted it. The log line above is the record; make the failure loud in the
# journal so `systemctl --failed` plus a journal search is enough to find it.
echo "[dzhoof-failure-notify] ALL_CHANNELS_FAILED for ${UNIT} — see ${LOG_FILE}" >&2
exit 0
