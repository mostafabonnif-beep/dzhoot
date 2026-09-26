import { parseUpstreamProxyHosts, upstreamHostNeedsProxy } from './upstream-proxy-hosts';

describe('upstream-proxy-hosts', () => {
  describe('parseUpstreamProxyHosts', () => {
    it('splits, trims and lowercases the configured suffixes', () => {
      expect(parseUpstreamProxyHosts(' Provider.example , cf.provider.example ')).toEqual([
        'provider.example',
        'cf.provider.example',
      ]);
    });

    it('treats unset and blank as "proxy nothing"', () => {
      // The safe default: configuring UPSTREAM_HTTP_PROXY must not, on its own, route
      // every upstream through the relay.
      expect(parseUpstreamProxyHosts(undefined)).toEqual([]);
      expect(parseUpstreamProxyHosts('')).toEqual([]);
      expect(parseUpstreamProxyHosts('  ,  , ')).toEqual([]);
    });
  });

  describe('upstreamHostNeedsProxy', () => {
    it('matches the exact host and any subdomain', () => {
      const suffixes = ['provider.example'];
      expect(upstreamHostNeedsProxy('http://provider.example/live/u/p/1.m3u8', suffixes)).toBe(true);
      expect(upstreamHostNeedsProxy('https://cf.provider.example/live/u/p/1.m3u8', suffixes)).toBe(true);
    });

    it('does not match a lookalike suffix', () => {
      expect(upstreamHostNeedsProxy('https://provider.example.evil/live/1.m3u8', ['provider.example'])).toBe(false);
      expect(upstreamHostNeedsProxy('https://cf.provider.example.ru/live/1.m3u8', ['provider.example'])).toBe(false);
    });

    it('proxies nothing when no suffix is configured', () => {
      expect(upstreamHostNeedsProxy('http://panel.example/live/1.m3u8', [])).toBe(false);
    });

    it('never breaks the direct path on an unparseable URL', () => {
      expect(upstreamHostNeedsProxy('not a url', ['provider.example'])).toBe(false);
    });

    it('is shared by both egress paths (regression guard)', () => {
      // hls-remux-service (ffmpeg -http_proxy) re-exports these helpers; the playback
      // fetch path imports them directly. They used to disagree — this asserts there is
      // exactly one rule.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const remux = require('./hls-remux-service');
      expect(remux.upstreamHostNeedsProxy).toBe(upstreamHostNeedsProxy);
    });
  });
});
