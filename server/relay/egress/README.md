# Egress relay (port 9001) — the proxy the API's playback path talks to

This directory versions the **egress gateway actually deployed on production**, which
until 2026-09-26 lived only at `/opt/dzhoof-relay/dzhoof-relay.py` on the host — not in
this repository at all. The audit that found the gap also found the reason it mattered:
the deployed unit ran `--host 0.0.0.0 --allow-only any`, while the script's own module
docstring says *"serve and pool listen on 127.0.0.1 only … never raise the listener to
0.0.0.0"*. Nothing in the repository could catch that contradiction because nothing in
the repository described what was running.

`server/relay/relay-pool.py` (the SOCKS5 city-distributor) is a **different** component
and is not what production runs. Do not confuse the two.

## Files

| File | Role |
|---|---|
| `dzhoof-relay.py` | the relay itself: `pool` mode is what the host runs (HTTP CONNECT + absolute-form proxy over `--egress` tunnels) |
| `dzhoof-relay-pool.service` | the hardened systemd unit (binds the docker gateway, not `0.0.0.0`) |
| `relay-firewall.sh` | idempotent iptables rule set: TCP/9001 reachable only from the production docker subnet + loopback |

`dzhoof-relay.py` is byte-identical to the copy deployed on the host (verified by
`sha256sum` at the time of import); keep it that way — edit here, deploy, and re-check
the hash.

## Deployment shape

```
API container (172.19.0.2)  ──HTTP proxy──►  172.19.0.1:9001  (this relay)
                                                  │
                    healthy home tunnel on 9101/9102/9103? ──yes──► home egress IP
                                                  │
                                                  no ──► --fallback-direct: fetch from
                                                          the server's own IP
```

`UPSTREAM_HTTP_PROXY=http://172.19.0.1:9001` and `UPSTREAM_PROXY_HOSTS=<provider>` tell
the API which upstream hosts use it. Both egress paths gate on `UPSTREAM_PROXY_HOSTS`
via `backend/src/services/upstream-proxy-hosts.ts`; before 2026-09-26 the playback fetch
tunnelled **every** host whenever the proxy was configured, while ffmpeg remux honoured
the list — so CDN segment fetches the operator meant to keep direct were going through
the relay.

## Hardening rules (do not regress)

- **Never bind `0.0.0.0`.** The service binds `172.19.0.1`, the `dzhoof-shared-network`
  gateway — the only interface the API needs.
- **Keep `--allow-only` an explicit list.** `any` turns the relay into a public-destination
  proxy for anything that can reach the docker bridge.
- **Keep the iptables scope tight** (`172.19.0.0/16` + loopback). The previous
  `172.16.0.0/12` admitted every other docker network on the host, including the dev stack.
- `--fallback-direct` stays **on**: it is load-bearing. With no healthy home tunnel the
  API would otherwise get `503` for every upstream fetch, which is every stream. The
  correct way to stop traffic using the relay is the `UPSTREAM_PROXY_HOSTS` gate, not
  disabling the fallback.

## Install

```bash
install -m 755 dzhoof-relay.py        /opt/dzhoof-relay/dzhoof-relay.py
install -m 755 relay-firewall.sh      /opt/dzhoof-relay/relay-firewall.sh
install -m 644 dzhoof-relay-pool.service /etc/systemd/system/dzhoof-relay-pool.service
systemctl daemon-reload && systemctl restart dzhoof-relay-pool.service
ss -ltnp | grep 9001        # expect 172.19.0.1:9001, never 0.0.0.0:9001
```

## Rollback

Restore the previous unit from `/opt/dzhoof-relay/backup-<ts>/` and delete the `:9001`
iptables rules (`iptables -L INPUT --line-numbers -n | awk '/dpt:9001/ {print $1}' |
sort -rn | xargs -r -n1 iptables -D INPUT`), then `systemctl restart`.
