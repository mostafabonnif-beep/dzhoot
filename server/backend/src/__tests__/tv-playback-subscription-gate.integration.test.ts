import express from 'express';
import request from 'supertest';
import User from '../models/User';
import Plan from '../models/Plan';
import Subscription from '../models/Subscription';
import AppSetting from '../models/AppSetting';
import Channel from '../models/Channel';
import { issuePlaybackToken } from '../services/playback-token';

jest.mock('../services/upstream-proxy', () => ({
  proxyUpstreamStream: jest.fn((_req: any, res: any) => res.status(204).end()),
}));
jest.mock('../services/stream-session-service', () => ({
  isStreamSessionActive: jest.fn().mockResolvedValue(true),
  registerStreamSession: jest.fn().mockResolvedValue({ allowed: false, max: 1, active: 1 }),
}));
jest.mock('../services/cache', () => ({
  epgCache: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../services/epg-service', () => ({
  epgService: { getEpgForChannels: jest.fn(), generateXmltv: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tvRouter = require('../routes/tv');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/tv', tvRouter);
  return instance;
}

async function createPlan() {
  return Plan.create({
    name: `Playback plan ${Date.now()}`,
    durationDays: 30,
    maxDevices: 2,
    maxConcurrentStreams: 1,
    status: 'Active',
  });
}

async function createUser(role: 'User' | 'Admin' = 'User') {
  return User.create({
    username: `viewer_${Math.random().toString(16).slice(2)}`,
    password: 'SecureTestPassword!123',
    email: `viewer_${Math.random().toString(16).slice(2)}@example.test`,
    channelListCode: `T${Math.random().toString(36).slice(2, 7).toUpperCase()}`.padEnd(6, '0'),
    role,
    isActive: true,
  });
}

async function createSubscription(user: any, plan: any, status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED', expiresAt: Date) {
  return Subscription.create({
    userId: user._id,
    planId: plan._id,
    status,
    startsAt: new Date(Date.now() - 60_000),
    expiresAt,
    cancelledAt: status === 'CANCELLED' ? new Date() : null,
  });
}

describe('TV playback subscription enforcement', () => {
  const previousSubscriptionRequired = process.env.SUBSCRIPTION_REQUIRED;
  const previousPlaybackSecret = process.env.PLAYBACK_TOKEN_SECRET;
  const previousLegacyToken = process.env.ALLOW_LEGACY_PLAYBACK_TOKEN;
  const previousLegacyCode = process.env.ALLOW_LEGACY_TV_CODE;

  beforeEach(async () => {
    process.env.SUBSCRIPTION_REQUIRED = 'true';
    process.env.PLAYBACK_TOKEN_SECRET = 'test-playback-secret-with-sufficient-entropy';
    process.env.ALLOW_LEGACY_PLAYBACK_TOKEN = 'true';
    process.env.ALLOW_LEGACY_TV_CODE = 'true';
    await AppSetting.deleteMany({});
  });

  afterAll(() => {
    if (previousSubscriptionRequired === undefined) delete process.env.SUBSCRIPTION_REQUIRED;
    else process.env.SUBSCRIPTION_REQUIRED = previousSubscriptionRequired;
    if (previousPlaybackSecret === undefined) delete process.env.PLAYBACK_TOKEN_SECRET;
    else process.env.PLAYBACK_TOKEN_SECRET = previousPlaybackSecret;
    if (previousLegacyToken === undefined) delete process.env.ALLOW_LEGACY_PLAYBACK_TOKEN;
    else process.env.ALLOW_LEGACY_PLAYBACK_TOKEN = previousLegacyToken;
    if (previousLegacyCode === undefined) delete process.env.ALLOW_LEGACY_TV_CODE;
    else process.env.ALLOW_LEGACY_TV_CODE = previousLegacyCode;
  });

  it('allows an active subscription to retrieve its playlist', async () => {
    const user = await createUser();
    const plan = await createPlan();
    await createSubscription(user, plan, 'ACTIVE', new Date(Date.now() + 60 * 60_000));

    const response = await request(app()).get(`/tv/playlist/${user.channelListCode}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('#EXTM3U');
  });

  it('blocks playlist, EPG, and a playback token issued before subscription expiry', async () => {
    const user = await createUser();
    const plan = await createPlan();
    await createSubscription(user, plan, 'ACTIVE', new Date(Date.now() - 60_000));
    const { token } = issuePlaybackToken({
      userId: String(user._id),
      channelListCode: user.channelListCode,
      streamUrl: 'https://example.test/live.m3u8',
      sessionId: 'root-session',
    });

    const [playlist, epg, playback] = await Promise.all([
      request(app()).get(`/tv/playlist/${user.channelListCode}`),
      request(app()).get(`/tv/epg/${user.channelListCode}`),
      request(app()).get(`/tv/playback/${token}.m3u8`),
    ]);

    expect(playlist.status).toBe(403);
    expect(epg.status).toBe(403);
    expect(playback.status).toBe(403);
    expect(playback.text).toContain('subscription');
  });

  it('blocks every playback-facing route for a cancelled subscription', async () => {
    const user = await createUser();
    const plan = await createPlan();
    await createSubscription(user, plan, 'CANCELLED', new Date(Date.now() + 60 * 60_000));

    const [playlist, epgJson] = await Promise.all([
      request(app()).get(`/tv/playlist/${user.channelListCode}`),
      request(app()).get(`/tv/epg/${user.channelListCode}/json`),
    ]);

    expect(playlist.status).toBe(403);
    expect(epgJson.status).toBe(403);
  });

  it('returns a safe concurrent-stream error after subscription access succeeds', async () => {
    const user = await createUser();
    const plan = await createPlan();
    await createSubscription(user, plan, 'ACTIVE', new Date(Date.now() + 60 * 60_000));
    const channel = await Channel.create({
      ownerId: null,
      lifecycleStatus: 'active',
      channelId: `test:${Date.now()}`,
      channelName: 'Test channel',
      channelUrl: 'https://example.test/live.m3u8',
    });
    user.channels = [channel._id];
    await user.save();

    const response = await request(app())
      .post('/tv/playback-token')
      .set('X-TV-Code', user.channelListCode)
      .send({ channelId: channel.channelId });

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ success: false, code: 'CONCURRENT_STREAM_LIMIT' });
    expect(JSON.stringify(response.body)).not.toContain('example.test');
  });

  it('keeps an active administrator eligible under the documented commercial-gate policy', async () => {
    const admin = await createUser('Admin');
    const response = await request(app()).get(`/tv/playlist/${admin.channelListCode}`);
    expect(response.status).toBe(200);
  });
});
