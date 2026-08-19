import { resolveUpstreamUrl } from './upstream-proxy';

describe('resolveUpstreamUrl', () => {
  const finalUrl = 'https://cdn.example.test/live/region/master.m3u8';

  test.each([
    ['relative/path.m3u8', 'https://cdn.example.test/live/region/relative/path.m3u8'],
    ['../playlist.m3u8', 'https://cdn.example.test/live/playlist.m3u8'],
    ['../../segment.ts', 'https://cdn.example.test/segment.ts'],
    ['segment001.ts', 'https://cdn.example.test/live/region/segment001.ts'],
    ['/path/segment.ts', 'https://cdn.example.test/path/segment.ts'],
    ['https://absolute.example/segment.ts', 'https://absolute.example/segment.ts'],
  ])('resolves %s correctly', (rawUrl, expected) => {
    expect(resolveUpstreamUrl(rawUrl, finalUrl)).toBe(expected);
  });
});
