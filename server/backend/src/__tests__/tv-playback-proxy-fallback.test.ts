import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';
import { verifyPlaybackToken } from '../services/playback-token';

// TV playback-token routes are protected by requireTvOrSessionAuth — mock it
// with a stable user so the endpoint focuses on the token contract.
jest.mock('../middleware/requireTvOrSessionAuth', () => ({
  requireTvOrSessionAuth: (req: any, _res: any, next: any) => {
    req.user = {
      id: 'user-id',
      username: 'tvuser',
      role: 'User',
      channels: [],
      channelListCode: 'TVTEST',
      isActive: true,
      allCatalog: true,
    };
    // v2 playback tokens are device-bound; the authenticated TV middleware
    // supplies this internal context after validating X-Device-Token.
    req.deviceAuth = {
      deviceId: '507f1f77bcf86cd799439011',
      issuedAt: new Date('2026-08-25T00:00:00.000Z'),
    };
    next();
  },
}));

jest.mock('../services/subscription-service', () => ({
  isSubscriptionRequired: jest.fn().mockResolvedValue(false),
  getActiveSubscription: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/playback-access-service', () => ({
  checkPlaybackSubscription: jest.fn().mockResolvedValue({
    allowed: true,
    required: true,
    plan: null,
  }),
}));

jest.mock('../services/stream-session-service', () => ({
  registerStreamSession: jest.fn().mockResolvedValue({ allowed: true, max: 2, active: 1 }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tvRouter = require('../routes/tv');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tv', tvRouter);
  return app;
}

function tokenFromUrl(url: string): string {
  const match = String(url).match(/\/playback\/([^/]+)\.m3u8$/);
  return match ? match[1] : '';
}

describe('TV playback-token — direct + proxy fallback (Round 16)', () => {
  const originalEnv = process.env.ALLOW_DIRECT_PLAYBACK;
  const originalSecret = process.env.PLAYBACK_TOKEN_SECRET;

  beforeEach(async () => {
    await Channel.deleteMany({});
    await XtreamSource.deleteMany({});
    process.env.ALLOW_DIRECT_PLAYBACK = 'true';
    process.env.PLAYBACK_TOKEN_SECRET = 'round16-test-secret-for-playback-tokens';
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.ALLOW_DIRECT_PLAYBACK;
    else process.env.ALLOW_DIRECT_PLAYBACK = originalEnv;
    if (originalSecret === undefined) delete process.env.PLAYBACK_TOKEN_SECRET;
    else process.env.PLAYBACK_TOKEN_SECRET = originalSecret;
  });

  it('returns a proxy fallback URL alongside the direct URL for direct-enabled sources', async () => {
    const source = await XtreamSource.create({
      name: 'Primary Upstream',
      serverUrl: 'https://cf.upstream-host-redacted',
      usernameEncrypted: 'enc-user',
      passwordEncrypted: 'enc-pass',
      status: 'Active',
      verificationStatus: 'verified',
      directPlayback: true,
    });
    await Channel.create({
      channelId: 'CH-DIRECT',
      channelName: 'قناة مباشرة',
      channelUrl: 'https://cf.upstream-host-redacted/live/abc/def/262849.m3u8',
      isActive: true,
      metadata: { source: 'xtream', xtreamSourceId: String(source._id) },
    });

    const res = await request(buildApp())
      .post('/api/v1/tv/playback-token')
      .send({ channelId: 'CH-DIRECT', slot: 0 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.playbackUrl).toBeTruthy();
    expect(data.proxyPlaybackUrl).toBeTruthy();
    expect(data.proxyPlaybackUrl).not.toBe(data.playbackUrl);

    // Direct token carries direct:true; the proxy token is NOT direct (the
    // payload omits the flag for false, which the playback route treats as
    // server-relayed proxy mode).
    const directPayload = verifyPlaybackToken(tokenFromUrl(data.playbackUrl));
    const proxyPayload = verifyPlaybackToken(tokenFromUrl(data.proxyPlaybackUrl));
    expect(directPayload?.direct).toBe(true);
    expect(proxyPayload?.direct).not.toBe(true);
    // Both tokens describe the same stream and share one stream session slot.
    expect(proxyPayload?.streamUrl).toBe(directPayload?.streamUrl);
    expect(proxyPayload?.sessionId).toBe(directPayload?.sessionId);
  });

  it('omits the proxy fallback when the source is not direct-enabled', async () => {
    const source = await XtreamSource.create({
      name: 'مصدر بروكسي',
      serverUrl: 'https://source.example',
      usernameEncrypted: 'enc-user',
      passwordEncrypted: 'enc-pass',
      status: 'Active',
      verificationStatus: 'verified',
      directPlayback: false,
    });
    await Channel.create({
      channelId: 'CH-PROXY',
      channelName: 'قناة بروكسي',
      channelUrl: 'https://source.example/live/u/p/1.m3u8',
      isActive: true,
      metadata: { source: 'xtream', xtreamSourceId: String(source._id) },
    });

    const res = await request(buildApp())
      .post('/api/v1/tv/playback-token')
      .send({ channelId: 'CH-PROXY', slot: 0 });

    expect(res.status).toBe(200);
    expect(res.body.data.playbackUrl).toBeTruthy();
    expect(res.body.data.proxyPlaybackUrl).toBeUndefined();
  });
});
