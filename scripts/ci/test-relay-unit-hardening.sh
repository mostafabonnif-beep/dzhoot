#!/usr/bin/env bash
# Regression guard for the egress relay hardening (2026-09-26).
#
# Why this exists: production ran `/opt/dzhoof-relay/dzhoof-relay.py` with
# `--host 0.0.0.0 --allow-only any` while the script's own docstring says never to listen
# on 0.0.0.0 — and nothing in this repository could catch it, because the unit file, the
# firewall rules and even the relay script lived only on the host. They are versioned now
# (server/relay/egress/), so this test pins the properties that must not regress:
#
#   * the listener binds the production docker gateway, never every interface;
#   * destinations are an explicit allowlist, never `any`;
#   * the firewall admits only the production docker subnet plus loopback.
#
# Run: bash scripts/ci/test-relay-unit-hardening.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT="$ROOT/server/relay/egress/dzhoof-relay-pool.service"
FIREWALL="$ROOT/server/relay/egress/relay-firewall.sh"
RELAY="$ROOT/server/relay/egress/dzhoof-relay.py"

fail=0
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; fail=1; }

for f in "$UNIT" "$FIREWALL" "$RELAY"; do
  [ -f "$f" ] || { bad "missing $f"; }
done
[ "$fail" -eq 0 ] || { echo "relay hardening: FAILED"; exit 1; }

# 1. The listener must never be every interface.
if grep -q -- '--host 0\.0\.0\.0' "$UNIT"; then
  bad "unit listens on 0.0.0.0 (must bind 172.19.0.1 — the docker gateway the API uses)"
else
  ok "unit does not listen on 0.0.0.0"
fi
if grep -q -- '--host 172\.19\.0\.1' "$UNIT"; then
  ok "unit binds the production docker gateway 172.19.0.1"
else
  bad "unit does not bind 172.19.0.1"
fi

# 2. Destinations must be an explicit list, never `any`/`*`/`all`.
allow_line="$(grep -o -- '--allow-only [^ ]*' "$UNIT" || true)"
if [ -z "$allow_line" ]; then
  bad "unit has no --allow-only (the relay would fall back to its default allowlist)"
else
  case "$allow_line" in
    '--allow-only any'|'--allow-only all'|'--allow-only *')
      bad "unit uses '$allow_line' — the relay would proxy any public destination" ;;
    '--allow-only ')
      bad "unit passes an empty --allow-only list" ;;
    *)
      ok "unit restricts destinations ($allow_line)" ;;
  esac
fi

# 3. Ports must be an explicit list too.
ports_line="$(grep -o -- '--allow-ports [^ ]*' "$UNIT" || true)"
if [ -n "$ports_line" ]; then ok "unit restricts ports ($ports_line)"; else
  bad "unit does not restrict --allow-ports"
fi

# 4. Firewall: production subnet + loopback only, and never the old 172.16.0.0/12 sweep.
if grep -q '172\.19\.0\.0/16' "$FIREWALL"; then ok "firewall scopes to 172.19.0.0/16"; else
  bad "firewall does not scope to the production docker subnet"; fi
if grep -q '127\.0\.0\.0/8' "$FIREWALL"; then ok "firewall allows loopback"; else
  bad "firewall does not allow loopback"; fi
if grep -q '172\.16\.0\.0/12' "$FIREWALL"; then
  bad "firewall reverted to the 172.16.0.0/12 sweep (admits every docker network on the host)"
else
  ok "firewall no longer sweeps 172.16.0.0/12"
fi

# 5. The relay script itself must keep refusing private/loopback/link-local destinations,
#    including the metadata endpoint, before any port check can pass.
for probe in 'is_private' 'is_loopback' 'is_link_local' 'is_unspecified' 'is_reserved'; do
  if grep -q "$probe" "$RELAY"; then ok "relay blocks $probe destinations"; else
    bad "relay no longer checks $probe"; fi
done

if [ "$fail" -ne 0 ]; then echo "relay hardening: FAILED"; exit 1; fi
echo "relay hardening: all checks passed"
