import { issuePlaybackToken, verifyPlaybackToken } from './playback-token';

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


describe('device-scoped playback tokens', () => {
  const originalPlaybackTokenSecret = process.env.PLAYBACK_TOKEN_SECRET;

  beforeEach(() => {
    process.env.PLAYBACK_TOKEN_SECRET = 'test-playback-token-secret-for-ci-only-32bytes';
  });

  afterEach(() => {
    if (originalPlaybackTokenSecret === undefined) delete process.env.PLAYBACK_TOKEN_SECRET;
    else process.env.PLAYBACK_TOKEN_SECRET = originalPlaybackTokenSecret;
  });

  it('binds a v2 token to one device token generation without exposing the source URL', () => {
    const sourceUrl = 'https://provider.example/live/user/secret/channel.m3u8?token=secret-value';
    const issued = issuePlaybackToken({
      userId: 'user-123',
      streamUrl: sourceUrl,
      deviceId: 'dz-tv-123',
      deviceTokenIssuedAt: 1_725_000_000_000,
      sessionId: 'root-session-token',
    });

    const payload = verifyPlaybackToken(issued.token);
    expect(issued.token).not.toContain(sourceUrl);
    expect(payload).toMatchObject({
      v: 2,
      userId: 'user-123',
      deviceId: 'dz-tv-123',
      deviceTokenIssuedAt: 1_725_000_000_000,
      sessionId: 'root-session-token',
    });
  });
});
