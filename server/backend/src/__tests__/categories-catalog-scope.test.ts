import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Channel from '../models/Channel';

/**
 * GET /api/v1/categories — group list scoping.
 *
 * The invariant: /categories must mirror GET /channels, so a caller who can see zero
 * channels can never be handed the group structure of the shared catalog.
 *
 * Regression: the catalog-view test used to include `Boolean(req.user.channelListCode)`.
 * `channelListCode` is `required: true` on every user document, so that clause was true
 * for every authenticated session, and a user with an empty personal selection received
 * every supplier group name and count (383 groups were observed in production while
 * GET /channels returned count 0 for the same session).
 */

let currentUser: Record<string, unknown> = {};

jest.mock('../middleware/requireTvOrSessionAuth', () => ({
  requireTvOrSessionAuth: (req: any, _res: any, next: any) => {
    req.user = currentUser;
    next();
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const categoriesRouter = require('../routes/categories');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/categories', categoriesRouter);
  return app;
}

describe('GET /api/v1/categories — catalog scope', () => {
  const stamp = Date.now();
  const ownerId = new mongoose.Types.ObjectId();
  let sharedId: string;
  let ownId: string;
  let ownObjectId: mongoose.Types.ObjectId;

  // The shared setup truncates collections between tests, so the fixtures must be
  // re-created per test rather than once per file.
  beforeEach(async () => {
    await Channel.create({
      channelId: `cat-shared-${stamp}`,
      channelName: 'Catalog News',
      channelUrl: 'https://example.com/shared.m3u8',
      channelGroup: `SHARED| NEWS ${stamp}`,
      ownerId: null,
    });
    const own = await Channel.create({
      channelId: `cat-own-${stamp}`,
      channelName: 'My Private Channel',
      channelUrl: 'https://example.com/own.m3u8',
      channelGroup: `MINE ${stamp}`,
      ownerId,
    });
    sharedId = String(
      (await Channel.findOne({ channelId: `cat-shared-${stamp}` }).lean())?._id || '',
    );
    ownId = String(own._id);
    ownObjectId = own._id as mongoose.Types.ObjectId;
  });

  it('does not hand the shared catalog structure to a user with an empty selection', async () => {
    // Exactly the production shape: a plain User, a channel list code, zero channels.
    currentUser = {
      id: 'user-empty',
      role: 'User',
      channels: [],
      channelListCode: 'ABC123',
      allCatalog: false,
    };
    const res = await request(buildApp()).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([]);
  });

  it('returns only the groups of the caller own selection', async () => {
    currentUser = {
      id: String(ownerId),
      role: 'User',
      // Real sessions carry ObjectIds here (Mongoose-populated), and the
      // aggregation matches `_id` — a string would silently match nothing.
      channels: [ownObjectId],
      channelListCode: 'ABC123',
      allCatalog: false,
    };
    const res = await request(buildApp()).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories.map((c: any) => c.name)).toEqual([`MINE ${stamp}`]);
  });

  it('still serves the shared catalog to an allCatalog account', async () => {
    currentUser = {
      id: 'user-all',
      role: 'User',
      channels: [],
      channelListCode: 'ABC123',
      allCatalog: true,
    };
    const res = await request(buildApp()).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories.map((c: any) => c.name)).toContain(`SHARED| NEWS ${stamp}`);
    expect(res.body.categories.map((c: any) => c.name)).not.toContain(`MINE ${stamp}`);
  });

  it('still serves the shared catalog to an admin', async () => {
    currentUser = { id: 'admin-1', role: 'Admin', channels: [], channelListCode: 'ADMIN1' };
    const res = await request(buildApp()).get('/api/v1/categories');
    expect(res.status).toBe(200);
    const names = res.body.categories.map((c: any) => c.name);
    expect(names).toContain(`SHARED| NEWS ${stamp}`);
    // The catalog view is shared content only (ownerId: null), so a private import
    // never shows up as a group here — for any role.
    expect(names).not.toContain(`MINE ${stamp}`);
    expect(sharedId).not.toBe('');
  });
});
