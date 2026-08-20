import {
  getMaxConcurrentStreams,
  registerStreamSession,
  sessionKeyFor,
  userKeyFor,
  isStreamSessionActive,
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

class AtomicFakeStore extends FakeStore {
  evalCalls: Array<Array<string | number>> = [];

  async eval(_script: string, _numKeys: number, ...args: Array<string | number>) {
    this.evalCalls.push(args);
    return 1;
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
    expect(result).toMatchObject({ allowed: true, max: getMaxConcurrentStreams(), active: 0, evictedSessionId: null });
  });

  it('passes the session ID to the atomic Redis script in the ARGV[3] position', async () => {
    const store = new AtomicFakeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, now, store });

    expect(store.evalCalls).toEqual([[
      userKeyFor('u1'),
      sessionKeyFor('s1'),
      2,
      now,
      's1',
      600,
      86_400,
    ]]);
  });

  it('registers a session and reports the active count', async () => {
    const store = new FakeStore();
    const result = await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, now, store });
    expect(result.max).toBeGreaterThanOrEqual(1);
    expect(result.active).toBe(1);
    expect(result.evictedSessionId).toBeNull();
    expect(await store.exists(sessionKeyFor('s1'))).toBe(1);
  });

  it('rejects a new session when the concurrent limit is reached', async () => {
    const store = new FakeStore();
    const max = 2;
    await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, maxConcurrentStreams: max, now, store });
    await registerStreamSession({ userId: 'u1', sessionId: 's2', ttlSec: 300, maxConcurrentStreams: max, now: now + 60_000, store });
    const result = await registerStreamSession({
      userId: 'u1',
      sessionId: 's3',
      ttlSec: 300,
      maxConcurrentStreams: max,
      now: now + 120_000,
      store,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('LIMIT_REACHED');
    expect(result.active).toBe(max);
    expect(await store.exists(sessionKeyFor('s1'))).toBe(1);
    expect(await store.exists(sessionKeyFor('s2'))).toBe(1);
    expect(await store.exists(sessionKeyFor('s3'))).toBe(0);
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
  it('requires the registered session to remain active', async () => {
    const store = new FakeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, now, store });
    expect(await isStreamSessionActive('u1', 's1', store)).toBe(true);
    await store.del(sessionKeyFor('s1'));
    expect(await isStreamSessionActive('u1', 's1', store)).toBe(false);
  });

});
