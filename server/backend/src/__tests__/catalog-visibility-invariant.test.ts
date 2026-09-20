import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Channel from '../models/Channel';

/**
 * One visibility gate for every channel-facing read (the invariant main's own comment
 * promises, and the one that silently broke twice on 2026-09-20):
 *
 *  - a caller sees the shared catalog only when it is Admin or `allCatalog`;
 *  - otherwise it sees exactly its own selection — never the catalog's structure;
 *  - private (ownerId-bearing) channels of other accounts never appear;
 *  - and none of that may be undone by a shared filter (dedup/hide/scope) that happens to
 *    use the same query key. The dedup helper returns `{_id: {$nin: [...]}}`, and a spread
 *    of it after the selection's `_id` replaced the selection — which is what leaked 192
 *    group names to a zero-channel account in production.
 *
 * Duplicates are seeded on purpose: with an empty dedup set the helper returns `{}` and the
 * collision cannot happen, which is why the earlier rounds of tests passed while the leak
 * was live.
 */

const cacheStore = new Map<string, unknown>();
jest.mock('../services/cache', () => ({
  channelCache: {
    get: jest.fn(async (k: string) => cacheStore.get(k) ?? null),
    set: jest.fn(async (k: string, v: unknown) => {
      cacheStore.set(k, v);
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const channelsRouter = require('../routes/channels');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const categoriesRouter = require('../routes/categories');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/channels', channelsRouter);
  app.use('/api/v1/categories', categoriesRouter);
  return app;
}

const GROUP_SHARED = 'INVARIANT SHARED';
const GROUP_PRIVATE = 'INVARIANT PRIVATE';

describe('catalog visibility invariant across channel-facing reads', () => {
  const stamp = Date.now();
  let selectedChannelId: mongoose.Types.ObjectId;
  let foreignPrivateId: mongoose.Types.ObjectId;

  beforeEach(async () => {
    cacheStore.clear();
    // Shared catalog with a duplicate pair, so the dedup clause is non-empty.
    await Channel.create([
      {
        channelId: `inv-a-${stamp}`,
        channelName: `Invariant ${stamp}`,
        channelUrl: 'https://example.com/a.m3u8',
        channelGroup: GROUP_SHARED,
        ownerId: null,
      },
      {
        channelId: `inv-b-${stamp}`,
        channelName: `Invariant ${stamp}`,
        channelUrl: 'https://example.com/b.m3u8',
        channelGroup: GROUP_SHARED,
        ownerId: null,
      },
    ]);
    const selected = await Channel.create({
      channelId: `inv-sel-${stamp}`,
      channelName: 'Selected One',
      channelUrl: 'https://example.com/sel.m3u8',
      channelGroup: GROUP_SHARED,
      ownerId: null,
    });
    const foreign = await Channel.create({
      channelId: `inv-priv-${stamp}`,
      channelName: 'Someone Else Private',
      channelUrl: 'https://example.com/priv.m3u8',
      channelGroup: GROUP_PRIVATE,
      ownerId: new mongoose.Types.ObjectId(),
    });
    selectedChannelId = selected._id as mongoose.Types.ObjectId;
    foreignPrivateId = foreign._id as mongoose.Types.ObjectId;
  });

  const get = (path: string) => request(buildApp()).get(path);

  it('a zero-channel caller sees nothing on any channel-facing read', async () => {
    currentUser = { id: 'u-empty', role: 'User', channels: [], channelListCode: 'EMPTY1' };

    const list = await get('/api/v1/channels');
    expect(list.status).toBe(200);
    expect(list.body.count).toBe(0);

    const paged = await get('/api/v1/channels?page=1&pageSize=50');
    expect(paged.status).toBe(200);
    expect(paged.body.totalCount).toBe(0);

    const grouped = await get('/api/v1/channels/grouped');
    expect(grouped.status).toBe(200);
    expect(Object.keys(grouped.body.data || {})).toEqual([]);

    const categories = await get('/api/v1/categories');
    expect(categories.status).toBe(200);
    expect(categories.body.categories).toEqual([]);
    expect(categories.body.total).toBe(0);
  });

  it('a caller with one selected channel sees only that channel and its group', async () => {
    currentUser = {
      id: 'u-one',
      role: 'User',
      channels: [selectedChannelId],
      channelListCode: 'ONE001',
    };

    const list = await get('/api/v1/channels');
    expect(list.status).toBe(200);
    const names = (list.body.data || []).map((c: any) => c.channelName);
    expect(names).toContain('Selected One');
    expect(names).not.toContain('Someone Else Private');

    const categories = await get('/api/v1/categories');
    const groups = categories.body.categories.map((c: any) => c.name);
    expect(groups).toEqual([GROUP_SHARED]);

    const paged = await get('/api/v1/channels?page=1&pageSize=50');
    expect(paged.body.totalCount).toBe(1);
  });

  it('an allCatalog caller gets the shared catalog but never another account private channels', async () => {
    currentUser = { id: 'u-all', role: 'User', channels: [], allCatalog: true, channelListCode: 'ALL001' };

    const categories = await get('/api/v1/categories');
    const groups = categories.body.categories.map((c: any) => c.name);
    expect(groups).toContain(GROUP_SHARED);
    expect(groups).not.toContain(GROUP_PRIVATE);

    const paged = await get('/api/v1/channels?page=1&pageSize=50');
    const names = (paged.body.data || []).map((c: any) => c.channelName);
    expect(names).not.toContain('Someone Else Private');
    expect(names).toContain('Selected One');
  });

  it('the seeded foreign private channel is really private (guard for the premise)', async () => {
    expect(String(foreignPrivateId)).not.toBe('');
    const ownerOnly = await Channel.countDocuments({ ownerId: { $ne: null } });
    expect(ownerOnly).toBeGreaterThanOrEqual(1);
  });
});
