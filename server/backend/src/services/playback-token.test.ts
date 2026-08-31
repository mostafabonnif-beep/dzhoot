import { issuePlaybackToken, verifyPlaybackToken, altStreamHash } from './playback-token';

describe('playback tokens', () => {
  const originalPlaybackTokenSecret = process.env.PLAYBACK_TOKEN_SECRET;

  beforeEach(() => {
    process.env.PLAYBACK_TOKEN_SECRET = 'test-playback-token-secret-for-ci-only-32bytes';
  });

  afterEach(() => {
    if (originalPlaybackTokenSecret === undefined) {
      delete process.env.PLAYBACK_TOKEN_SECRET;
    } else {
      process.env.PLAYBACK_TOKEN_SECRET = originalPlaybackTokenSecret;
    }
  });

  const input = {
    userId: 'user-123',
    channelListCode: 'ABC123',
    streamUrl: 'https://provider.example/live/user/secret/channel.m3u8?token=secret-value',
  };

  it('round-trips an encrypted playback URL without exposing plaintext in the token', () => {
    const issued = issuePlaybackToken(input);

    expect(issued.token).not.toContain(input.streamUrl);
    expect(issued.token).not.toContain('secret-value');
    expect(verifyPlaybackToken(issued.token)).toMatchObject(input);
  });

  it('round-trips safe upstream headers without exposing them in plaintext', () => {
    const issued = issuePlaybackToken({
      ...input,
      upstreamHeaders: {
        userAgent: 'ProviderPlayer/1.0',
        referrer: 'https://provider.example/guide',
      },
    });

    expect(issued.token).not.toContain('ProviderPlayer');
    expect(verifyPlaybackToken(issued.token)).toMatchObject({
      upstreamHeaders: {
        userAgent: 'ProviderPlayer/1.0',
        referrer: 'https://provider.example/guide',
      },
    });
  });

  it('drops header injection attempts before encryption', () => {
    const issued = issuePlaybackToken({
      ...input,
      upstreamHeaders: {
        userAgent: 'good\r\nX-Injected: yes',
        referrer: 'https://provider.example/guide',
      },
    });

    expect(verifyPlaybackToken(issued.token)?.upstreamHeaders).toEqual({
      referrer: 'https://provider.example/guide',
    });
  });

  it('preserves explicit direct-playback intent inside the encrypted token', () => {
    const issued = issuePlaybackToken({ ...input, direct: true });
    expect(verifyPlaybackToken(issued.token)?.direct).toBe(true);
  });

  it('binds a nested HLS resource token to its root playback session', () => {
    const issued = issuePlaybackToken({ ...input, sessionId: 'root-session-token' });

    expect(issued.token).not.toContain('root-session-token');
    expect(verifyPlaybackToken(issued.token)?.sessionId).toBe('root-session-token');
  });

  it('rejects tampered and expired tokens', () => {
    const issued = issuePlaybackToken({ ...input, ttlMs: 30_000 });
    const tokenParts = issued.token.split('.');
    tokenParts[3] = `${tokenParts[3].startsWith('a') ? 'b' : 'a'}${tokenParts[3].slice(1)}`;
    expect(verifyPlaybackToken(tokenParts.join('.'))).toBeNull();

    jest.useFakeTimers().setSystemTime(new Date(issued.expiresAt + 1));
    expect(verifyPlaybackToken(issued.token)).toBeNull();
    jest.useRealTimers();
  });
});

describe('v2 channel-reference playback tokens', () => {
  const originalPlaybackTokenSecret = process.env.PLAYBACK_TOKEN_SECRET;

  beforeEach(() => {
    process.env.PLAYBACK_TOKEN_SECRET = 'test-playback-token-secret-for-ci-only-32bytes';
  });

  afterEach(() => {
    if (originalPlaybackTokenSecret === undefined) {
      delete process.env.PLAYBACK_TOKEN_SECRET;
    } else {
      process.env.PLAYBACK_TOKEN_SECRET = originalPlaybackTokenSecret;
    }
  });

  const channelRefInput = {
    userId: 'user-123',
    channelListCode: 'ABC123',
    channelRef: { channelId: 'xt:6a84dce7f6a082630f39a9c3:535919', hls: true },
  };

  it('issues a compact token that references the channel instead of embedding the URL', () => {
    const { token } = issuePlaybackToken(channelRefInput);
    const payload = verifyPlaybackToken(token);

    // The v2 channel-reference token must be meaningfully smaller than the
    // legacy v1 token for the same user/channel — that is the whole point of
    // the slim list payload for low-end TV sticks.
    const legacy = issuePlaybackToken({
      userId: 'user-123',
      channelListCode: 'ABC123',
      streamUrl: 'https://provider.example/live/user/secret/channel.m3u8?token=secret-value',
    });
    expect(token.length).toBeLessThan(legacy.token.length);

    expect(payload).toMatchObject({
      v: 2,
      userId: 'user-123',
      channelListCode: 'ABC123',
      channelId: 'xt:6a84dce7f6a082630f39a9c3:535919',
      hls: true,
    });
    expect((payload as any).streamUrl).toBeUndefined();
  });

  it('round-trips an alternate stream fingerprint', () => {
    const altUrl = 'https://provider.example/alt1/index.m3u8';
    const { token } = issuePlaybackToken({
      userId: 'user-123',
      channelListCode: 'ABC123',
      channelRef: { channelId: 'xt:src:42', altUrlHash: altStreamHash(altUrl) },
    });
    const payload = verifyPlaybackToken(token) as any;
    expect(payload.altUrlHash).toBe(altStreamHash(altUrl));
    expect(payload.altUrlHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects tampered v2 tokens', () => {
    const { token } = issuePlaybackToken(channelRefInput);
    const parts = token.split('.');
    const mangled = [parts[0], parts[1], parts[2], parts[3].slice(0, -4) + 'AAAA'].join('.');
    expect(verifyPlaybackToken(mangled)).toBeNull();
  });

  it('rejects v2 tokens with an invalid alternate fingerprint', () => {
    const { token } = issuePlaybackToken({
      userId: 'user-123',
      channelListCode: 'ABC123',
      channelRef: { channelId: 'xt:src:42', altUrlHash: 'not-a-hash' },
    });
    expect(verifyPlaybackToken(token)).toBeNull();
  });

  it('carries the catalog channel ref for mid-stream proxy failover (v1)', () => {
    const { token } = issuePlaybackToken({
      userId: 'user-123',
      channelListCode: 'ABC123',
      streamUrl: 'https://provider.example/live/user/secret/42.ts',
      channelId: 'ch-abc123',
      primarySourceId: 'src-neo',
    });
    const payload = verifyPlaybackToken(token) as any;
    expect(payload.v).toBe(1);
    expect(payload.channelId).toBe('ch-abc123');
    expect(payload.primarySourceId).toBe('src-neo');
  });

  it('still verifies legacy v1 tokens after the v2 change', () => {
    const { token } = issuePlaybackToken({
      userId: 'user-123',
      channelListCode: 'ABC123',
      streamUrl: 'https://provider.example/live/user/secret/channel.m3u8?token=secret-value',
    });
    const payload = verifyPlaybackToken(token) as any;
    expect(payload.v).toBe(1);
    expect(payload.streamUrl).toBe('https://provider.example/live/user/secret/channel.m3u8?token=secret-value');
  });
});
