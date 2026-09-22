/**
 * Live Xtream playback must resolve to the panel's HLS rendition of the same stream id.
 *
 * Issue #360, measured on production 2026-09-21 with a real device code: 6/10 sampled channels
 * played, and the failures returned HTTP 200 with an entirely empty body on `.ts` while the same
 * stream id served a valid 169-byte playlist as `.m3u8` (the panel advertises
 * `allowed_output_formats: [m3u8, ts, rtmp]`). A customer handed the `.ts` URL gets a black
 * screen that never errors — a valid-looking 200 arrives over both the direct redirect and the
 * server relay, because both fetch the upstream that URL names.
 *
 * These tests pin the two things that make the fix real rather than cosmetic:
 *
 *  1. the LIVE path re-resolves the URL from the Channel document (v2 tokens never read
 *     `payload.streamUrl`), so the twin has to be applied at play-time resolution — an
 *     issue-time-only change would leave every live channel on `.ts`;
 *  2. the play-time 302 exposes the resolved URL, which is what these tests assert on, so the
 *     assertion is about what the player would actually fetch.
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';
import User from '../models/User';
import { hlsTwinStreamUrl } from '../services/xtream-service';

// Same harness as round18-failover-tv.test.ts: GET /playback/:token re-checks the token's user
// against the database, so the mocked user needs a real document behind it.
const TEST_USER_ID = '66c000000000000000000002';

jest.mock('../middleware/requireTvOrSessionAuth', () => ({
  requireTvOrSessionAuth: (req: any, _res: any, next: any) => {
    req.user = {
      id: TEST_USER_ID,
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
  isStreamSessionActive: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/source-failover-service', () => ({
  isSourceDown: jest.fn().mockResolvedValue(false),
  getFailoverTarget: jest.fn().mockResolvedValue(null),
  getHttpsBackupStreamUrl: jest.fn().mockResolvedValue(null),
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
  const match = String(url).match(/\/playback\/([^/]+?)(?:\.m3u8)?$/);
  return match ? match[1] : '';
}

describe('live playback resolves the HLS twin (issue #360)', () => {
  const originalDirect = process.env.ALLOW_DIRECT_PLAYBACK;
  const originalTwin = process.env.PREFER_HLS_TWIN;
  const originalSecret = process.env.PLAYBACK_TOKEN_SECRET;

  beforeEach(async () => {
    await Channel.deleteMany({});
    await XtreamSource.deleteMany({});
    await User.deleteMany({});
    await User.create({
      _id: TEST_USER_ID,
      username: 'tvuser',
      password: 'password123',
      email: 'tv@example.com',
      channelListCode: 'TVTEST',
      allCatalog: true,
      role: 'User',
      isActive: true,
    });
    process.env.ALLOW_DIRECT_PLAYBACK = 'true';
    process.env.PLAYBACK_TOKEN_SECRET = 'hls-twin-test-secret-for-playback-tokens';
    delete process.env.PREFER_HLS_TWIN;
  });

  afterAll(() => {
    if (originalDirect === undefined) delete process.env.ALLOW_DIRECT_PLAYBACK;
    else process.env.ALLOW_DIRECT_PLAYBACK = originalDirect;
    if (originalTwin === undefined) delete process.env.PREFER_HLS_TWIN;
    else process.env.PREFER_HLS_TWIN = originalTwin;
    if (originalSecret === undefined) delete process.env.PLAYBACK_TOKEN_SECRET;
    else process.env.PLAYBACK_TOKEN_SECRET = originalSecret;
  });

  async function seedXtreamChannel(channelUrl: string, channelId = 'CH-LIVE') {
    const source = await XtreamSource.create({
      name: 'Upstream',
      serverUrl: 'https://cf.upstream-host-redacted',
      usernameEncrypted: 'e',
      passwordEncrypted: 'e',
      status: 'Active',
      verificationStatus: 'verified',
      directPlayback: true,
    });
    return Channel.create({
      channelId,
      channelName: 'قناة حية',
      channelUrl,
      isActive: true,
      metadata: { source: 'xtream', xtreamSourceId: String(source._id) },
    });
  }

  /** Mint a live token and follow it to the play-time resolution the player would fetch. */
  async function playResolvedUrl(channelId = 'CH-LIVE') {
    const tokenRes = await request(buildApp())
      .post('/api/v1/tv/playback-token')
      .send({ channelId, slot: 0 });
    expect(tokenRes.status).toBe(200);
    const playRes = await request(buildApp()).get(
      `/api/v1/tv/playback/${tokenFromUrl(tokenRes.body.data.playbackUrl)}`,
    );
    return playRes;
  }

  it('serves the .m3u8 twin when the channel URL is .ts', async () => {
    await seedXtreamChannel('http://upstream.test/live/u/p/297641.ts');

    const playRes = await playResolvedUrl();

    expect(playRes.status).toBe(302);
    expect(playRes.headers.location).toBe('http://upstream.test/live/u/p/297641.m3u8');
  });

  it('keeps the query string, because panels carry tokens and output flags there', async () => {
    await seedXtreamChannel('http://upstream.test/live/u/p/297641.ts?token=abc&type=m3u_plus');

    const playRes = await playResolvedUrl();

    expect(playRes.headers.location).toBe(
      'http://upstream.test/live/u/p/297641.m3u8?token=abc&type=m3u_plus',
    );
  });

  it('leaves an .m3u8 channel untouched', async () => {
    await seedXtreamChannel('http://upstream.test/live/u/p/297641.m3u8');

    const playRes = await playResolvedUrl();

    expect(playRes.headers.location).toBe('http://upstream.test/live/u/p/297641.m3u8');
  });

  it('does not touch a non-Xtream channel: the twin convention is the panel\u2019s, not ours', async () => {
    await Channel.create({
      channelId: 'CH-M3U',
      channelName: 'قناة M3U',
      channelUrl: 'http://m3u-provider.test/live/1234.ts',
      isActive: true,
      metadata: { source: 'm3u' },
    });

    // A non-Xtream channel is relayed (no direct redirect to follow), so the observation is the
    // token contract itself: the HLS container hint and the `.m3u8` URL suffix are derived from
    // the resolved upstream, and both must stay those of a raw `.ts`.
    const tokenRes = await request(buildApp())
      .post('/api/v1/tv/playback-token')
      .send({ channelId: 'CH-M3U', slot: 0 });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.data.playbackUrl).not.toContain('.m3u8');
    expect(String(tokenRes.body.data.mimeType || '')).not.toMatch(/mpegurl|m3u8/i);
  });

  it('honours the PREFER_HLS_TWIN=false kill switch without a deploy', async () => {
    process.env.PREFER_HLS_TWIN = 'false';
    await seedXtreamChannel('http://upstream.test/live/u/p/297641.ts');

    const playRes = await playResolvedUrl();

    expect(playRes.headers.location).toBe('http://upstream.test/live/u/p/297641.ts');
  });

  describe('hlsTwinStreamUrl', () => {
    it('maps only a .ts path, case-insensitively, and preserves the suffix', () => {
      expect(hlsTwinStreamUrl('http://h:8080/live/u/p/1.ts')).toBe('http://h:8080/live/u/p/1.m3u8');
      expect(hlsTwinStreamUrl('http://h/live/u/p/1.TS')).toBe('http://h/live/u/p/1.m3u8');
      expect(hlsTwinStreamUrl('http://h/live/u/p/1.ts?token=x#frag')).toBe(
        'http://h/live/u/p/1.m3u8?token=x#frag',
      );
    });

    it('returns null when there is no twin to build', () => {
      expect(hlsTwinStreamUrl('http://h/live/u/p/1.m3u8')).toBeNull();
      expect(hlsTwinStreamUrl('http://h/vod/u/p/1.mp4')).toBeNull();
      expect(hlsTwinStreamUrl('http://h/live/u/p/1')).toBeNull();
      expect(hlsTwinStreamUrl('')).toBeNull();
      expect(hlsTwinStreamUrl(null)).toBeNull();
      expect(hlsTwinStreamUrl(undefined)).toBeNull();
    });

    it('does not touch a .ts that is not the path extension', () => {
      // `/ts.1` and a query value ending in .ts must not be rewritten.
      expect(hlsTwinStreamUrl('http://h/live/u/p/ts.1')).toBeNull();
    });
  });
});
