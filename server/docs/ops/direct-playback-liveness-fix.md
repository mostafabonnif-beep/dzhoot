# Direct-Playback Liveness Fix — ops notes (2026-08-23)

## Root cause

Channels imported from **direct-playback** Xtream sources (e.g. Business Cloud
Upstream) are served straight to clients; the server's datacenter IP cannot probe
them (upstream returns HTTP 456 / blocks the IP). Channels imported earlier —
when the source was still server-probed — keep a stale `metadata.isWorking=false`,
so the admin dashboard reports the whole catalog as "dead" (16,635 failing on
2026-08-23) even though the streams work for real clients.

## Code fix (permanent)

`backend/src/services/stream-health-service.ts`:

1. **Direct-playback normalization** — `checkAndPromote` now sets
   `metadata.isWorking = true` (+ `lastTested`) on direct-playback channels that
   carry a stale `false`, so they stop being reported dead. Liveness for these
   channels is judged by real client playback metrics only.
2. **Dead-primary re-probe** — a channel already marked dead is re-probed after
   a cooldown (`STREAM_DEAD_RECHECK_HOURS`, default 6) so recovered upstreams
   come back automatically instead of staying dead forever.
3. **Probe timeout** — primary/alternate probes now use
   `STREAM_PROBE_TIMEOUT_MS` (default 15 s, was a hardcoded 10 s). Some legal
   M3U CDNs answer in 10–15 s and were wrongly marked dead.

## Scheduler secrets (docker-compose.production.yml)

The scheduler container was missing `XTREAM_SECRET_KEY`/`JWT_ACCESS_SECRET`, so
every scheduled `m3u-sync`/`xtream-sync` failed with "XTREAM_SECRET_KEY or
JWT_ACCESS_SECRET must be configured in production" (M3U sync decrypts the
stored playlist URL). The scheduler service now mirrors the API's secret set.

## One-time data remediation (run after deploy)

Clear stale dead flags immediately instead of waiting for the next health cycle:

```bash
cd /opt/dzhoot/server
docker compose -f docker-compose.production.yml --env-file /etc/dzhoot/.env.production exec mongodb mongosh dzhoof-iptv --quiet --eval '
  const direct = db.xtreamsources.find({ directPlayback: true }, { _id: 1 })
    .toArray().map((s) => String(s._id));
  const r = db.channels.updateMany(
    { "metadata.xtreamSourceId": { $in: direct }, "metadata.isWorking": false },
    { $set: { "metadata.isWorking": true, "metadata.lastTested": new Date() } }
  );
  print(JSON.stringify({ directSources: direct.length, modified: r.modifiedCount }));
'
```

Expected on 2026-08-23 production: `modified ≈ 16632` (all Primary Upstream
channels); dashboard banner and channel health then show the catalog as working,
with only genuinely-dead probed (M3U) channels remaining flagged.

## Verify after deploy

- `/api/v1/admin/stats/channel-operations` → `failing` should drop to a handful
  (only probed M3U channels that are actually down).
- `/api/v1/admin/m3u-sources` → the M3U source `syncStatus` should leave
  `error` after the next scheduled `m3u-sync` (secrets now available).
- Scheduler page shows `m3u-sync` / `xtream-sync` runs completing without the
  secret error.
