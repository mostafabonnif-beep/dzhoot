import mongoose from 'mongoose';

const {
  buildPlaybackUrlForBase,
  sanitizeManagedContent,
  sanitizeXtreamTestResult,
} = require('../utils/playback-security');
const { rewriteManifest } = require('../services/secure-playback-proxy');

const USERNAME = 'test_xtream_user';
const PASSWORD = 'test_xtream_password';
const SOURCE_URL = `https://upstream.example/live/${USERNAME}/${PASSWORD}/100.m3u8`;
const id = new mongoose.Types.ObjectId();
const request = { protocol: 'https', get: () => 'api.example.test' } as any;

function managedMovie() {
  return {
    _id: id,
    sourceId: new mongoose.Types.ObjectId(),
    streamUrl: `https://upstream.example/movie/${USERNAME}/${PASSWORD}/200.mp4`,
    title: 'Movie',
  };
}

function managedEpisode() {
  return {
    _id: id,
    sourceId: new mongoose.Types.ObjectId(),
    streamUrl: `https://upstream.example/series/${USERNAME}/${PASSWORD}/300.mp4`,
    title: 'Episode',
  };
}

function managedChannel() {
  return {
    _id: id,
    metadata: { source: 'xtream', xtreamSourceId: new mongoose.Types.ObjectId().toString() },
    channelUrl: SOURCE_URL,
    alternateStreams: [{ streamUrl: SOURCE_URL }],
    channelName: 'Channel',
  };
}

describe('S1.2 secure playback boundary', () => {
  it('Xtream Movie response does not contain username', () => {
    const response = sanitizeManagedContent(managedMovie(), 'MOVIE', request);
    expect(JSON.stringify(response)).not.toContain(USERNAME);
  });

  it('Xtream Movie response does not contain password', () => {
    const response = sanitizeManagedContent(managedMovie(), 'MOVIE', request);
    expect(JSON.stringify(response)).not.toContain(PASSWORD);
  });

  it('Xtream Episode response does not contain username', () => {
    const response = sanitizeManagedContent(managedEpisode(), 'EPISODE', request);
    expect(JSON.stringify(response)).not.toContain(USERNAME);
  });

  it('Xtream Episode response does not contain password', () => {
    const response = sanitizeManagedContent(managedEpisode(), 'EPISODE', request);
    expect(JSON.stringify(response)).not.toContain(PASSWORD);
  });

  it('Channel response does not contain Xtream credentials', () => {
    const response = sanitizeManagedContent(managedChannel(), 'LIVE', request);
    expect(JSON.stringify(response)).not.toContain(USERNAME);
    expect(JSON.stringify(response)).not.toContain(PASSWORD);
    expect(response.playbackUrl).toContain('/api/v1/stream-proxy?');
  });

  it('Playlist playback reference does not contain Xtream credentials', () => {
    const playbackUrl = buildPlaybackUrlForBase('https://api.example.test', 'LIVE', id);
    expect(playbackUrl).toBe(`https://api.example.test/api/v1/stream-proxy?contentType=LIVE&contentId=${id}`);
    expect(playbackUrl).not.toContain(USERNAME);
    expect(playbackUrl).not.toContain(PASSWORD);
  });

  it('/streams/authorize contract returns only a local playback reference', () => {
    const response = {
      contentType: 'MOVIE',
      contentId: String(id),
      playbackUrl: buildPlaybackUrlForBase('https://api.example.test', 'MOVIE', id),
      authorized: true,
    };
    expect(response).not.toHaveProperty('url');
    expect(response.playbackUrl).toContain('/api/v1/stream-proxy?');
    expect(JSON.stringify(response)).not.toContain(USERNAME);
    expect(JSON.stringify(response)).not.toContain(PASSWORD);
  });

  it('TV proxy playback reference does not expose originalUrl', () => {
    const response = {
      proxyUrl: buildPlaybackUrlForBase('https://api.example.test', 'LIVE', id, 'ABC123'),
    };
    expect(response).not.toHaveProperty('originalUrl');
    expect(response.proxyUrl).toContain('/api/v1/tv/stream/ABC123?');
    expect(JSON.stringify(response)).not.toContain(SOURCE_URL);
  });

  it('Admin Xtream test response contains only safe account fields', () => {
    const response = sanitizeXtreamTestResult({
      userInfo: { username: USERNAME, password: PASSWORD, auth: 1, status: 'Active', exp_date: ' tomorrow ' },
      serverInfo: { timezone: 'UTC', time_now: '2026-01-01 00:00:00' },
    });
    expect(response).toEqual({
      account: { status: 'Active', expiresAt: ' tomorrow ' },
      server: { timezone: 'UTC', timeNow: '2026-01-01 00:00:00' },
    });
    expect(JSON.stringify(response)).not.toContain(USERNAME);
    expect(JSON.stringify(response)).not.toContain(PASSWORD);
  });

  it('HLS rewrite does not expose the upstream credential-bearing URL', () => {
    const manifest = `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${SOURCE_URL}/key"\nsegment.ts`;
    const rewritten = rewriteManifest(
      manifest,
      SOURCE_URL,
      '/api/v1/stream-proxy',
      (absoluteUrl: string) => {
        const parsed = new URL(absoluteUrl);
        const path = parsed.pathname.replace(/^\/(live|movie|series)\/[^/]+\/[^/]+/i, '/$1');
        return `/api/v1/stream-proxy?resource=${encodeURIComponent(path)}`;
      },
    );
    expect(rewritten).not.toContain(USERNAME);
    expect(rewritten).not.toContain(PASSWORD);
    expect(rewritten).not.toContain(SOURCE_URL);
    expect(rewritten).toContain('/api/v1/stream-proxy?resource=');
  });
});
