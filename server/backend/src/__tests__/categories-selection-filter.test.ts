import request from 'supertest';
import express from 'express';
import Channel from '../models/Channel';

/**
 * GET /api/v1/categories must never widen past the caller's own selection.
 *
 * Regression (found live on production on 2026-09-20, after the predicate fix had already
 * shipped): the caller-specific filter was spread FIRST and the shared filters after it, so
 * `publicCatalogDedupQuery()`'s `{ _id: { $nin: [...] } }` overwrote the selection's
 * `_id` whenever the catalog actually had duplicates to hide — which is always true in
 * production, never true in a test DB with one channel. A zero-channel account therefore
 * read the whole catalog's group structure (192 groups measured) while `GET /channels`
 * returned count 0.
 *
 * These tests seed real duplicates so the dedup helper returns a NON-EMPTY hidden list,
 * which is the condition that used to erase the selection filter.
 */

let currentUser: Record<string, unknown> = {};

jest.mock('../middleware/requireTvOrSessionAuth', () => ({
  requireTvOrSessionAuth: (req: any, _res: any, next: any) => {
    req.user = currentUser;
    next();
  },
}));
jest.mock('../services/cache', () => ({
  channelCache: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => 0),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const categoriesRouter = require('../routes/categories');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { publicCatalogDedupQuery } = require('../utils/catalog-presentation');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/categories', categoriesRouter);
  return app;
}

describe('GET /api/v1/categories — selection filter survives the dedup spread', () => {
  const stamp = Date.now();

  beforeEach(async () => {
    // Two shared channels with the SAME normalized name in one group: the dedup helper
    // hides the second copy, so it returns `{ _id: { $nin: [<id>] } }` instead of `{}`.
    await Channel.create([
      {
        channelId: `sel-a-${stamp}`,
        channelName: `Dupe ${stamp}`,
        channelUrl: 'https://example.com/a.m3u8',
        channelGroup: `DUPE ${stamp}`,
        ownerId: null,
      },
      {
        channelId: `sel-b-${stamp}`,
        channelName: `Dupe ${stamp}`,
        channelUrl: 'https://example.com/b.m3u8',
        channelGroup: `DUPE ${stamp}`,
        ownerId: null,
      },
    ]);
  });

  it('the dedup helper really is returning an _id clause (guards the test premise)', async () => {
    const dedup = await publicCatalogDedupQuery();
    expect(JSON.stringify(dedup)).toContain('$nin');
  });

  it('a caller with an empty selection sees no groups at all', async () => {
    currentUser = { id: 'u-none', role: 'User', channels: [], channelListCode: 'NONE01' };
    const res = await request(buildApp()).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('a caller with one selected channel sees only that channel group', async () => {
    const own = await Channel.create({
      channelId: `sel-own-${stamp}`,
      channelName: 'My Own',
      channelUrl: 'https://example.com/own.m3u8',
      channelGroup: `MINE ${stamp}`,
      ownerId: null,
    });
    currentUser = {
      id: 'u-one',
      role: 'User',
      channels: [own._id],
      channelListCode: 'ONE001',
    };
    const res = await request(buildApp()).get('/api/v1/categories');
    expect(res.status).toBe(200);
    const names = res.body.categories.map((c: any) => c.name);
    expect(names).toContain(`MINE ${stamp}`);
    expect(names).not.toContain(`DUPE ${stamp}`);
  });

  it('an allCatalog account still gets the shared catalog', async () => {
    currentUser = { id: 'u-all', role: 'User', channels: [], allCatalog: true, channelListCode: 'ALL01' };
    const res = await request(buildApp()).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories.map((c: any) => c.name)).toContain(`DUPE ${stamp}`);
  });
});
