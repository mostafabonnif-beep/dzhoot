import request from 'supertest';
import express from 'express';
import Channel from '../models/Channel';

/**
 * Catalog cache integrity for GET /categories and GET /channels/grouped.
 *
 * Two rules the cache must respect, both of which were violated:
 *
 * 1. The payload depends on the caller's role (admins get the raw catalog, everyone else
 *    the deduplicated one), so the key must carry that dimension. One shared key served
 *    whichever flavour warmed it first for the next 10 minutes.
 * 2. Only *unscoped* shared-catalog callers may read OR write the shared entry. /grouped
 *    read behind `!isScoped` but wrote behind `catalogView` alone, so an allCatalog account
 *    with accessGroups pushed its restricted group list into the key every unscoped reader
 *    then consumed.
 *
 * The cache is mocked (no Redis in tests) with a recording in-memory store.
 */

const store = new Map<string, unknown>();
const gets: string[] = [];
const sets: string[] = [];

jest.mock('../services/cache', () => ({
  channelCache: {
    get: jest.fn(async (k: string) => {
      gets.push(k);
      return store.get(k) ?? null;
    }),
    set: jest.fn(async (k: string, v: unknown) => {
      sets.push(k);
      store.set(k, v);
    }),
    deletePattern: jest.fn(async () => 0),
  },
}));

let currentUser: Record<string, unknown> = {};
jest.mock('../middleware/requireTvOrSessionAuth', () => ({
  requireTvOrSessionAuth: (req: any, _res: any, next: any) => {
    req.user = currentUser;
    next();
  },
}));
jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = currentUser;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../middleware/requireAdmin', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const categoriesRouter = require('../routes/categories');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const channelsRouter = require('../routes/channels');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/categories', categoriesRouter);
  app.use('/api/v1/channels', channelsRouter);
  return app;
}

const admin = { id: 'admin-1', role: 'Admin', channels: [], channelListCode: 'ADM01' };
const allCatalogUser = { id: 'u-all', role: 'User', channels: [], allCatalog: true, channelListCode: 'ALL01' };
const scopedAllCatalogUser = {
  id: 'u-scoped',
  role: 'User',
  channels: [],
  allCatalog: true,
  channelListCode: 'SCP01',
  accessGroups: ['VISIBLE'], // → groupScopeClause() returns a clause
};

describe('catalog cache integrity', () => {
  const stamp = Date.now();

  beforeEach(async () => {
    store.clear();
    gets.length = 0;
    sets.length = 0;
    await Channel.create({
      channelId: `cache-a-${stamp}`,
      channelName: 'Cache Alpha',
      channelUrl: 'https://example.com/a.m3u8',
      channelGroup: 'VISIBLE',
      ownerId: null,
    });
  });

  it('/categories serves repeat calls from the cache instead of re-aggregating', async () => {
    currentUser = { ...allCatalogUser };
    const aggSpy = jest.spyOn(Channel, 'aggregate');
    const app = buildApp();
    const first = await request(app).get('/api/v1/categories');
    const second = await request(app).get('/api/v1/categories');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    // One aggregation for two requests, and the key carries the dedup dimension.
    expect(aggSpy).toHaveBeenCalledTimes(1);
    expect(sets).toContain('catalog:categories:presentation-v1:dedup');
    aggSpy.mockRestore();
  });

  it('/categories keys admins separately from deduplicated callers', async () => {
    const app = buildApp();
    currentUser = { ...admin };
    await request(app).get('/api/v1/categories');
    currentUser = { ...allCatalogUser };
    await request(app).get('/api/v1/categories');
    // (The dedup helper also writes its own 'catalog:dedup:ids' entry, so only the
    // categories keys are asserted here.)
    expect(sets).toContain('catalog:categories:presentation-v1:raw');
    expect(sets).toContain('catalog:categories:presentation-v1:dedup');
  });

  it('/categories does not cache or read for a group-scoped caller', async () => {
    currentUser = { ...scopedAllCatalogUser };
    const app = buildApp();
    await request(app).get('/api/v1/categories');
    expect(gets.filter((k) => k.startsWith('catalog:categories'))).toEqual([]);
    expect(sets.filter((k) => k.startsWith('catalog:categories'))).toEqual([]);
  });

  it('/channels/grouped is never populated by a group-scoped caller', async () => {
    currentUser = { ...scopedAllCatalogUser };
    const app = buildApp();
    const res = await request(app).get('/api/v1/channels/grouped');
    expect(res.status).toBe(200);
    expect(sets.filter((k) => k.startsWith('catalog:grouped'))).toEqual([]);
  });

  it('/channels/grouped caches the unscoped catalog and keys it by the dedup dimension', async () => {
    const app = buildApp();
    currentUser = { ...allCatalogUser };
    const first = await request(app).get('/api/v1/channels/grouped');
    const second = await request(app).get('/api/v1/channels/grouped');
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(sets).toContain('catalog:grouped:presentation-v1:dedup');

    currentUser = { ...admin };
    await request(app).get('/api/v1/channels/grouped');
    expect(sets).toContain('catalog:grouped:presentation-v1:raw');
  });

  it('the unpaginated catalog list keys admins separately too', async () => {
    // The list cache is gated on `!isTvClient`, i.e. only a caller whose payload carries no
    // user-bound playback tokens can share an entry (every session client carries a
    // channelListCode, so in practice the paginated cache in orderedCatalogChannels — which
    // is already keyed by dedup — is what serves the catalog). These callers therefore drop
    // the code to reach the cached branch at all, which is what this test exercises.
    const app = buildApp();
    const { channelListCode: _a, ...adminNoCode } = admin;
    const { channelListCode: _u, ...userNoCode } = allCatalogUser;
    currentUser = { ...adminNoCode };
    await request(app).get('/api/v1/channels');
    currentUser = { ...userNoCode };
    await request(app).get('/api/v1/channels');
    expect(sets).toContain('catalog:list:presentation-v2:raw');
    expect(sets).toContain('catalog:list:presentation-v2:dedup');
  });
});
