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
  get?(key: string): Promise<string | null>;
  scan?(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>;
}

/**
 * Optional metadata describing what a session is watching, so the "who's
 * watching now" admin dashboard can render something meaningful. Stored as
 * the session key's JSON value (replacing the old bare '1' marker) — every
 * reader only ever checked `exists()`, so this stays backward compatible.
 */
export interface StreamSessionMetadata {
  username?: string;
  channelListCode?: string;
  contentType?: 'live' | 'movie' | 'episode';
  contentName?: string;
  contentGroup?: string;
  platform?: string;
  startedAt?: number;
}

export interface ActiveStreamSession extends StreamSessionMetadata {
  userId: string;
  sessionId: string;
}

function defaultStore(): StreamSessionStore | null { return getRedisClient() as unknown as StreamSessionStore | null; }

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

/** Bound the serialized metadata so a hostile client can't bloat Redis. */
function sanitizeMetadata(metadata?: StreamSessionMetadata): StreamSessionMetadata | undefined {
  if (!metadata) return undefined;
  const clip = (v: unknown, max: number): string | undefined => {
    if (typeof v !== 'string' || !v) return undefined;
    return v.slice(0, max);
  };
  const out: StreamSessionMetadata = {
    username: clip(metadata.username, 60),
    channelListCode: clip(metadata.channelListCode, 12),
    contentType: metadata.contentType,
    contentName: clip(metadata.contentName, 120),
    contentGroup: clip(metadata.contentGroup, 80),
    platform: clip(metadata.platform, 40),
    startedAt: Number.isFinite(metadata.startedAt) ? metadata.startedAt : undefined,
  };
  return out;
}

/** Serialize the session marker: JSON metadata when available, else the legacy '1'. */
function sessionValueFor(userId: string, sessionId: string, now: number, metadata?: StreamSessionMetadata): string {
  const clean = sanitizeMetadata(metadata);
  if (!clean) return '1';
  try {
    return JSON.stringify({ userId, sessionId, startedAt: now, ...clean });
  } catch {
    return '1';
  }
}

export async function registerStreamSession(opts: {
  userId: string;
  sessionId: string;
  ttlSec: number;
  maxConcurrentStreams?: number;
  now?: number;
  store?: StreamSessionStore | null;
  metadata?: StreamSessionMetadata;
}): Promise<StreamSessionResult> {
  const { userId, sessionId, ttlSec, now = Date.now() } = opts;
  const store = opts.store !== undefined ? opts.store : defaultStore();
  const max = Number.isFinite(opts.maxConcurrentStreams) && Number(opts.maxConcurrentStreams) > 0
    ? Math.floor(Number(opts.maxConcurrentStreams))
    : envMax();
  const sessionValue = sessionValueFor(userId, sessionId, now, opts.metadata);

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
    const result = await store.eval(
      `local count = redis.call('ZCARD', KEYS[1])
       local evicted = ''
       if count >= tonumber(ARGV[1]) then
         evicted = redis.call('ZRANGE', KEYS[1], 0, 0)[1]
         if evicted then
           redis.call('ZREM', KEYS[1], evicted)
           redis.call('DEL', ARGV[6] .. evicted)
         end
       end
       redis.call('ZADD', KEYS[1], tonumber(ARGV[2]), ARGV[3])
       redis.call('SET', KEYS[2], ARGV[7], 'EX', tonumber(ARGV[4]))
       redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
       return evicted`,
      2,
      userKey,
      sessionKey,
      max,
      now,
      sessionId,
      effectiveTtl,
      USER_SET_TTL_SEC,
      'dz:stream:sess:',
      sessionValue,
    );
    const evictedSessionId = typeof result === 'string' && result ? result : null;
    return {
      allowed: true,
      max,
      active: await store.zcard(userKey),
      evictedSessionId,
    };
  }

  let evictedSessionId: string | null = null;
  const activeBefore = await store.zcard(userKey);
  if (activeBefore >= max) {
    const [oldest] = await store.zrange(userKey, 0, 0);
    if (oldest) {
      evictedSessionId = oldest;
      await store.del(sessionKeyFor(oldest));
      await store.zrem(userKey, oldest);
    }
  }
  await store.zadd(userKey, now, sessionId);
  await store.set(sessionKey, sessionValue, 'EX', effectiveTtl);
  await store.expire(userKey, USER_SET_TTL_SEC);

  return {
    allowed: true,
    max,
    active: await store.zcard(userKey),
    evictedSessionId,
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

const SESSION_KEY_PREFIX = 'dz:stream:sess:';

/**
 * "Who's watching now" — scans every live playback session key and returns
 * its metadata (best-effort; legacy/no-metadata sessions are still counted
 * but reported without content details). Powers the admin Live Viewers page.
 * Bounded by MAX_SCAN_KEYS so a huge key space can never turn this into a
 * multi-second blocking admin request.
 */
const MAX_SCAN_KEYS = 2000;

export async function listActiveStreamSessions(
  store?: StreamSessionStore | null,
): Promise<ActiveStreamSession[]> {
  const redis = store !== undefined ? store : defaultStore();
  if (!redis || typeof redis.scan !== 'function' || typeof redis.get !== 'function') return [];

  const sessions: ActiveStreamSession[] = [];
  let cursor = '0';
  let scanned = 0;
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${SESSION_KEY_PREFIX}*`,
      'COUNT',
      100,
    );
    cursor = nextCursor;
    for (const key of keys) {
      scanned += 1;
      const sessionId = key.slice(SESSION_KEY_PREFIX.length);
      const raw = await redis.get(key);
      if (!raw) continue;
      if (raw === '1') {
        // Legacy marker with no metadata — still a real active session.
        sessions.push({ userId: '', sessionId });
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as ActiveStreamSession;
        sessions.push({ ...parsed, sessionId: parsed.sessionId || sessionId });
      } catch {
        sessions.push({ userId: '', sessionId });
      }
    }
    if (scanned >= MAX_SCAN_KEYS) break;
  } while (cursor !== '0');

  return sessions;
}
