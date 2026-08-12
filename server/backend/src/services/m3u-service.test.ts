import { parseM3U } from './m3u-service';

describe('parseM3U', () => {
  it('parses EXTINF metadata and preserves commas inside quoted attributes', () => {
    const content = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="news" tvg-name="News" tvg-logo="https://cdn.example/logo?x=1,2" group-title="News",Channel, HD',
      'https://stream.example/live/news.m3u8',
    ].join('\n');

    const channels = parseM3U(content, 'source-1');

    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({
      channelName: 'Channel, HD',
      tvgId: 'news',
      channelImg: 'https://cdn.example/logo?x=1,2',
      channelGroup: 'News',
      channelUrl: 'https://stream.example/live/news.m3u8',
    });
    expect(channels[0].channelId).toMatch(/^m3u:source-1:/);
  });

  it('creates a stable identifier from the URL when tvg-id is absent', () => {
    const content = [
      '#EXTM3U',
      '#EXTINF:-1 group-title="Sports",Sports One',
      'https://stream.example/sports.m3u8',
    ].join('\n');

    const first = parseM3U(content, 'source-2')[0];
    const second = parseM3U(content, 'source-2')[0];

    expect(first.channelId).toBe(second.channelId);
  });

  it('rejects playlists exceeding the configured line limit', () => {
    const content = ['#EXTM3U', ...Array.from({ length: 100001 }, () => '#comment')].join('\n');
    expect(() => parseM3U(content, 'source-3')).toThrow('too many lines');
  });
});
