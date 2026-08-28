#!/usr/bin/env bash
# يضمن اتصال dzhoof-caddy بشبكة dz1-tv-internal (مطلوب لـ reverse_proxy dz1-tv-api)
set -u
if ! docker network inspect dz1-tv-internal >/dev/null 2>&1; then
  exit 0  # شبكة DZ1 TV غير موجودة (المكدس متوقف) — لا شيء نفعله
fi
if ! docker network inspect dz1-tv-internal --format "{{range .Containers}}{{.Name}} {{end}}" | grep -qw dzhoof-caddy; then
  docker network connect dz1-tv-internal dzhoof-caddy && logger -t dz1tv-caddy-net "reconnected dzhoof-caddy to dz1-tv-internal"
fi
