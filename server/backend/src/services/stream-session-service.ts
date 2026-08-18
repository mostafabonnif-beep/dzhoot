/**
 * Per-user concurrent stream session tracking (Redis-backed).
 *
 * Enforces MAX_CONCURRENT_STREAMS_PER_USER: when a user starts a new stream
 * beyond the limit, the OLDEST active session is evicted (standard IPTV
 * behavior — the newest playback wins). Sessions carry the playback token's
 * TTL + a grace period, so a crashed app or closed player frees the slot
 * automatically.
 *
 * Fully degraded: without REDIS_URL the service is a no-op (returns the
 * configured max with active=0), so a Redis outage never blocks playback.
 */
import { getRedisClient } from './redis';

const MAX_CONCURRENT_STREAMS = (() => {
  const raw = Number(process.env.MAX_CONCURRENT_STREAMS_PER_USER);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
})();

/** Extra time (s) a session stays registered after its token expires. */
const SESSION_GRACE_SEC = 5 * 60;

/** Minimum session TTL (s) — a token issued with a tiny TTL still registers. */
const MIN_TTL_SEC = 60;

/** Sorted-set members evicted per registration when over the limit. */
const USER_SET_TTL_SEC = 86_400;

export function getMaxConcurrentStreams(): number {
  return MAX_CONCURRENT_STREAMS;
}

export function sessionKeyFor(sessionId: string): string {
  return `dz:stream:sess:${sessionId}`;
}

export function userKeyFor(userId: string): string {
  return `dz:stream:user:${userId}`;
}

/** The ioredis surface the service needs — small so tests can fake it. */
export interface StreamSessionStore {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zcard(key: string): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, member: string): Promise<number>;
  set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
  exists(key: string): Promise<number>;
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

function defaultStore(): StreamSessionStore | null {
  return getRedisClient();
}

export interface StreamSessionResult {
  max: number;
  active: number;
  evictedSessionId: string | null;
}

export async function registerStreamSession(opts: {
  userId: string;
  sessionId: string;
  /** Seconds until the playback token expires (grace is added internally). */
  ttlSec: number;
  maxStreams?: number;
  now?: number;
  store?: StreamSessionStore | null;
}): Promise<StreamSessionResult> {
  const { userId, sessionId, ttlSec, now = Date.now() } = opts;
  const store = opts.store !== undefined ? opts.store : defaultStore();
  const configuredMax = Number(opts.maxStreams);
  const max = Number.isFinite(configuredMax) && configuredMax > 0 ? Math.floor(configuredMax) : MAX_CONCURRENT_STREAMS;
  if (!store) return { max, active: 0, evictedSessionId: null };

  const userKey = userKeyFor(userId);
  const sessionKey = sessionKeyFor(sessionId);
  const effectiveTtl = Math.max(MIN_TTL_SEC, Math.ceil(ttlSec) + SESSION_GRACE_SEC);

  await store.zadd(userKey, now, sessionId);
  await store.set(sessionKey, '1', 'EX', effectiveTtl);

  // Prune members whose session key already expired (crashed/closed streams).
  const members = await store.zrange(userKey, 0, -1);
  for (const member of members) {
    const alive = await store.exists(sessionKeyFor(member));
    if (!alive) await store.zrem(userKey, member);
  }

  let active = await store.zcard(userKey);
  let evictedSessionId: string | null = null;
  if (active > max) {
    // Evict the oldest (lowest score = earliest issue) down to the limit.
    const victims = await store.zrange(userKey, 0, active - max - 1);
    for (const victim of victims) {
      await store.del(sessionKeyFor(victim));
      await store.zrem(userKey, victim);
    }
    evictedSessionId = victims[victims.length - 1] ?? null;
    active = await store.zcard(userKey);
  }

  await store.expire(userKey, USER_SET_TTL_SEC);
  return { max, active, evictedSessionId };
}
