import mongoose from 'mongoose';

const {
  sanitizeManagedContent,
  buildPlaybackUrlForBase,
  isManagedContent,
} = require('../utils/playback-security');

describe('S1.4 production playback boundary', () => {
  const id = new mongoose.Types.ObjectId();
  const req = { protocol: 'https', get: () => 'api.example.test' };

  it('rejects raw TV proxy URL inputs at both resolver boundaries', async () => {
    const tv = require('../routes/tv');
    const proxy = require('../routes/stream-proxy');
    expect(tv).toBeDefined();
    expect(proxy).toBeDefined();
    const tvSource = require('fs').readFileSync(require.resolve('../routes/tv'), 'utf8');
    const proxySource = require('fs').readFileSync(require.resolve('../routes/stream-proxy'), 'utf8');
    expect(tvSource).not.toContain('proxyResolvedStream(req, res, url');
    expect(proxySource).not.toContain('if (!managedRequest)');
    expect(proxySource).toContain('if (url || !contentType || !contentId');
  });

  it('does not expose persisted managed URLs in sanitized content', () => {
    const value = sanitizeManagedContent({
      _id: id,
      sourceId: new mongoose.Types.ObjectId(),
      streamUrl: 'https://user:password@upstream.example/movie/user/password/200.mp4',
      channelUrl: 'https://user:password@upstream.example/live/user/password/200.m3u8',
      originalUrl: 'https://user:password@upstream.example/raw',
      externalId: '200',
      containerExtension: 'mp4',
      isActive: true,
    }, 'MOVIE', req);
    expect(value.streamUrl).toBeUndefined();
    expect(value.channelUrl).toBeUndefined();
    expect(value.originalUrl).toBeUndefined();
    expect(value.playbackUrl).toBe(buildPlaybackUrlForBase('https://api.example.test', 'MOVIE', id));
    expect(JSON.stringify(value)).not.toMatch(/upstream|username|password|user:password/i);
  });

  it('never treats an unmanaged record as managed playback', () => {
    expect(isManagedContent({ _id: id, streamUrl: 'https://public.example/live.m3u8' }, 'MOVIE')).toBe(false);
    expect(isManagedContent({ _id: id, channelUrl: 'https://public.example/live.m3u8' }, 'LIVE')).toBe(false);
  });
});
