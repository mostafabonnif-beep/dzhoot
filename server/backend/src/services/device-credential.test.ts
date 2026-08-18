import { encryptDeviceCredential, hashDeviceCredential, issueDeviceCredential } from './device-credential';

describe('device credential', () => {
  it('creates a high-entropy credential and only exposes the hash for persistence', () => {
    const issued = issueDeviceCredential({ userId: 'u1', deviceId: 'd1' });
    expect(issued.token.startsWith('dzdev1.')).toBe(true);
    expect(issued.token.length).toBeGreaterThan(40);
    expect(issued.tokenHash).toBe(hashDeviceCredential(issued.token));
    expect(issued.tokenHash).not.toBe(issued.token);
  });
});


describe('production encryption secret policy', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.PLAYBACK_TOKEN_SECRET;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalSecret === undefined) delete process.env.PLAYBACK_TOKEN_SECRET;
    else process.env.PLAYBACK_TOKEN_SECRET = originalSecret;
  });

  it('rejects weak production secret during credential encryption', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLAYBACK_TOKEN_SECRET = 'short';
    expect(() => encryptDeviceCredential('dzdev1.test')).toThrow('PLAYBACK_TOKEN_SECRET must be at least 32 characters in production');
  });
});
