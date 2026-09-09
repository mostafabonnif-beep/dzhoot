# DZ HOOF — weekly docker/disk cleanup

Recurring production incident: every atomic deploy adds ~2.1GB of docker images
(`dzhoof-api` 1.65GB + `dzhoof-frontend` 483MB as `:current`, `:v<ver>-<stamp>`
and `:rollback-<stamp>`), and there was **no scheduled cleanup** — the disk
filled to ~80% and hit 100% on 2026-09-08 (recovered manually, 22GB freed).
`restic` self-prunes (keep-daily 7 / weekly 4 / monthly 3) but docker images
never did.

## What it does

`cleanup-docker.sh` (weekly, see timer):

1. `docker builder prune -af` — build cache.
2. `docker image prune -af --filter until=168h` — **unused** images older than
   7 days (running stack + recent release/rollback images untouched).
3. Removes `dzhoof-*:rollback-<stamp>` older than 14 days explicitly.
4. `docker container prune -f --filter until=24h` — exited containers.

Every run appends a timestamped line with reclaimed space to
`/var/log/dzhoot-docker-cleanup.log` (auto-truncated at 500 lines).

Tunables (env): `DZHOOF_KEEP_IMAGE_HOURS` (168), `DZHOOF_KEEP_ROLLBACK_DAYS` (14).

## Install on the production VPS

```bash
sudo install -m 0755 scripts/cleanup-docker.sh /opt/dzhoot/server/scripts/cleanup-docker.sh
sudo install -m 0644 scripts/cleanup/systemd/dzhoof-docker-cleanup.service /etc/systemd/system/
sudo install -m 0644 scripts/cleanup/systemd/dzhoof-docker-cleanup.timer  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dzhoof-docker-cleanup.timer
systemctl list-timers dzhoof-docker-cleanup.timer
```

## Manual run + proof

```bash
sudo systemctl start dzhoof-docker-cleanup.service   # or run the script directly
cat /var/log/dzhoot-docker-cleanup.log
```
