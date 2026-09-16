import { issueOAuthState, consumeOAuthState, _resetForTests } from './oauth-state';

const fakeRedis = {
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(0),
};

jest.mock('../services/redis', () => ({
  getRedisClient: () => (global as any).__fakeRedisForOauth,
}));

/**
 * OAuth state used to live in a process-global Map only: a deploy (the API runs
 * in a container that is replaced on every release) or a second replica turned
 * every in-flight Google/GitHub sign-in into "Invalid or missing state parameter".
 * It is now mirrored into Redis while the in-process map keeps working — so a
 * Redis outage degrades to the old behaviour instead of breaking sign-in.
 */
describe('OAuth CSRF state store', () => {
  beforeEach(() => {
    (global as any).__fakeRedisForOauth = fakeRedis;
    fakeRedis.set.mockClear().mockResolvedValue('OK');
    fakeRedis.del.mockClear().mockResolvedValue(0);
    _resetForTests();
  });

  it('issues a state that can be consumed once', async () => {
    const state = await issueOAuthState();

    expect(state).toMatch(/^[0-9a-f]{32}$/);
    await expect(consumeOAuthState(state)).resolves.toEqual({ ok: true, expired: false });
    // One-time use: a replayed callback must fail.
    await expect(consumeOAuthState(state)).resolves.toEqual({ ok: false, expired: false });
  });

  it('mirrors the state into Redis so it survives a restart', async () => {
    const state = await issueOAuthState();
    expect(fakeRedis.set).toHaveBeenCalledWith(
      `dzhoof:oauth:state:${state}`,
      '1',
      'PX',
      expect.any(Number),
    );

    // Simulate the container being replaced: the in-process map is empty, but
    // Redis still holds the state, so Redis reports the delete.
    _resetForTests();
    fakeRedis.del.mockResolvedValue(1);

    await expect(consumeOAuthState(state)).resolves.toEqual({ ok: true, expired: false });
  });

  it('reports an expired local state as expired', async () => {
    (global as any)._oauthStates.set('expiredstate', { expiresAt: Date.now() - 1000 });

    await expect(consumeOAuthState('expiredstate')).resolves.toEqual({ ok: false, expired: true });
  });

  it('rejects an unknown or empty state', async () => {
    await expect(consumeOAuthState('not-issued')).resolves.toEqual({ ok: false, expired: false });
    await expect(consumeOAuthState('')).resolves.toEqual({ ok: false, expired: false });
    await expect(consumeOAuthState(undefined as unknown as string)).resolves.toEqual({
      ok: false,
      expired: false,
    });
  });

  it('keeps working when Redis is unavailable', async () => {
    (global as any).__fakeRedisForOauth = {
      set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      del: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };

    const state = await issueOAuthState();
    await expect(consumeOAuthState(state)).resolves.toEqual({ ok: true, expired: false });
  });
});
