import {
  getUpstreamProxyAgent,
  resetUpstreamProxyAgentCache,
} from './upstream-proxy';

const ORIGINAL = process.env.UPSTREAM_HTTP_PROXY;

afterEach(() => {
  resetUpstreamProxyAgentCache();
  if (ORIGINAL === undefined) {
    delete process.env.UPSTREAM_HTTP_PROXY;
  } else {
    process.env.UPSTREAM_HTTP_PROXY = ORIGINAL;
  }
});

describe('getUpstreamProxyAgent (residential egress)', () => {
  it('returns null when UPSTREAM_HTTP_PROXY is not set', () => {
    delete process.env.UPSTREAM_HTTP_PROXY;
    resetUpstreamProxyAgentCache();
    expect(getUpstreamProxyAgent()).toBeNull();
  });

  it('returns null for an invalid proxy value', () => {
    process.env.UPSTREAM_HTTP_PROXY = 'not-a-proxy';
    resetUpstreamProxyAgentCache();
    expect(getUpstreamProxyAgent()).toBeNull();
  });

  it('builds a CONNECT proxy agent from a valid http proxy URL and caches it', () => {
    process.env.UPSTREAM_HTTP_PROXY = 'http://127.0.0.1:9001';
    resetUpstreamProxyAgentCache();
    const agent = getUpstreamProxyAgent();
    expect(agent).not.toBeNull();
    // Cached: same instance on the next call without a reset.
    expect(getUpstreamProxyAgent()).toBe(agent);
  });
});
