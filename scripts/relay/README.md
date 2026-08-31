# DZ HOOF Relay — home-residential egress for IPTV sources

Some upstream panels block datacenter IPs (HTTP 403 from nginx for every path)
while allowing residential IPs. This relay lets the VPS exit such traffic
through a home connection, so sources like `ottstreambox.xyz` and the NEO
Cloudflare front (104.18.22.66/23.66) verify and stream normally.

## Architecture

```
Home machine                    VPS (5.135.79.221)
┌──────────────┐   ssh -R       ┌─────────────────────────────────────┐
│ relay-client │ 127.0.0.1:9000 │ sshd :9000  ← reverse tunnel        │
│ SOCKS5 :9001 │ ◄────────────► │        │                            │
│ (residential │                │ relay-pool.py (smart SOCKS pool)    │
│  IP egress)  │                │   listen 127.0.0.1:9000             │
└──────────────┘                │   cities: oran 9101 / algiers 9102  │
                                │           / jijel 9103 (ssh -R)     │
                                │   health-check every 15s (NEO :443) │
                                │   status HTTP :9080 + Redis         │
                                │        │                            │
                                │ redsocks 0.0.0.0:12345 ─► :9000     │
                                │        │                            │
                                │ iptables REDIRECT (OUTPUT+PREROUTING)│
                                │  104.18.22.66:443   (NEO)           │
                                │  104.18.23.66:443   (NEO)           │
                                │  117.55.202.166:80  (ottstreambox)  │
                                └─────────────────────────────────────┘
```

- `relay-client.py` runs on the HOME machine: minimal stdlib SOCKS5 server on
  `127.0.0.1:9001`; pair it with `ssh -R 127.0.0.1:9000:127.0.0.1:9001` to the
  VPS. Ship it with a dedicated SSH key (never commit the key — see Security).
- `relay-pool.py` (systemd `dzhoof-relay-pool.service`) multiplexes several
  city tunnels (one reverse port per city) behind a single `127.0.0.1:9000`
  SOCKS listener, fails over between cities, and closes the listener when all
  tunnels are dead (which makes the timer drop the iptables rules → direct
  mode again).
- `relay-upstream-manage` (systemd `upstream-relay.service` + `.timer`, every
  60s) owns the iptables REDIRECT rules: present while `:9000` listens, absent
  otherwise. Destinations are `IP:PORT` pairs in `UPSTREAM_RULES`.

## Install on the VPS

```bash
install -m 755 relay-upstream-manage /usr/local/sbin/upstream-relay-manage
install -m 755 relay-pool.py /opt/dzhoof/relay/relay-pool.py
install -m 644 upstream-relay.service /etc/systemd/system/
install -m 644 upstream-relay.timer /etc/systemd/system/
install -m 644 dzhoof-relay-pool.service /etc/systemd/system/
install -m 644 relay-pool.json.example /etc/dzhoof/relay-pool.json
systemctl daemon-reload
systemctl enable --now upstream-relay.timer dzhoof-relay-pool.service
```

`relay-pool.json.example` is the production config (node names/ports); adjust
for your city tunnels.

## Add / remove a routed destination

Edit `UPSTREAM_RULES` in `relay-upstream-manage` (one `IP:PORT` pair per token)
and run `/usr/local/sbin/upstream-relay-manage` to apply immediately; the timer
keeps it applied. Removing a pair while the relay is up returns that
destination to direct egress.

## Verification

```bash
ss -tln | grep :9000                        # tunnel listener alive
curl -s --socks5-hostname 127.0.0.1:9000 http://api.ipify.org   # exit IP
iptables -t nat -S | grep REDIRECT          # active rules
curl -s http://127.0.0.1:9080/status        # pool status JSON
```

## Security

- **Never commit the home-side SSH key** (`relay_key`), tokens, or any
  credential. The key must be provisioned out-of-band (scp/cloud KMS), chmod
  600, and rotated periodically.
- The iptables rules redirect ONLY the listed destination IPs; everything else
  keeps direct egress. No global transparent proxy.
- If all home relays are down, the pool closes `:9000` and the timer removes
  the rules automatically — the platform degrades to direct mode instead of
  breaking unrelated traffic.
- The relay health-check currently targets NEO (`104.18.22.66:443`); if NEO is
  unreachable through the tunnels while other routed destinations still work,
  the pool will still shut down. Add destination-specific checks if needed.
