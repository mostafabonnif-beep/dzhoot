/**
 * Redis-backed concurrent playback session tracking.
 *
 * Sessions are authorization state, not media transport. The media bytes can
 * therefore bypass the DZ HOOF VPS when DIRECT delivery is enabled.
 */
import { getRedisClient } from './redis';

const DEFAULT_MAX_CONCURRENT = 2;
const SESSION_GRACE_SEC = 5 * 60;
const MIN_TTL_SEC = 60;
const USER_SET_TTL_SEC = 86_400;

function envMax(): number {
  const raw = Number(process.env.MAX_CONCURRENT_STREAMS_PER_USER);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_CONCURRENT;
}

export function getMaxConcurrentStreams(): number {
  return envMax();
}
export function sessionKeyFor(sessionId: string): string { return `dz:stream:sess:${sessionId}`; }
export function userKeyFor(userId: string): string { return `dz:stream:user:${userId}`; }

export interface StreamSessionStore {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  eval?(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  zcard(key: string): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, member: string): Promise<number>;
  set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
  exists(key: string): Promise<number>;
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

function defaultStore(): StreamSessionStore | null { return getRedisClient(); }

function redisRequired(): boolean {
  return process.env.REQUIRE_REDIS_FOR_CONCURRENT_LIMITS === 'true' ||
    process.env.NODE_ENV === 'production';
}

export interface StreamSessionResult {
  allowed: boolean;
  max: number;
  active: number;
  evictedSessionId: string | null;
  reason?: 'LIMIT_REACHED' | 'REDIS_UNAVAILABLE';
}

export async function registerStreamSession(opts: {
  userId: string;
  sessionId: string;
  ttlSec: number;
  maxConcurrentStreams?: number;
  now?: number;
  store?: StreamSessionStore | null;
}): Promise<StreamSessionResult> {
  const { userId, sessionId, ttlSec, now = Date.now() } = opts;
  const store = opts.store !== undefined ? opts.store : defaultStore();
  const max = Number.isFinite(opts.maxConcurrentStreams) && Number(opts.maxConcurrentStreams) > 0
    ? Math.floor(Number(opts.maxConcurrentStreams))
    : envMax();

  // Redis is required for strict distributed concurrency enforcement.
  if (!store) {
    return {
      allowed: !redisRequired(),
      max,
      active: 0,
      evictedSessionId: null,
      reason: 'REDIS_UNAVAILABLE',
    };
  }

  const userKey = userKeyFor(userId);
  const sessionKey = sessionKeyFor(sessionId);
  const effectiveTtl = Math.max(MIN_TTL_SEC, Math.ceil(ttlSec) + SESSION_GRACE_SEC);

  // Remove expired/crashed sessions before deciding.
  const members = await store.zrange(userKey, 0, -1);
  for (const member of members) {
    if (!(await store.exists(sessionKeyFor(member)))) await store.zrem(userKey, member);
  }

  // The final limit check + registration must be atomic. Without this, two
  // simultaneous requests can both observe one free slot and create two
  // sessions, exceeding the plan limit.
  if (typeof store.eval === 'function') {
    const result = Number(await store.eval(
      `local count = redis.call('ZCARD', KEYS[1])
       if count >= tonumber(ARGV[1]) then
         redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
         return 0
       end
       redis.call('ZADD', KEYS[1], tonumber(ARGV[2]), ARGV[3])
       redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[4]))
       redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
       return 1`,
      2,
      userKey,
      sessionKey,
      max,
      now,
      sessionId,
      effectiveTtl,
      USER_SET_TTL_SEC,
    ));
    if (result !== 1) {
      return {
        allowed: false,
        max,
        active: await store.zcard(userKey),
        evictedSessionId: null,
        reason: 'LIMIT_REACHED',
      };
    }
  } else {
    const activeBefore = await store.zcard(userKey);
    if (activeBefore >= max) {
      await store.expire(userKey, USER_SET_TTL_SEC);
      return { allowed: false, max, active: activeBefore, evictedSessionId: null, reason: 'LIMIT_REACHED' };
    }
    await store.zadd(userKey, now, sessionId);
    await store.set(sessionKey, '1', 'EX', effectiveTtl);
    await store.expire(userKey, USER_SET_TTL_SEC);
  }

  return {
    allowed: true,
    max,
    active: await store.zcard(userKey),
    evictedSessionId: null,
  };
}

export async function isStreamSessionActive(
  userId: string,
  sessionId: string,
  store?: StreamSessionStore | null,
): Promise<boolean> {
  const redis = store !== undefined ? store : defaultStore();
  if (!redis) return !redisRequired();
  const member = sessionKeyFor(sessionId);
  const exists = await redis.exists(member);
  if (!exists) return false;
  const userMembers = await redis.zrange(userKeyFor(userId), 0, -1);
  return userMembers.includes(sessionId);
}

export async function revokeStreamSession(
  userId: string,
  sessionId: string,
  store?: StreamSessionStore | null,
): Promise<boolean> {
  const redis = store !== undefined ? store : defaultStore();
  if (!redis) return false;
  const removed = await redis.del(sessionKeyFor(sessionId));
  await redis.zrem(userKeyFor(userId), sessionId);
  return removed > 0;
}
