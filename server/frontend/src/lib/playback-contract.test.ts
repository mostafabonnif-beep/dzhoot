import { resolvePlaybackSource } from './playback-contract';

describe('secure playback contract', () => {
  it('uses playbackUrl for managed content without requiring channelUrl', () => {
    const source = resolvePlaybackSource({
      name: 'Managed live',
      managed: true,
      playbackUrl: '/api/v1/stream-proxy?contentType=LIVE&contentId=abc',
    });
    expect(source).toEqual({
      url: '/api/v1/stream-proxy?contentType=LIVE&contentId=abc',
      managed: true,
    });
  });

  it('fails safely when managed playbackUrl is absent', () => {
    expect(() => resolvePlaybackSource({ name: 'Managed live', managed: true })).toThrow(
      'Secure playback is unavailable',
    );
  });

  it('does not construct an upstream URL or accept credentials as managed playback', () => {
    const source = resolvePlaybackSource({
      name: 'Managed live',
      playbackUrl: '/api/v1/tv/stream/code?contentType=LIVE&contentId=abc',
      url: 'https://user:password@example.test/live/user/password/abc.m3u8',
    });
    expect(source.url).not.toContain('user:password');
    expect(source.url).not.toContain('example.test');
  });

  it('preserves non-managed local playback as a separate contract', () => {
    expect(resolvePlaybackSource({ name: 'Imported local', url: '/local/live.m3u8' })).toEqual({
      url: '/local/live.m3u8',
      managed: false,
    });
  });
});
