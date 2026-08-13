import {
  getMaxConcurrentStreams,
  registerStreamSession,
  sessionKeyFor,
  userKeyFor,
  StreamSessionStore,
} from './stream-session-service';

/** In-memory fake of the ioredis surface the service uses. */
class FakeStore implements StreamSessionStore {
  zsets = new Map<string, Map<string, number>>();
  keys = new Map<string, { value: string; ttlSec: number; expiresAt: number }>();

  async zadd(key: string, score: number, member: string) {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    this.zsets.get(key)!.set(member, score);
    return 1;
  }

  async zcard(key: string) {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zrange(key: string, start: number, stop: number) {
    const entries = [...(this.zsets.get(key)?.entries() ?? [])].sort((a, b) => a[1] - b[1]);
    const end = stop < 0 ? entries.length + stop : Math.min(stop, entries.length - 1);
    return entries.slice(start, end + 1).map(([member]) => member);
  }

  async zrem(key: string, member: string) {
    return this.zsets.get(key)?.delete(member) ? 1 : 0;
  }

  async set(key: string, value: string, mode: string, ttl: number) {
    this.keys.set(key, { value, ttlSec: ttl, expiresAt: Date.now() + ttl * 1000 });
    return 'OK';
  }

  async exists(key: string) {
    const entry = this.keys.get(key);
    if (!entry) return 0;
    if (entry.expiresAt <= Date.now()) {
      this.keys.delete(key);
      return 0;
    }
    return 1;
  }

  async del(key: string) {
    return this.keys.delete(key) ? 1 : 0;
  }

  async expire(key: string, _seconds: number) {
    return this.zsets.has(key) ? 1 : 0;
  }
}

describe('registerStreamSession', () => {
  const now = Date.parse('2026-08-12T12:00:00Z');

  it('returns the configured max when the store is unavailable (Redis disabled)', async () => {
    const result = await registerStreamSession({
      userId: 'u1',
      sessionId: 's1',
      ttlSec: 300,
      now,
      store: null,
    });
    expect(result).toEqual({ max: getMaxConcurrentStreams(), active: 0, evictedSessionId: null });
  });

  it('registers a session and reports the active count', async () => {
    const store = new FakeStore();
    const result = await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, now, store });
    expect(result.max).toBeGreaterThanOrEqual(1);
    expect(result.active).toBe(1);
    expect(result.evictedSessionId).toBeNull();
    expect(await store.exists(sessionKeyFor('s1'))).toBe(1);
  });

  it('evicts the OLDEST session when the user exceeds the limit', async () => {
    const store = new FakeStore();
    const max = getMaxConcurrentStreams();
    const sessions = Array.from({ length: max + 2 }, (_, i) => `s${i + 1}`);

    let active = 0;
    for (let i = 0; i < sessions.length; i += 1) {
      const result = await registerStreamSession({
        userId: 'u1',
        sessionId: sessions[i],
        ttlSec: 300,
        now: now + i * 60_000,
        store,
      });
      active = result.active;
    }

    // Two extras were registered — the two oldest (s1, s2) must have been evicted.
    expect(active).toBe(max);
    expect(await store.exists(sessionKeyFor('s1'))).toBe(0);
    expect(await store.exists(sessionKeyFor('s2'))).toBe(0);
    expect(await store.exists(sessionKeyFor(sessions[max]))).toBe(1);
    expect(await store.exists(sessionKeyFor(sessions[max + 1]))).toBe(1);
  });

  it('prunes sessions whose keys have expired (crashed streams free their slot)', async () => {
    const store = new FakeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 'dead', ttlSec: 60, now, store });
    // Let the dead session's key expire.
    const deadKey = sessionKeyFor('dead');
    const entry = store.keys.get(deadKey)!;
    entry.expiresAt = Date.now() - 1;

    const result = await registerStreamSession({ userId: 'u1', sessionId: 'alive', ttlSec: 300, now, store });
    expect(result.active).toBe(1);
    expect(await store.exists(deadKey)).toBe(0);
    expect(await store.exists(sessionKeyFor('alive'))).toBe(1);
  });

  it('scopes sessions per user', async () => {
    const store = new FakeStore();
    const max = getMaxConcurrentStreams();
    for (let i = 0; i < max; i += 1) {
      await registerStreamSession({ userId: 'u1', sessionId: `u1-s${i}`, ttlSec: 300, now: now + i, store });
    }
    const result = await registerStreamSession({ userId: 'u2', sessionId: 'u2-s0', ttlSec: 300, now, store });
    expect(result.active).toBe(1);
    expect(result.evictedSessionId).toBeNull();
    expect(await store.zcard(userKeyFor('u1'))).toBe(max);
    expect(await store.zcard(userKeyFor('u2'))).toBe(1);
  });
});
