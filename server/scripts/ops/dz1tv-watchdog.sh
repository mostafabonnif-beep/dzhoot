#!/usr/bin/env bash
# مراقبة dz1tv.ld-11.net و iptv.ld-11.net — تسجيل تغيّر الحالة + إصلاح ذاتي بسيط
set -u
LOG=/var/log/dz1tv-watchdog.log
STATE=/var/tmp/dz1tv-watchdog.state
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "$(ts) $*" >> "$LOG"; }

dz1=UP; curl -sf --max-time 8 https://dz1tv.ld-11.net/readyz >/dev/null 2>&1 || dz1=DOWN
zh=UP;  curl -sf --max-time 8 https://iptv.ld-11.net/health  >/dev/null 2>&1 || zh=DOWN

state="dz1tv=$dz1 dzhoof=$zh"
prev="$(cat "$STATE" 2>/dev/null || echo initial)"

if [ "$state" != "$prev" ]; then
  if [ "$prev" != "initial" ]; then log "state change: $prev -> $state"; fi
  echo "$state" > "$STATE"
  if [ "$dz1" = DOWN ] || [ "$zh" = DOWN ]; then
    log "ALERT: $state — auto-healing"
    /usr/local/sbin/ensure-dz1tv-caddy-net.sh >/dev/null 2>&1 || true
    for c in dz1-tv-api dz1-tv-mongodb dzhoof-api dzhoof-frontend dzhoof-caddy; do
      if ! docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null | grep -q true; then
        log "restarting $c"
        docker start "$c" >/dev/null 2>&1 || true
      fi
    done
    sleep 10
    dz1=UP; curl -sf --max-time 8 https://dz1tv.ld-11.net/readyz >/dev/null 2>&1 || dz1=DOWN
    zh=UP;  curl -sf --max-time 8 https://iptv.ld-11.net/health  >/dev/null 2>&1 || zh=DOWN
    log "heal result: dz1tv=$dz1 dzhoof=$zh"
    echo "dz1tv=$dz1 dzhoof=$zh" > "$STATE"
  fi
fi
