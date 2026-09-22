// Playback/token secrets must exist before the route modules load.
process.env.PLAYBACK_TOKEN_SECRET = process.env.PLAYBACK_TOKEN_SECRET || 'gate-cache-test-secret';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'gate-cache-test-access';

import express from 'express';
import request from 'supertest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mongoose = require('mongoose');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XtreamSource = require('../models/XtreamSource');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Channel = require('../models/Channel');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const User = require('../models/User');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const channelsRouter = require('../routes/channels');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gateCache = require('../services/channel-gate-cache');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { publicCatalogDedupQuery, publicCatalogPresentationQuery } = require('../utils/catalog-presentation');

/**
 * The channel visibility gate (`routes/channels.js#verifiedXtreamChannelQuery`
 * and the same clauses in tv.js / User.ts / catalog-presentation) used to read
 * the Xtream source sets and recompute the dedup identity list on EVERY request
 * — a ~32.7k-document scan per hit whenever the Redis copy was cold. The answer
 * is identical for every caller, so it is memoized in-process
 * (`services/channel-gate-cache.ts`, `CHANNEL_GATE_CACHE_TTL_MS`, default 60s).
 *
 * These tests pin:
 *   1. the second call inside the TTL does NOT re-read the data source,
 *   2. the value is recomputed after the TTL,
 *   3. `CHANNEL_GATE_CACHE_TTL_MS=0` disables the cache entirely,
 *   4. `clearChannelGateCache()` invalidates (and picks up new data),
 *   5. concurrent callers share ONE computation (no thundering herd),
 *   6. a slow computation logs exactly one `[channel-gate] computed in …` line,
 *   7. a group-scoped caller still gets ITS scope — the user-independent clauses
 *      never leak one user's scope into another's response,
 *   8. two identical HTTP requests hit the data source exactly once.
 *
 * Mongo is provided by the global src/test/setup.ts (mongodb-memory-server),
 * whose afterEach also clears the gate memo between tests.
 */

const app = express();
app.use(express.json());
app.use('/api/v1/channels', channelsRouter);

const ORIGINAL_TTL = process.env.CHANNEL_GATE_CACHE_TTL_MS;

let seq = 0;
async function seedSource(extra: Record<string, unknown> = {}) {
  return XtreamSource.create({
    name: `src-${(seq += 1)}`,
    serverUrl: 'https://gate.test/panel',
    usernameEncrypted: 'e',
    passwordEncrypted: 'e',
    status: 'Active',
    verificationStatus: 'verified',
    ...extra,
  });
}

async function seedChannel(extra: Record<string, unknown> = {}) {
  seq += 1;
  return Channel.create({
    channelId: `CH-${seq}`,
    channelName: `Channel ${seq}`,
    channelUrl: 'https://gate.test/live/1.m3u8',
    channelGroup: `GRP-${seq}`,
    isActive: true,
    ...extra,
  });
}

async function seedUser(extra: Record<string, unknown> = {}) {
  seq += 1;
  return User.create({
    username: `gateU${seq}`,
    email: `gate${seq}@test.local`,
    password: 'gate-test-pass',
    channelListCode: `G${String(seq).padStart(5, '0')}`,
    role: 'User',
    isActive: true,
    ...extra,
  });
}

/** Spy on the two data sources the gate reads, delegating to the real calls. */
function spyOnDataSources() {
  const realXtreamFind = XtreamSource.find.bind(XtreamSource);
  const realChannelFind = Channel.find.bind(Channel);
  // Every gate source read is `XtreamSource.find(...).distinct('_id')`, so
  // counting `find` counts the computations. Both helpers return the real Query.
  const xtream = jest
    .spyOn(XtreamSource, 'find')
    .mockImplementation((...args: unknown[]) => realXtreamFind(...(args as [unknown])));
  const channel = jest
    .spyOn(Channel, 'find')
    .mockImplementation((...args: unknown[]) => realChannelFind(...(args as [unknown])));
  return { xtream, channel };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('channel gate in-process cache', () => {
  let spies: ReturnType<typeof spyOnDataSources>;

  beforeEach(() => {
    spies = spyOnDataSources();
  });

  afterEach(() => {
    spies.xtream.mockRestore();
    spies.channel.mockRestore();
    if (ORIGINAL_TTL === undefined) delete process.env.CHANNEL_GATE_CACHE_TTL_MS;
    else process.env.CHANNEL_GATE_CACHE_TTL_MS = ORIGINAL_TTL;
    jest.restoreAllMocks();
    gateCache.clearChannelGateCache();
  });

  describe('TTL semantics on the shared source sets', () => {
    it('computes once and serves the second call from the memo', async () => {
      await seedSource();
      const first = await gateCache.getVerifiedXtreamSourceIds();
      expect(spies.xtream).toHaveBeenCalledTimes(1);

      const second = await gateCache.getVerifiedXtreamSourceIds();
      expect(spies.xtream).toHaveBeenCalledTimes(1); // no re-read
      expect(second).toEqual(first);
      expect(first).toHaveLength(1);
    });

    it('recomputes after the TTL expires', async () => {
      process.env.CHANNEL_GATE_CACHE_TTL_MS = '40';
      await seedSource();
      await gateCache.getVerifiedXtreamSourceIds();
      expect(spies.xtream).toHaveBeenCalledTimes(1);

      await sleep(80);
      await gateCache.getVerifiedXtreamSourceIds();
      expect(spies.xtream).toHaveBeenCalledTimes(2);
    });

    it('CHANNEL_GATE_CACHE_TTL_MS=0 disables the cache entirely', async () => {
      process.env.CHANNEL_GATE_CACHE_TTL_MS = '0';
      await seedSource();
      await gateCache.getVerifiedXtreamSourceIds();
      await gateCache.getVerifiedXtreamSourceIds();
      await gateCache.getVerifiedXtreamSourceIds();
      expect(spies.xtream).toHaveBeenCalledTimes(3);
      expect(gateCache.channelGateCacheSize()).toBe(0);
    });

    it('clearChannelGateCache() invalidates and lets new data through', async () => {
      const first = await seedSource();
      const initial = await gateCache.getVerifiedXtreamSourceIds();
      expect(initial).toEqual([String(first._id)]);

      // New data lands, but the memo is still warm → the old value is served.
      const second = await seedSource({ customerVisible: true, status: 'Inactive', verificationStatus: 'pending' });
      expect(await gateCache.getVerifiedXtreamSourceIds()).toEqual(initial);
      expect(spies.xtream).toHaveBeenCalledTimes(1);

      gateCache.clearChannelGateCache();
      const refreshed = await gateCache.getVerifiedXtreamSourceIds();
      expect(spies.xtream).toHaveBeenCalledTimes(2);
      expect(refreshed.sort()).toEqual([String(first._id), String(second._id)].sort());
    });

    it('the three source sets are memoized under separate keys', async () => {
      await seedSource({ directPlayback: true });
      await seedSource({ customerVisible: true, status: 'Inactive', verificationStatus: 'pending' });

      const [verified, exempt, direct] = await Promise.all([
        gateCache.getVerifiedXtreamSourceIds(),
        gateCache.getIsWorkingExemptSourceIds(),
        gateCache.getDirectPlaybackSourceIds(),
      ]);
      expect(verified).toHaveLength(2);
      expect(exempt).toHaveLength(2);
      expect(direct).toHaveLength(1);
      expect(spies.xtream).toHaveBeenCalledTimes(3);

      await Promise.all([
        gateCache.getVerifiedXtreamSourceIds(),
        gateCache.getIsWorkingExemptSourceIds(),
        gateCache.getDirectPlaybackSourceIds(),
      ]);
      expect(spies.xtream).toHaveBeenCalledTimes(3); // all memoized
    });
  });

  describe('thundering herd and slow-computation logging', () => {
    it('hands concurrent callers the same in-flight promise', async () => {
      jest.restoreAllMocks();
      const findSpy = jest.spyOn(XtreamSource, 'find').mockImplementation(
        () =>
          ({
            distinct: async () => {
              await sleep(60);
              return ['shared-id'];
            },
          }) as never,
      );

      const [a, b, c] = await Promise.all([
        gateCache.getVerifiedXtreamSourceIds(),
        gateCache.getVerifiedXtreamSourceIds(),
        gateCache.getVerifiedXtreamSourceIds(),
      ]);
      expect(findSpy).toHaveBeenCalledTimes(1);
      expect(a).toEqual(['shared-id']);
      expect(b).toEqual(['shared-id']);
      expect(c).toEqual(['shared-id']);
    });

    it('logs one [channel-gate] line for a slow computation, and nothing when cached', async () => {
      jest.restoreAllMocks();
      const findSpy = jest.spyOn(XtreamSource, 'find').mockImplementation(
        () =>
          ({
            distinct: async () => {
              await sleep(550);
              return ['slow-id-1', 'slow-id-2'];
            },
          }) as never,
      );
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

      await gateCache.getVerifiedXtreamSourceIds();
      const lines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith('[channel-gate] computed in'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[channel-gate\] computed in \d+ms \(channels=0, identities=2\)$/);

      await gateCache.getVerifiedXtreamSourceIds(); // memoized → no computation
      const afterSecond = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith('[channel-gate] computed in'));
      expect(afterSecond).toHaveLength(1);
      expect(findSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('deduplicated identity list (the full-catalog scan)', () => {
    it('scans the catalog once per TTL, not once per call, even with Redis cold', async () => {
      const group = 'AR| BEIN SPORTS';
      const first = await seedChannel({ channelGroup: group, channelName: 'beIN Sprts 1', order: 1 });
      const dup = await seedChannel({ channelGroup: group, channelName: 'BE: beIN SPRTS 1', order: 2 });
      await seedChannel({ channelGroup: group, channelName: 'beIN Sprts 2', order: 3 });

      const query = await publicCatalogDedupQuery();
      expect(spies.channel).toHaveBeenCalledTimes(1); // one catalog scan
      expect(query._id.$nin).toEqual([String(dup._id)]);
      expect(query._id.$nin).not.toContain(String(first._id));

      // A new duplicate appears: still served from the memo until invalidated.
      const late = await seedChannel({ channelGroup: group, channelName: '8K: beIN SPRTS 2 SD', order: 4 });
      const cached = await publicCatalogDedupQuery();
      expect(spies.channel).toHaveBeenCalledTimes(1);
      expect(cached._id.$nin).not.toContain(String(late._id));

      gateCache.clearChannelGateCache();
      const refreshed = await publicCatalogDedupQuery();
      expect(spies.channel).toHaveBeenCalledTimes(2);
      expect(refreshed._id.$nin.sort()).toEqual([String(dup._id), String(late._id)].sort());
    });

    it('does not cache anything when dedup is disabled or the TTL is 0', async () => {
      const originalDedup = process.env.CATALOG_DEDUP;
      try {
        process.env.CATALOG_DEDUP = 'false';
        await seedChannel({ channelGroup: 'AR| X', channelName: 'Same' });
        await seedChannel({ channelGroup: 'AR| X', channelName: 'Same' });
        // Disabled dedup returns {} without touching the catalog at all.
        expect(await publicCatalogDedupQuery()).toEqual({});
        expect(spies.channel).toHaveBeenCalledTimes(0);

        process.env.CATALOG_DEDUP = 'true';
        process.env.CHANNEL_GATE_CACHE_TTL_MS = '0';
        await publicCatalogDedupQuery();
        await publicCatalogDedupQuery();
        expect(spies.channel).toHaveBeenCalledTimes(2);
      } finally {
        if (originalDedup === undefined) delete process.env.CATALOG_DEDUP;
        else process.env.CATALOG_DEDUP = originalDedup;
      }
    });
  });

  describe('user-scoped clauses never share a memo entry', () => {
    it('keeps CATALOG_HIDE_GROUPS changes effective (env-keyed entry)', () => {
      const originalEnv = process.env.CATALOG_HIDE_GROUPS;
      try {
        process.env.CATALOG_HIDE_GROUPS = 'none';
        expect(gateCache.getPublicCatalogHideQuery()).toEqual({});
        process.env.CATALOG_HIDE_GROUPS = 'RADIO';
        const withRadio = gateCache.getPublicCatalogHideQuery();
        expect((withRadio as { $nor: unknown[] }).$nor).toHaveLength(1);
        process.env.CATALOG_HIDE_GROUPS = 'none';
        expect(gateCache.getPublicCatalogHideQuery()).toEqual({});
        expect(gateCache.getPublicCatalogPresentationQuery()).toEqual(publicCatalogPresentationQuery());
      } finally {
        if (originalEnv === undefined) delete process.env.CATALOG_HIDE_GROUPS;
        else process.env.CATALOG_HIDE_GROUPS = originalEnv;
      }
    });

    it('gives every user their own group scope (the clause is never memoized)', async () => {
      await gateCache.getVerifiedXtreamSourceIds(); // warm the shared memo
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { groupScopeClause } = require('../services/channel-scope');
      const userA = { role: 'User', accessGroups: ['GRP-A'] };
      const userB = { role: 'User', accessGroups: ['GRP-B'] };
      expect(await groupScopeClause(userA)).toEqual({ channelGroup: { $in: ['GRP-A'] } });
      expect(await groupScopeClause(userB)).toEqual({ channelGroup: { $in: ['GRP-B'] } });
      expect(await groupScopeClause({ role: 'Admin' })).toBeNull();
    });
  });

  describe('GET /api/v1/channels', () => {
    it('serves two identical requests with ONE gate computation (O(1) per request)', async () => {
      const source = await seedSource();
      await seedChannel({
        channelId: 'CH-GATE-1',
        channelName: 'Gate One',
        channelGroup: 'AR| BEIN SPORTS',
        metadata: { source: 'xtream', xtreamSourceId: String(source._id) },
      });
      const user = await seedUser({ allCatalog: true });

      const first = await request(app)
        .get('/api/v1/channels')
        .set('x-tv-code', user.channelListCode);
      expect(first.status).toBe(200);
      expect(first.body.success).toBe(true);
      expect(first.body.count).toBe(1);
      expect(first.body.data[0].channelId).toBe('CH-GATE-1');
      // Request 1: the request path derives all of its source-id sets (verified /
      // exempt / direct …) and does the dedup identity scan once.
      const sourceReadsAfterFirst = spies.xtream.mock.calls.length;
      expect(sourceReadsAfterFirst).toBeGreaterThanOrEqual(3);
      expect(spies.channel).toHaveBeenCalledTimes(2);

      const second = await request(app)
        .get('/api/v1/channels')
        .set('x-tv-code', user.channelListCode);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      // Request 2: NO extra source read at all (every gate set is memoized) —
      // only the catalog list read happens again.
      expect(spies.xtream).toHaveBeenCalledTimes(sourceReadsAfterFirst);
      expect(spies.channel).toHaveBeenCalledTimes(3);
    });

    it('recomputes the gate on every request when the cache is disabled', async () => {
      process.env.CHANNEL_GATE_CACHE_TTL_MS = '0';
      await seedSource();
      await seedChannel({ channelId: 'CH-GATE-2', channelName: 'Gate Two', channelGroup: 'AR| X' });
      const user = await seedUser({ allCatalog: true });

      await request(app).get('/api/v1/channels').set('x-tv-code', user.channelListCode);
      expect(spies.xtream).toHaveBeenCalledTimes(3);
      await request(app).get('/api/v1/channels').set('x-tv-code', user.channelListCode);
      expect(spies.xtream).toHaveBeenCalledTimes(6);
    });

    it('never leaks one group scope into another scope’s response', async () => {
      await seedSource();
      const chanA = await seedChannel({ channelId: 'CH-A', channelName: 'A News', channelGroup: 'GRP-A' });
      const chanB = await seedChannel({ channelId: 'CH-B', channelName: 'B News', channelGroup: 'GRP-B' });
      const userA = await seedUser({ accessGroups: ['GRP-A'], channels: [chanA._id] });
      const userB = await seedUser({ accessGroups: ['GRP-B'], channels: [chanB._id] });

      const bodyA = (await request(app).get('/api/v1/channels').set('x-tv-code', userA.channelListCode)).body;
      const bodyB = (await request(app).get('/api/v1/channels').set('x-tv-code', userB.channelListCode)).body;
      expect(bodyA.data.map((c: { channelId: string }) => c.channelId)).toEqual(['CH-A']);
      expect(bodyB.data.map((c: { channelId: string }) => c.channelId)).toEqual(['CH-B']);

      // Repeat: the shared memo must not have cached a scope-specific result.
      const againA = (await request(app).get('/api/v1/channels').set('x-tv-code', userA.channelListCode)).body;
      const againB = (await request(app).get('/api/v1/channels').set('x-tv-code', userB.channelListCode)).body;
      expect(againA).toEqual(bodyA);
      expect(againB).toEqual(bodyB);
      expect(againA.data.map((c: { channelId: string }) => c.channelId)).toEqual(['CH-A']);
    });
  });
});
