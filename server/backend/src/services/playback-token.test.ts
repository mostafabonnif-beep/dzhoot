import { issuePlaybackToken, verifyPlaybackToken } from './playback-token';

describe('playback tokens', () => {
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
