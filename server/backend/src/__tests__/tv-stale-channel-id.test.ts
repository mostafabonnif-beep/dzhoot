/**
 * A client that cached its channel list must not lose playback when the provider source is
 * re-registered.
 *
 * Re-adding a provider creates a new XtreamSource id, and every channel id is
 * `xt:<sourceId>:<streamId>` — so the same stream gets a new id. Clients send `channelId`
 * (see DzhoofApiService.issuePlaybackToken), so their cached list started answering
 * `404 Channel not found` on every tap: 2026-09-21 production logs showed a real device
 * getting 200 for freshly-listed channels and 404 for ones it had cached before the ids
 * moved.
 *
 * The stream id survives all of that, so playback resolves on it — preferring the copy the
 * catalog actually serves (verified / customer-visible / direct-playback) when the same
 * stream exists under more than one source.
 */
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';

// Issuing a playback token requires the HMAC secret; without it the route answers 500 and the
// test would pass for the wrong reason (it never reaches the id resolution it is about).
process.env.PLAYBACK_TOKEN_SECRET = process.env.PLAYBACK_TOKEN_SECRET || 'test-playback-secret';

const TEST_USER_ID = '66c0000000000000000000ff';
jest.mock('../middleware/requireTvOrSessionAuth', () => ({
  requireTvOrSessionAuth: (req: any, _res: any, next: any) => {
    req.user = {
      id: TEST_USER_ID,
      username: 'grid-user',
      role: 'User',
      channels: [],
      channelListCode: 'GRID01',
      isActive: true,
      allCatalog: true,
    };
    next();
  },
}));
jest.mock('../routes/auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../services/audit-log', () => ({ audit: jest.fn() }));
jest.mock('../services/subscription-service', () => ({
  isSubscriptionRequired: jest.fn().mockResolvedValue(false),
  getActiveSubscription: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/playback-access-service', () => ({
  checkPlaybackSubscription: jest.fn().mockResolvedValue({ allowed: true, plan: null }),
}));
jest.mock('../services/stream-session-service', () => ({
  registerStreamSession: jest.fn().mockResolvedValue({ allowed: true, max: 2, active: 1 }),
  isStreamSessionActive: jest.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tvRouter = require('../routes/tv');

const app = express();
app.use(express.json());
app.use('/api/v1/tv', tvRouter);

const RETIRED_SOURCE_ID = new mongoose.Types.ObjectId();
const CURRENT_SOURCE_ID = new mongoose.Types.ObjectId();

async function seedSource(id: mongoose.Types.ObjectId, extra: Record<string, unknown>) {
  return XtreamSource.create({
    _id: id,
    name: `source-${id.toHexString().slice(-4)}`,
    serverUrl: 'http://provider.invalid',
    usernameEncrypted: 'x',
    passwordEncrypted: 'y',
    status: 'Active',
    ...extra,
  });
}

async function seedChannel(channelId: string, streamId: string, sourceId: string | null) {
  await Channel.collection.insertOne({
    channelId,
    channelName: `CH ${streamId}`,
    channelUrl: 'http://provider.invalid/live/u/p/1.ts',
    channelGroup: 'GRID',
    ownerId: null,
    isActive: true,
    metadata: sourceId
      ? { source: 'xtream', xtreamSourceId: sourceId, xtreamStreamId: Number(streamId), isWorking: true }
      : { source: 'xtream', isWorking: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('playback with a channel id retired by a source re-registration', () => {
  beforeEach(async () => {
    await Channel.collection.deleteMany({});
    await XtreamSource.deleteMany({});
  });

  it('resolves the same stream id under the current source instead of 404', async () => {
    await seedSource(CURRENT_SOURCE_ID, { verificationStatus: 'verified' });
    await seedChannel(`xt:${CURRENT_SOURCE_ID}:262848`, '262848', String(CURRENT_SOURCE_ID));

    const res = await request(app)
      .post('/api/v1/tv/playback-token')
      .send({ channelId: `xt:${RETIRED_SOURCE_ID}:262848`, slot: 0 });

    // The point of the case: the retired id no longer answers 404, and a token comes back.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(JSON.stringify(res.body.data || {})).toContain('playback/');
  });

  it('prefers the playable copy when two sources serve the same stream id', async () => {
    await seedSource(RETIRED_SOURCE_ID, { verificationStatus: 'pending', status: 'Inactive' });
    await seedSource(CURRENT_SOURCE_ID, { verificationStatus: 'verified' });
    await seedChannel('xt:5aaad0000000000000000001:999001', '999001', null);
    await seedChannel(`xt:${RETIRED_SOURCE_ID}:999001`, '999001', String(RETIRED_SOURCE_ID));
    await seedChannel(`xt:${CURRENT_SOURCE_ID}:999001`, '999001', String(CURRENT_SOURCE_ID));

    const res = await request(app)
      .post('/api/v1/tv/playback-token')
      .send({ channelId: 'xt:5aaad0000000000000000001:999001', slot: 0 });

    // Both candidates exist for stream 999001; the token must come from the playable one, so
    // the resolved channel is the verified source's copy (a dead source would be attached to
    // the token instead and the viewer would see it fail).
    expect(res.status).toBe(200);
    const minted = String((res.body.data || {}).playbackUrl || (res.body.data || {}).url || '');
    expect(minted.length).toBeGreaterThan(0);
  });

  it('still 404s for an id whose stream is genuinely gone', async () => {
    await seedSource(CURRENT_SOURCE_ID, { verificationStatus: 'verified' });
    await seedChannel(`xt:${CURRENT_SOURCE_ID}:262848`, '262848', String(CURRENT_SOURCE_ID));

    const res = await request(app)
      .post('/api/v1/tv/playback-token')
      .send({ channelId: `xt:${RETIRED_SOURCE_ID}:111111`, slot: 0 });

    expect(res.status).toBe(404);
  });
});
