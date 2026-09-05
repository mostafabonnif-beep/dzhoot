import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';
import ChannelFailoverMap from '../models/ChannelFailoverMap';
import Movie from '../models/Movie';
import { verifyPlaybackToken } from '../services/playback-token';
import User from '../models/User';
import { proxyLogoUrl } from '../utils/logo-proxy';

// Same harness as tv-playback-proxy-fallback.test.ts (Round 16).
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
    next();
  },
}));

jest.mock('../services/subscription-service', () => ({
  isSubscriptionRequired: jest.fn().mockResolvedValue(false),
  getActiveSubscription: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/playback-access-service', () => ({
  checkPlaybackSubscription: jest.fn().mockResolvedValue({ allowed: true, plan: null }),
}));

jest.mock('../services/stream-session-service', () => ({
  registerStreamSession: jest.fn().mockResolvedValue({ allowed: true, max: 2, active: 1 }),
}));

// The failover decision itself is unit-tested in round18-failover-service.test.ts;
// here we control the two decision inputs the route consumes.
jest.mock('../services/source-failover-service', () => ({
  isSourceDown: jest.fn(),
  getFailoverTarget: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tvRouter = require('../routes/tv');
const { isSourceDown, getFailoverTarget } = require('../services/source-failover-service');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tv', tvRouter);
  return app;
}

function tokenFromUrl(url: string): string {
  let u = String(url);
  if (u.endsWith('.m3u8')) u = u.slice(0, -'.m3u8'.length);
  const m = u.match(/\/playback\/([^/]+)$/);
  return m ? m[1] : '';
}

describe('Round 18 — TV playback-token auto-failover (backup source)', () => {
  const originalEnv = process.env.ALLOW_DIRECT_PLAYBACK;
  const originalSecret = process.env.PLAYBACK_TOKEN_SECRET;

  beforeEach(async () => {
    await Channel.deleteMany({});
    await XtreamSource.deleteMany({});
    await ChannelFailoverMap.deleteMany({});
    await Movie.deleteMany({});
    await User.deleteMany({});
    process.env.ALLOW_DIRECT_PLAYBACK = 'true';
    process.env.PLAYBACK_TOKEN_SECRET = 'round18-test-secret-for-playback-tokens';
    (isSourceDown as jest.Mock).mockReset();
    (getFailoverTarget as jest.Mock).mockReset();
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.ALLOW_DIRECT_PLAYBACK;
    else process.env.ALLOW_DIRECT_PLAYBACK = originalEnv;
    if (originalSecret === undefined) delete process.env.PLAYBACK_TOKEN_SECRET;
    else process.env.PLAYBACK_TOKEN_SECRET = originalSecret;
  });

  async function seedChannel(source: any, channelId = 'CH-LIVE') {
    return Channel.create({
      channelId,
      channelName: 'قناة حية',
      channelUrl: `http://upstream.test/live/u/p/262849.m3u8`,
      isActive: true,
      metadata: { source: 'xtream', xtreamSourceId: String(source._id) },
    });
  }

  it('source-hiding: without ALLOW_DIRECT_PLAYBACK a direct-enabled source still yields a relayed token', async () => {
    process.env.ALLOW_DIRECT_PLAYBACK = 'false';
    const source = await XtreamSource.create({
      name: 'Upstream', serverUrl: 'https://cf.upstream-host-redacted', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'verified', directPlayback: true,
    });
    await seedChannel(source);
    (isSourceDown as jest.Mock).mockResolvedValue(false);

    const res = await request(buildApp()).post('/api/v1/tv/playback-token').send({ channelId: 'CH-LIVE', slot: 0 });
    expect(res.status).toBe(200);
    const data = res.body.data;
    // The client only ever sees OUR server URL — the provider host/credentials
    // must never appear in anything client-visible.
    expect(data.playbackUrl).toContain('/api/v1/tv/playback/');
    expect(data.playbackUrl).not.toContain('upstream.test');
    const payload = verifyPlaybackToken(tokenFromUrl(data.playbackUrl));
    expect(payload?.direct).not.toBe(true);
    expect(payload?.v).toBe(2);
    expect(payload?.channelId).toBe('CH-LIVE');
    expect(payload?.streamUrl).toBeUndefined();
    // No direct token, so no direct→proxy pair is minted either.
    expect(data.proxyPlaybackUrl).toBeUndefined();
    process.env.ALLOW_DIRECT_PLAYBACK = 'true';
  });

  it('proxyLogoUrl rewrites provider logo hosts to our relay endpoint', () => {
    const out = proxyLogoUrl('https://iptv.ld-11.net', 'http://51.158.145.100/picons/logos/x.png');
    expect(out).toBe('https://iptv.ld-11.net/api/v1/tv/logo?url=' + encodeURIComponent('http://51.158.145.100/picons/logos/x.png'));
    expect(proxyLogoUrl('https://iptv.ld-11.net', 'data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(proxyLogoUrl('https://iptv.ld-11.net', '')).toBe('');
  });

  it('JSON playlist never leaks provider hosts — logos are relayed, stream URLs are ours', async () => {
    const source = await XtreamSource.create({
      name: 'Upstream', serverUrl: 'https://cf.upstream-host-redacted', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'verified', directPlayback: true,
    });
    await Channel.create({
      channelId: 'CH-LOGO', channelName: 'قناة', channelUrl: 'https://cf.upstream-host-redacted/live/u/p/1.m3u8',
      channelImg: 'http://51.158.145.100/picons/logos/x.png', isActive: true,
      metadata: { source: 'xtream', xtreamSourceId: String(source._id) },
    });
    await User.create({ username: 'tvuser', password: 'password123', email: 'tv@example.com', channelListCode: 'TVTEST', allCatalog: true, role: 'User' });

    const res = await request(buildApp()).get('/api/v1/tv/playlist/TVTEST/json');
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // No RAW provider URL may appear — the provider host only survives as an
    // encoded query parameter of OUR logo relay endpoint.
    expect(body).not.toContain('http://51.158.145.100');
    expect(body).not.toContain('https://cf.upstream-host-redacted');
    expect(body).toContain('/api/v1/tv/logo?url=http%3A%2F%2F51.158.145.100');
    expect(body).toContain('/api/v1/tv/logo?url=');
    expect(body).toContain('/api/v1/tv/playback/');
  });

  it('healthy primary → normal token, no failover', async () => {
    const source = await XtreamSource.create({
      name: 'Upstream', serverUrl: 'https://cf.upstream-host-redacted', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'verified', directPlayback: true,
    });
    await seedChannel(source);
    (isSourceDown as jest.Mock).mockResolvedValue(false);

    const res = await request(buildApp()).post('/api/v1/tv/playback-token').send({ channelId: 'CH-LIVE', slot: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBeUndefined();
    expect(getFailoverTarget).not.toHaveBeenCalled();
    const payload = verifyPlaybackToken(tokenFromUrl(res.body.data.playbackUrl));
    expect(payload?.v).toBe(2);
    expect(payload?.channelId).toBe('CH-LIVE');
    expect(payload?.streamUrl).toBeUndefined();
  });

  it('primary down + verified backup map → token served from the backup source', async () => {
    const primary = await XtreamSource.create({
      name: 'Upstream', serverUrl: 'https://cf.upstream-host-redacted', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'degraded', directPlayback: true,
    });
    const backup = await XtreamSource.create({
      name: 'Backup Maghreb', serverUrl: 'http://ottstreambox.xyz:80', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'verified', directPlayback: true,
    });
    const channel = await seedChannel(primary);
    await ChannelFailoverMap.create({
      channelId: channel._id, channelRef: 'CH-LIVE', backupSourceId: backup._id,
      backupChannelName: 'قناة حية', backupStreamId: '424242', matchedBy: 'manual', enabled: true,
    });
    (isSourceDown as jest.Mock).mockResolvedValue(true);
    (getFailoverTarget as jest.Mock).mockResolvedValue({
      streamUrl: 'http://ottstreambox.xyz:80/live/e/e/424242.m3u8',
      source: { _id: backup._id, directPlayback: true },
    });

    const res = await request(buildApp()).post('/api/v1/tv/playback-token').send({ channelId: 'CH-LIVE', slot: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('backup');
    expect(String(res.body.data.failoverSourceId)).toBe(String(backup._id));
    const payload = verifyPlaybackToken(tokenFromUrl(res.body.data.playbackUrl));
    expect(payload?.v).toBe(2);
    expect(payload?.channelId).toBe('CH-LIVE');
    expect(payload?.streamUrl).toBeUndefined();
    expect(payload?.direct).toBe(true);
    // Direct + proxy fallback both minted over the backup URL, one session slot.
    expect(res.body.data.proxyPlaybackUrl).toBeTruthy();
  });

  it('catch-up request never fails over even when the primary is down', async () => {
    const primary = await XtreamSource.create({
      name: 'Upstream', serverUrl: 'https://cf.upstream-host-redacted', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'blocked', directPlayback: true,
    });
    await seedChannel(primary);
    (isSourceDown as jest.Mock).mockResolvedValue(true);

    const res = await request(buildApp())
      .post('/api/v1/tv/playback-token')
      .send({ channelId: 'CH-LIVE', slot: 0, catchupStartMs: Date.now(), catchupDurationMin: 30 });
    // No failover consulted; catch-up stays on the primary (Upstream).
    expect(getFailoverTarget).not.toHaveBeenCalled();
    // The route resolves a catch-up URL or reports catch-up unavailable — but
    // never touches the backup path.
    expect([200, 400, 404]).toContain(res.status);
  });

  it('primary down but no map → keeps the primary URL (directPlayback still eligible)', async () => {
    const primary = await XtreamSource.create({
      name: 'Upstream', serverUrl: 'https://cf.upstream-host-redacted', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'blocked', directPlayback: true,
    });
    await seedChannel(primary);
    (isSourceDown as jest.Mock).mockResolvedValue(true);
    (getFailoverTarget as jest.Mock).mockResolvedValue(null);

    const res = await request(buildApp()).post('/api/v1/tv/playback-token').send({ channelId: 'CH-LIVE', slot: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBeUndefined();
    const payload = verifyPlaybackToken(tokenFromUrl(res.body.data.playbackUrl));
    expect(payload?.v).toBe(2);
    expect(payload?.channelId).toBe('CH-LIVE');
    expect(payload?.streamUrl).toBeUndefined();
  });

  it('primary down + mirror configured → token stream rewritten to the mirror domain (source: mirror)', async () => {
    const primary = await XtreamSource.create({
      name: 'Business Cloud NEO', serverUrl: 'https://cf.business-cloud-neo.ru', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'degraded', directPlayback: true,
      mirrorServerUrls: ['http://tv.business-cloud-neo.com'],
    });
    await Channel.create({
      channelId: 'CH-MIRROR', channelName: 'قناة حية',
      channelUrl: 'https://cf.business-cloud-neo.ru/live/u/p/262849.m3u8',
      isActive: true, metadata: { source: 'xtream', xtreamSourceId: String(primary._id) },
    });
    (isSourceDown as jest.Mock).mockResolvedValue(true);
    (getFailoverTarget as jest.Mock).mockResolvedValue(null);

    const res = await request(buildApp()).post('/api/v1/tv/playback-token').send({ channelId: 'CH-MIRROR', slot: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('mirror');
    expect(res.body.data.mirrorBase).toBe('http://tv.business-cloud-neo.com');
    const payload = verifyPlaybackToken(tokenFromUrl(res.body.data.playbackUrl));
    expect(payload?.v).toBe(2);
    expect(payload?.channelId).toBe('CH-MIRROR');
    expect(payload?.streamUrl).toBeUndefined();
  });

  it('primary down + mirror but healthy → no rewrite (primary stays)', async () => {
    const primary = await XtreamSource.create({
      name: 'Business Cloud NEO', serverUrl: 'https://cf.business-cloud-neo.ru', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'verified', directPlayback: true,
      mirrorServerUrls: ['http://tv.business-cloud-neo.com'],
    });
    await Channel.create({
      channelId: 'CH-MIRROR-OK', channelName: 'قناة حية',
      channelUrl: 'https://cf.business-cloud-neo.ru/live/u/p/262849.m3u8',
      isActive: true, metadata: { source: 'xtream', xtreamSourceId: String(primary._id) },
    });
    (isSourceDown as jest.Mock).mockResolvedValue(false);

    const res = await request(buildApp()).post('/api/v1/tv/playback-token').send({ channelId: 'CH-MIRROR-OK', slot: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBeUndefined();
    const payload = verifyPlaybackToken(tokenFromUrl(res.body.data.playbackUrl));
    expect(payload?.v).toBe(2);
    expect(payload?.channelId).toBe('CH-MIRROR-OK');
    expect(payload?.streamUrl).toBeUndefined();
  });

  it('mirror never applies to catch-up even when the primary is down', async () => {
    const primary = await XtreamSource.create({
      name: 'Business Cloud NEO', serverUrl: 'https://cf.business-cloud-neo.ru', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'blocked', directPlayback: true,
      mirrorServerUrls: ['http://tv.business-cloud-neo.com'],
    });
    await seedChannel(primary);
    (isSourceDown as jest.Mock).mockResolvedValue(true);
    (getFailoverTarget as jest.Mock).mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/v1/tv/playback-token')
      .send({ channelId: 'CH-LIVE', slot: 0, catchupStartMs: Date.now(), catchupDurationMin: 30 });
    // Catch-up is never mirrored (timeshift is primary-panel specific).
    expect([200, 400, 404]).toContain(res.status);
    expect(getFailoverTarget).not.toHaveBeenCalled();
  });

  it('VOD movie token stream is rewritten to the mirror domain when the primary is down', async () => {
    const src = await XtreamSource.create({
      name: 'Business Cloud NEO', serverUrl: 'https://cf.business-cloud-neo.ru', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'degraded', directPlayback: true,
      mirrorServerUrls: ['http://tv.business-cloud-neo.com'],
    });
    const movie = await Movie.create({
      title: 'فيلم تجريبي', sourceId: src._id, externalId: 'E2E-1',
      streamUrl: 'https://cf.business-cloud-neo.ru/movie/u/p/123.mp4', isActive: true,
    });
    (isSourceDown as jest.Mock).mockResolvedValue(true);

    const res = await request(buildApp()).post('/api/v1/tv/playback-token').send({ movieId: String(movie._id) });
    expect(res.status).toBe(200);
    const payload = verifyPlaybackToken(tokenFromUrl(res.body.data.playbackUrl));
    expect(payload?.streamUrl).toBe('http://tv.business-cloud-neo.com/movie/u/p/123.mp4');
    expect(payload?.streamUrl).not.toContain('cf.business-cloud-neo.ru');
  });

  it('VOD movie token keeps the primary URL when the source is healthy', async () => {
    const src = await XtreamSource.create({
      name: 'Business Cloud NEO', serverUrl: 'https://cf.business-cloud-neo.ru', usernameEncrypted: 'e', passwordEncrypted: 'e',
      status: 'Active', verificationStatus: 'verified', directPlayback: true,
      mirrorServerUrls: ['http://tv.business-cloud-neo.com'],
    });
    const movie = await Movie.create({
      title: 'فيلم تجريبي', sourceId: src._id, externalId: 'E2E-2',
      streamUrl: 'https://cf.business-cloud-neo.ru/movie/u/p/456.mp4', isActive: true,
    });
    (isSourceDown as jest.Mock).mockResolvedValue(false);

    const res = await request(buildApp()).post('/api/v1/tv/playback-token').send({ movieId: String(movie._id) });
    expect(res.status).toBe(200);
    const payload = verifyPlaybackToken(tokenFromUrl(res.body.data.playbackUrl));
    expect(payload?.streamUrl).toBe('https://cf.business-cloud-neo.ru/movie/u/p/456.mp4');
  });
});
