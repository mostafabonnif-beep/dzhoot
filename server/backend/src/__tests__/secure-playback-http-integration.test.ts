import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';

process.env.XTREAM_SECRET_KEY = 'test-only-xtream-secret-012345678901234567890123';

const User = require('../models/User');
const Channel = require('../models/Channel');
const Movie = require('../models/Movie');
const XtreamSource = require('../models/XtreamSource');
const AppSetting = require('../models/AppSetting');
const tvRouter = require('../routes/tv');
const streamProxyRouter = require('../routes/stream-proxy');
const { encryptSecret } = require('../utils/crypto');

jest.mock('../services/epg-service', () => ({ epgService: { getPrograms: jest.fn() } }));
jest.mock('../services/audit-log', () => ({ audit: jest.fn() }));
jest.mock('../services/cache', () => ({ epgCache: { get: jest.fn().mockResolvedValue([]), set: jest.fn() } }));

function buildTvApp() {
  const app = express();
  app.use('/api/v1/tv', tvRouter);
  return app;
}

function buildStreamProxyApp() {
  const app = express();
  app.use('/api/v1/stream-proxy', streamProxyRouter);
  return app;
}

async function createSource() {
  return XtreamSource.create({
    name: 'Integration source',
    serverUrl: 'https://panel.example.test:8443',
    usernameEncrypted: encryptSecret('fixture-user'),
    passwordEncrypted: encryptSecret('fixture-pass'),
    status: 'Active',
    stats: { channels: 1, movies: 1, series: 0 },
  });
}

async function createUser(code = 'TV1234') {
  return User.create({
    username: `integration-${code.toLowerCase()}`,
    password: 'fixture-password-123',
    email: `${code.toLowerCase()}@example.test`,
    role: 'User',
    channelListCode: code,
    isActive: true,
    channels: [],
  });
}

describe('secure playback HTTP integration', () => {
  it('returns a local managed proxy URL from the TV JSON playlist', async () => {
    const source = await createSource();
    const user = await createUser();
    const channel = await Channel.create({
      ownerId: null,
      channelId: 'integration-live-1',
      channelName: 'Integration Live',
      channelUrl: 'https://panel.example.test:8443/live/fixture-user/fixture-pass/101.m3u8',
      metadata: { source: 'xtream', xtreamSourceId: String(source._id), xtreamStreamId: 101 },
    });
    user.channels = [channel._id];
    await user.save();

    const response = await request(buildTvApp()).get('/api/v1/tv/playlist/TV1234/json');
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain('/api/v1/tv/stream/TV1234?');
    expect(serialized).not.toContain('fixture-user');
    expect(serialized).not.toContain('fixture-pass');
  });

  it('rejects the TV stream endpoint when a caller supplies an upstream URL', async () => {
    const source = await createSource();
    const user = await createUser('TV5678');
    const channel = await Channel.create({
      ownerId: null,
      channelId: 'integration-live-2',
      channelName: 'Integration Live 2',
      channelUrl: 'https://panel.example.test:8443/live/fixture-user/fixture-pass/102.m3u8',
      metadata: { source: 'xtream', xtreamSourceId: String(source._id), xtreamStreamId: 102 },
    });
    user.channels = [channel._id];
    await user.save();

    const response = await request(buildTvApp())
      .get('/api/v1/tv/stream/TV5678')
      .query({ url: 'https://attacker.test/live/fixture-user/fixture-pass/102.m3u8' });
    expect(response.status).toBe(400);
    expect(response.text).toContain('Managed playback requires contentType and contentId');
  });

  it('rejects the legacy stream proxy URL input and keeps managed auth', async () => {
    const response = await request(buildStreamProxyApp())
      .get('/api/v1/stream-proxy')
      .query({ url: 'https://attacker.test/live/fixture-user/fixture-pass/101.m3u8' });
    expect(response.status).toBe(401);
  });

  it('does not expose credentials in a managed playback error response', async () => {
    const source = await createSource();
    const user = await createUser('TV9012');
    await AppSetting.create({ key: 'subscription_required', value: false });
    const movie = await Movie.create({
      sourceId: source._id,
      externalId: 'movie-1',
      title: 'Integration Movie',
      category: 'Test',
      streamUrl: 'https://panel.example.test:8443/movie/fixture-user/fixture-pass/movie-1.mp4',
      containerExtension: 'mp4',
      isActive: true,
    });
    user.channels = [];
    await user.save();

    const response = await request(buildTvApp())
      .get(`/api/v1/tv/stream/TV9012`)
      .query({ contentType: 'MOVIE', contentId: String(movie._id), resource: '/movie/not-the-canonical-stream.mp4' });
    expect(response.status).toBe(502);
    expect(response.text).not.toContain('fixture-user');
    expect(response.text).not.toContain('fixture-pass');
  });

  it('keeps credential-bearing Xtream URLs confined to the server-side resolver', async () => {
    const source = await createSource();
    const movie = await Movie.create({
      sourceId: source._id,
      externalId: 'movie-2',
      title: 'Resolver Movie',
      category: 'Test',
      streamUrl: 'https://panel.example.test:8443/movie/fixture-user/fixture-pass/movie-2.mp4',
      containerExtension: 'mp4',
      isActive: true,
    });
    const { resolveManagedPlayback } = require('../utils/playback-security');
    const playback = await resolveManagedPlayback('MOVIE', String(movie._id));
    expect(playback.url).toContain('fixture-user');
    expect(playback.url).toContain('fixture-pass');
    expect(playback.canonicalUrl).toContain('/movie/fixture-user/fixture-pass/');
  });
});
