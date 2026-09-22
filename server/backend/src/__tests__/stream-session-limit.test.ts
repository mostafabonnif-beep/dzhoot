/**
 * Concurrent-stream limit policy tests.
 *
 * Business rule under test: a subscription must not be watchable from two
 * different devices at the same time (each extra device burns provider
 * capacity), WITHOUT breaking the legitimate cases — reconnecting / refreshing
 * the network / Multiview on the SAME device, which must keep working.
 *
 * The two code paths of `registerStreamSession` are both exercised:
 *  - 'redis-lua': the atomic EVAL path used in production. The fake below
 *    mirrors that script's decision order (ZCARD → ZRANGE 0 0 → GET +
 *    cjson.decode of the oldest session → ZREM+DEL or refuse → ZADD/SET/EXPIRE)
 *    and records the script + ARGV so the JS↔Lua wiring is asserted too.
 *  - 'js-fallback': the non-atomic path used when the store has no EVAL.
 */
import {
  countUserStreamSessions,
  getStreamLimitPolicy,
  registerStreamSession,
  sessionKeyFor,
  userKeyFor,
  StreamSessionStore,
} from '../services/stream-session-service';
// Plain CommonJS util shared by the .js route modules.
import { hashStreamDeviceValue, resolveStreamDeviceHash } from '../utils/stream-device-hash';
import type { Request } from 'express';

/** In-memory fake of the ioredis surface the service uses. */
class MemoryStore implements StreamSessionStore {
  zsets = new Map<string, Map<string, number>>();
  keys = new Map<string, { value: string; expiresAt: number }>();

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
    this.keys.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
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

  async get(key: string) {
    const entry = this.keys.get(key);
    if (!entry) return null;
    return entry.value;
  }
}

/** Store that also implements EVAL, mirroring the production Lua script. */
class AtomicStore extends MemoryStore {
  evals: Array<{ script: string; args: Array<string | number> }> = [];

  async eval(script: string, _numKeys: number, ...args: Array<string | number>) {
    this.evals.push({ script, args });
    const [, sessionKey, max, now, sessionId, ttl, userTtl, prefix, sessionValue, deviceHash, refuse] =
      args as [string, string, number, number, string, number, number, string, string, string, string];
    const userKey = String(args[0]);

    const count = await this.zcard(userKey);
    let evicted = '';
    if (count >= Number(max)) {
      const [oldest] = await this.zrange(userKey, 0, 0);
      if (oldest) {
        let sameDevice = false;
        if (String(refuse) === '1' && String(deviceHash) !== '') {
          const raw = await this.get(String(prefix) + oldest);
          if (raw && raw !== '1') {
            try {
              sameDevice = (JSON.parse(raw) as { deviceHash?: string }).deviceHash === deviceHash;
            } catch {
              sameDevice = false;
            }
          }
        }
        if (String(refuse) === '1' && !sameDevice) return ['refused', oldest, count];
        evicted = oldest;
        await this.zrem(userKey, evicted);
        await this.del(String(prefix) + evicted);
      }
    }
    await this.zadd(userKey, Number(now), String(sessionId));
    await this.set(String(sessionKey), String(sessionValue), 'EX', Number(ttl));
    await this.expire(userKey, Number(userTtl));
    return evicted ? ['evicted', evicted, count] : ['ok', '', count];
  }
}

type StoreFactory = () => MemoryStore;

const PATHS: Array<[string, StoreFactory]> = [
  ['redis-lua (atomic EVAL)', () => new AtomicStore()],
  ['js-fallback (no EVAL)', () => new MemoryStore()],
];

const originalPolicy = process.env.STREAM_LIMIT_POLICY;
afterEach(() => {
  if (originalPolicy === undefined) delete process.env.STREAM_LIMIT_POLICY;
  else process.env.STREAM_LIMIT_POLICY = originalPolicy;
});

describe.each(PATHS)('concurrent stream limit — %s', (_name, makeStore) => {
  const NOW = Date.parse('2026-09-22T10:00:00Z');
  const MAX = 2;

  it('allows the SAME device at the limit: the oldest session of that device is evicted', async () => {
    const store = makeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW, store, deviceHash: 'dev-a' });
    await registerStreamSession({ userId: 'u1', sessionId: 's2', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW + 1000, store, deviceHash: 'dev-a' });

    const result = await registerStreamSession({
      userId: 'u1',
      sessionId: 's3',
      ttlSec: 300,
      maxConcurrentStreams: MAX,
      now: NOW + 2000,
      store,
      deviceHash: 'dev-a',
    });

    expect(result).toMatchObject({ allowed: true, max: MAX, active: MAX, evictedSessionId: 's1' });
    expect(result.reason).toBeUndefined();
    expect(await store.exists(sessionKeyFor('s1'))).toBe(0);
    expect(await store.exists(sessionKeyFor('s2'))).toBe(1);
    expect(await store.exists(sessionKeyFor('s3'))).toBe(1);
  });

  it('refuses a DIFFERENT device at the limit and evicts nothing', async () => {
    const store = makeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW, store, deviceHash: 'dev-a' });
    await registerStreamSession({ userId: 'u1', sessionId: 's2', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW + 1000, store, deviceHash: 'dev-a' });

    const result = await registerStreamSession({
      userId: 'u1',
      sessionId: 'other-device',
      ttlSec: 300,
      maxConcurrentStreams: MAX,
      now: NOW + 2000,
      store,
      deviceHash: 'dev-b',
    });

    expect(result).toEqual({
      allowed: false,
      max: MAX,
      active: MAX,
      evictedSessionId: null,
      reason: 'concurrent-limit',
    });
    // Nothing was evicted and the refused session was NOT registered.
    expect(await store.exists(sessionKeyFor('s1'))).toBe(1);
    expect(await store.exists(sessionKeyFor('s2'))).toBe(1);
    expect(await store.exists(sessionKeyFor('other-device'))).toBe(0);
    expect(await store.zcard(userKeyFor('u1'))).toBe(MAX);
    expect(await countUserStreamSessions('u1', { store })).toBe(MAX);
  });

  it('refuses a request with no device identity at the limit (unknown device != same device)', async () => {
    const store = makeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW, store, deviceHash: 'dev-a' });
    await registerStreamSession({ userId: 'u1', sessionId: 's2', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW + 1000, store, deviceHash: 'dev-a' });

    const result = await registerStreamSession({
      userId: 'u1',
      sessionId: 'anonymous',
      ttlSec: 300,
      maxConcurrentStreams: MAX,
      now: NOW + 2000,
      store,
    });

    expect(result).toMatchObject({ allowed: false, reason: 'concurrent-limit', evictedSessionId: null });
    expect(await store.exists(sessionKeyFor('anonymous'))).toBe(0);
  });

  it('still allows a same-device reconnect below the limit', async () => {
    const store = makeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 'first', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW, store, deviceHash: 'dev-a' });
    const result = await registerStreamSession({
      userId: 'u1',
      sessionId: 'second',
      ttlSec: 300,
      maxConcurrentStreams: MAX,
      now: NOW + 1000,
      store,
      deviceHash: 'dev-a',
    });
    expect(result).toMatchObject({ allowed: true, active: 2, evictedSessionId: null });
  });

  it('treats a legacy session (bare "1" marker) as an unknown device — no crash, refusal', async () => {
    const store = makeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 'legacy', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW, store });
    store.keys.set(sessionKeyFor('legacy'), { value: '1', expiresAt: Date.now() + 60_000 });
    await registerStreamSession({ userId: 'u1', sessionId: 's2', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW + 1000, store, deviceHash: 'dev-a' });

    const result = await registerStreamSession({
      userId: 'u1',
      sessionId: 's3',
      ttlSec: 300,
      maxConcurrentStreams: MAX,
      now: NOW + 2000,
      store,
      deviceHash: 'dev-a',
    });
    expect(result).toMatchObject({ allowed: false, reason: 'concurrent-limit' });
  });

  it('survives a malformed session payload without throwing (unknown device → refusal)', async () => {
    const store = makeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 'broken', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW, store, deviceHash: 'dev-a' });
    store.keys.set(sessionKeyFor('broken'), { value: '{not-json', expiresAt: Date.now() + 60_000 });
    await registerStreamSession({ userId: 'u1', sessionId: 's2', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW + 1000, store, deviceHash: 'dev-a' });

    const result = await registerStreamSession({
      userId: 'u1',
      sessionId: 's3',
      ttlSec: 300,
      maxConcurrentStreams: MAX,
      now: NOW + 2000,
      store,
      deviceHash: 'dev-a',
    });
    expect(result).toMatchObject({ allowed: false, reason: 'concurrent-limit' });
  });

  it('keeps the legacy evict behaviour when STREAM_LIMIT_POLICY=evict (instant rollback)', async () => {
    process.env.STREAM_LIMIT_POLICY = 'evict';
    const store = makeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW, store, deviceHash: 'dev-a' });
    await registerStreamSession({ userId: 'u1', sessionId: 's2', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW + 1000, store, deviceHash: 'dev-a' });

    const result = await registerStreamSession({
      userId: 'u1',
      sessionId: 'dev-b-session',
      ttlSec: 300,
      maxConcurrentStreams: MAX,
      now: NOW + 2000,
      store,
      deviceHash: 'dev-b',
    });

    expect(result).toMatchObject({ allowed: true, active: MAX, evictedSessionId: 's1' });
    expect(await store.exists(sessionKeyFor('s1'))).toBe(0);
    expect(await store.exists(sessionKeyFor('dev-b-session'))).toBe(1);
  });

  it('honours an explicit per-call policy even when the env says otherwise', async () => {
    process.env.STREAM_LIMIT_POLICY = 'evict';
    const store = makeStore();
    await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW, store, deviceHash: 'dev-a' });
    await registerStreamSession({ userId: 'u1', sessionId: 's2', ttlSec: 300, maxConcurrentStreams: MAX, now: NOW + 1000, store, deviceHash: 'dev-a' });

    const result = await registerStreamSession({
      userId: 'u1',
      sessionId: 's3',
      ttlSec: 300,
      maxConcurrentStreams: MAX,
      now: NOW + 2000,
      store,
      deviceHash: 'dev-b',
      policy: 'refuse',
    });

    expect(result).toMatchObject({ allowed: false, reason: 'concurrent-limit' });
    expect(await store.exists(sessionKeyFor('s1'))).toBe(1);
  });
});

describe('atomic EVAL wiring', () => {
  const NOW = Date.parse('2026-09-22T10:00:00Z');

  it('passes the device hash and the refuse flag to the Lua script', async () => {
    const store = new AtomicStore();
    await registerStreamSession({
      userId: 'u1',
      sessionId: 's1',
      ttlSec: 300,
      now: NOW,
      store,
      deviceHash: 'dev-a',
      metadata: { platform: 'android' },
      policy: 'refuse',
    });

    const { script, args } = store.evals[0];
    expect(args).toEqual([
      userKeyFor('u1'),
      sessionKeyFor('s1'),
      2,
      NOW,
      's1',
      600,
      86_400,
      'dz:stream:sess:',
      // Note: `startedAt` is dropped when explicit metadata is present — a
      // pre-existing quirk of the metadata merge (undefined overwrites the
      // fallback), not something this change touches.
      JSON.stringify({ userId: 'u1', sessionId: 's1', platform: 'android', deviceHash: 'dev-a' }),
      'dev-a',
      '1',
    ]);
    // The script must compare device hashes itself (atomically) and must be
    // able to refuse without evicting.
    expect(script).toContain('cjson.decode');
    expect(script).toContain("return { 'refused'");
  });

  it('passes an empty device hash and evict mode when the legacy policy is selected', async () => {
    const store = new AtomicStore();
    await registerStreamSession({ userId: 'u1', sessionId: 's1', ttlSec: 300, now: NOW, store, policy: 'evict' });
    const { args } = store.evals[0];
    expect(args[9]).toBe('');
    expect(args[10]).toBe('0');
  });
});

describe('countUserStreamSessions', () => {
  it('returns the number of active sessions per user', async () => {
    const store = new MemoryStore();
    expect(await countUserStreamSessions('u1', { store })).toBe(0);
    await registerStreamSession({ userId: 'u1', sessionId: 'a', ttlSec: 300, store, maxConcurrentStreams: 5 });
    await registerStreamSession({ userId: 'u1', sessionId: 'b', ttlSec: 300, store, maxConcurrentStreams: 5 });
    await registerStreamSession({ userId: 'u2', sessionId: 'c', ttlSec: 300, store, maxConcurrentStreams: 5 });
    expect(await countUserStreamSessions('u1', { store })).toBe(2);
    expect(await countUserStreamSessions('u2', { store })).toBe(1);
    expect(await countUserStreamSessions('nobody', { store })).toBe(0);
  });

  it('returns 0 when no store is configured', async () => {
    expect(await countUserStreamSessions('u1', { store: null })).toBe(0);
  });
});

describe('getStreamLimitPolicy', () => {
  it('defaults to refuse and only accepts the literal "refuse" as strict', () => {
    delete process.env.STREAM_LIMIT_POLICY;
    expect(getStreamLimitPolicy()).toBe('refuse');
    process.env.STREAM_LIMIT_POLICY = '';
    expect(getStreamLimitPolicy()).toBe('refuse');
    process.env.STREAM_LIMIT_POLICY = 'REFUSE';
    expect(getStreamLimitPolicy()).toBe('refuse');
    process.env.STREAM_LIMIT_POLICY = ' refuse ';
    expect(getStreamLimitPolicy()).toBe('refuse');
    process.env.STREAM_LIMIT_POLICY = 'evict';
    expect(getStreamLimitPolicy()).toBe('evict');
    process.env.STREAM_LIMIT_POLICY = 'anything-else';
    expect(getStreamLimitPolicy()).toBe('evict');
  });
});

describe('resolveStreamDeviceHash', () => {
  const request = (over: Record<string, unknown> = {}) => ({
    headers: {},
    body: {},
    query: {},
    ...over,
  }) as unknown as Request;

  it('hashes the deviceId carried by the request (body, query or header)', () => {
    const expected = hashStreamDeviceValue('device-123');
    expect(resolveStreamDeviceHash(request({ body: { deviceId: 'device-123' } }))).toBe(expected);
    expect(resolveStreamDeviceHash(request({ query: { deviceId: 'device-123' } }))).toBe(expected);
    expect(resolveStreamDeviceHash(request({ headers: { 'x-device-id': 'device-123' } }))).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('prefers an explicit deviceId over the session/binding fallbacks', () => {
    const hash = resolveStreamDeviceHash(request({
      body: { deviceId: 'device-123' },
      headers: { 'x-session-id': 'session-abc' },
    }));
    expect(hash).toBe(hashStreamDeviceValue('device-123'));
  });

  it('reuses the already-hashed browser binding when present', () => {
    const binding = 'a'.repeat(64);
    expect(resolveStreamDeviceHash(request({ headers: { 'x-session-id': 'session-abc' } }), binding)).toBe(binding);
  });

  it('falls back to the authenticated session id (persisted per install)', () => {
    expect(resolveStreamDeviceHash(request({ headers: { 'x-session-id': 'session-abc' } })))
      .toBe(hashStreamDeviceValue('session-abc'));
  });

  it('returns undefined when the request carries no identity at all', () => {
    expect(resolveStreamDeviceHash(request())).toBeUndefined();
    expect(resolveStreamDeviceHash(request({ body: { deviceId: '   ' } }))).toBeUndefined();
    expect(hashStreamDeviceValue('')).toBeUndefined();
  });

  it('gives two different devices two different hashes', () => {
    const a = resolveStreamDeviceHash(request({ body: { deviceId: 'android-1' } }));
    const b = resolveStreamDeviceHash(request({ body: { deviceId: 'android-2' } }));
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
  });
});
