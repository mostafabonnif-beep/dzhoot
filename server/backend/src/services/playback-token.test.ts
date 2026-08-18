import { issuePlaybackToken, verifyPlaybackToken } from './playback-token';

describe('playback tokens', () => {
  const input = {
    userId: 'user-123',
    channelListCode: 'ABC123',
    streamUrl: 'https://provider.example/live/user/secret/channel.m3u8?token=secret-value',
    credentialVersion: 7,
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

  it('preserves credential version and rejects tokens without it', () => {
    const issued = issuePlaybackToken(input);
    expect(verifyPlaybackToken(issued.token)?.credentialVersion).toBe(7);

    const parts = issued.token.split('.');
    const payload = JSON.parse(Buffer.from(parts[2], 'base64url').toString('utf8'));
    delete payload.credentialVersion;
    parts[2] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(verifyPlaybackToken(parts.join('.'))).toBeNull();
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

it('binds device-issued playback tokens to the device credential version', () => {
  const issued = issuePlaybackToken({
    userId: 'user-123',
    channelListCode: 'ABC123',
    credentialVersion: 7,
    deviceId: 'living-room-tv',
    deviceCredentialVersion: 3,
    streamUrl: 'https://provider.example/live/channel.m3u8',
  });

  expect(verifyPlaybackToken(issued.token)).toMatchObject({
    deviceId: 'living-room-tv',
    deviceCredentialVersion: 3,
  });
});
