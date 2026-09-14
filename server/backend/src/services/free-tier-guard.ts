/**
 * Free-tier guards — a ceiling on what the ad-supported tier can consume.
 *
 * The operator's own words for the plan were "many people, many countries on the
 * free code". That is great for growth and dangerous for a 2-vCPU box: every free
 * viewer pulls video bytes through the server. These guards cap the damage:
 *
 *   1. concurrent free streams (global) — the box can only serve so many;
 *   2. a daily egress budget for the free tier — the bandwidth bill stops here.
 *
 * Guardrails that make this safe to ship:
 *  - `enforce: false` (default) is SHADOW mode: it counts what WOULD be blocked
 *    and never refuses anyone, so the operator can watch the numbers first.
 *  - Both limits are `0 = unlimited`.
 *  - No Redis (or a Redis hiccup) → fail OPEN. A metrics outage must never take
 *    paid or free playback down.
 *  - Only the ADMISSION points use this (playback-token / streams authorize).
 *    A viewer already watching is never cut off mid-stream.
 */

import { getRedisClient } from './redis';
import { getTierEgressTodayBytes } from './usage-metrics';

const SETTINGS_TTL_MS = 30 * 1000;
const ACTIVE_KEY = 'dz:free:active'; // sorted set: member=session, score=expiry ms
const BLOCKED_PREFIX = 'dz:free:blocked:'; // per-day counter per reason
const COUNTER_TTL_SEC = 3 * 24 * 60 * 60;

let cached: { at: number; value: FreeTierGuardConfig } | null = null;

export interface FreeTierGuardConfig {
  /** false = shadow mode: count and report, never refuse. */
  enforce: boolean;
  /** Global concurrent free streams allowed. 0 = unlimited. */
  maxConcurrentStreams: number;
  /** Free-tier egress budget per day, in GB. 0 = unlimited. */
  dailyEgressGb: number;
}

export const FREE_TIER_GUARD_DEFAULTS: FreeTierGuardConfig = {
  enforce: false,
  maxConcurrentStreams: 0,
  dailyEgressGb: 0,
};

export interface FreeTierAdmission {
  allowed: boolean;
  /** SHADOW_BLOCK | CAPACITY_REACHED | BUDGET_EXHAUSTED | NO_REDIS */
  reason: string;
  activeStreams: number;
  egressTodayGb: number;
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.floor(n), min), max);
}

export function normalizeGuard(raw: unknown): FreeTierGuardConfig {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    enforce: value.enforce === true,
    maxConcurrentStreams: clampInt(value.maxConcurrentStreams, 0, 100000),
    dailyEgressGb: clampInt(value.dailyEgressGb, 0, 1000000),
  };
}

/** Guard settings live inside the existing `free_access` operator setting. */
export async function getFreeTierGuardConfig({ fresh = false } = {}): Promise<FreeTierGuardConfig> {
  if (!fresh && cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.value;
  let value = { ...FREE_TIER_GUARD_DEFAULTS };
  try {
    const AppSetting = require('../models/AppSetting');
    const doc = await AppSetting.findOne({ key: 'free_access' }).lean();
    const raw = doc?.value as { guard?: unknown } | undefined;
    if (raw?.guard !== undefined) value = normalizeGuard(raw.guard);
  } catch {
    // Fail open with defaults — never refuse playback because settings failed.
  }
  cached = { at: Date.now(), value };
  return value;
}

export function clearFreeTierGuardCache(): void {
  cached = null;
}

/** Minimal Redis surface this module needs (also satisfied by a test double). */
export interface FreeTierGuardStore {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zcard(key: string): Promise<number>;
  zremrangebyscore(key: string, min: string | number, max: string | number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  incr(key: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  del(key: string): Promise<unknown>;
  multi(): { incr(key: string): any; expire(key: string, seconds: number): any; zadd(key: string, score: number, member: string): any; exec(): Promise<unknown> };
}

function resolveStore(store?: FreeTierGuardStore | null): FreeTierGuardStore | null {
  if (store !== undefined) return store;
  if (!process.env.REDIS_URL) return null;
  return getRedisClient() as unknown as FreeTierGuardStore | null;
}

/** Remove expired sessions (score = expiry timestamp) and count the live ones. */
async function countActiveFreeStreams(redis: FreeTierGuardStore): Promise<number> {
  const now = Date.now();
  await redis.zremrangebyscore(ACTIVE_KEY, '-inf', now);
  return Number(await redis.zcard(ACTIVE_KEY)) || 0;
}

/** Counters behind the dashboard: how often the guard would/did refuse. */
async function bumpBlocked(redis: FreeTierGuardStore, reason: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${BLOCKED_PREFIX}${day}:${reason}`;
  await redis.multi().incr(key).expire(key, COUNTER_TTL_SEC).exec();
}

/** Blocked counters for today (dashboard). */
export async function getFreeTierBlockedCounts(
  store?: FreeTierGuardStore | null,
): Promise<Record<string, number>> {
  const redis = resolveStore(store);
  if (!redis) return {};
  const day = new Date().toISOString().slice(0, 10);
  const reasons = ['SHADOW_BLOCK', 'CAPACITY_REACHED', 'BUDGET_EXHAUSTED'];
  try {
    const values: Array<string | null> = await redis.mget(
      ...reasons.map((reason) => `${BLOCKED_PREFIX}${day}:${reason}`),
    );
    const out: Record<string, number> = {};
    reasons.forEach((reason, index) => {
      out[reason] = Number(values[index]) || 0;
    });
    return out;
  } catch {
    return {};
  }
}

/**
 * Admission check for the free tier. When allowed it records the viewer so the
 * concurrent count reflects reality; the entry expires on its own.
 *
 * `viewerKey` identifies the VIEWER (code or user id), not the request: the same
 * person calling two admission endpoints for one playback is still one viewer,
 * and per-user stream limits are enforced separately by the stream-session
 * service. That keeps the cap honest without double counting.
 */
export async function checkFreeTierAdmission(
  viewerKeyOrTtl?: string | number,
  ttlSecArg = 300,
  store?: FreeTierGuardStore | null,
): Promise<FreeTierAdmission> {
  const viewerKey = typeof viewerKeyOrTtl === 'string' ? viewerKeyOrTtl : '';
  const ttlSec = typeof viewerKeyOrTtl === 'number' ? viewerKeyOrTtl : ttlSecArg;
  const config = await getFreeTierGuardConfig();
  const redis = resolveStore(store);
  if (!redis) {
    return { allowed: true, reason: 'NO_REDIS', activeStreams: 0, egressTodayGb: 0 };
  }

  let activeStreams = 0;
  let egressTodayGb = 0;
  try {
    activeStreams = await countActiveFreeStreams(redis);
    const bytes = await getTierEgressTodayBytes('free');
    egressTodayGb = Math.round((bytes / 1024 ** 3) * 100) / 100;
  } catch {
    // Redis hiccup: fail open rather than block paying viewers by accident.
    return { allowed: true, reason: 'NO_REDIS', activeStreams: 0, egressTodayGb: 0 };
  }

  const overCapacity =
    config.maxConcurrentStreams > 0 && activeStreams >= config.maxConcurrentStreams;
  const overBudget = config.dailyEgressGb > 0 && egressTodayGb >= config.dailyEgressGb;

  if (overCapacity || overBudget) {
    const reason = overCapacity ? 'CAPACITY_REACHED' : 'BUDGET_EXHAUSTED';
    try {
      await bumpBlocked(redis, config.enforce ? reason : 'SHADOW_BLOCK');
    } catch {
      /* counters are best effort */
    }
    if (!config.enforce) {
      // Shadow mode: report what would happen, but let the viewer in.
      await registerFreeTierStream(viewerKey, ttlSec, redis);
      return { allowed: true, reason: 'SHADOW_BLOCK', activeStreams, egressTodayGb };
    }
    return { allowed: false, reason, activeStreams, egressTodayGb };
  }

  await registerFreeTierStream(viewerKey, ttlSec, redis);
  return { allowed: true, reason: 'OK', activeStreams, egressTodayGb };
}

/** Remember an admitted free viewer so the concurrent count stays honest. */
export async function registerFreeTierStream(
  viewerKey: string,
  ttlSec = 300,
  store?: FreeTierGuardStore | null,
): Promise<void> {
  const redis = resolveStore(store);
  if (!redis || !viewerKey) return;
  const ttl = Math.min(Math.max(Math.floor(ttlSec), 30), 24 * 60 * 60);
  try {
    await redis
      .multi()
      .zadd(ACTIVE_KEY, Date.now() + ttl * 1000, viewerKey)
      .expire(ACTIVE_KEY, 24 * 60 * 60)
      .exec();
  } catch {
    /* best effort */
  }
}

/** Test seam. */
export async function resetFreeTierGuardState(store?: FreeTierGuardStore | null): Promise<void> {
  clearFreeTierGuardCache();
  const redis = resolveStore(store);
  if (!redis) return;
  try {
    await redis.del(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

module.exports = {
  FREE_TIER_GUARD_DEFAULTS,
  normalizeGuard,
  getFreeTierGuardConfig,
  clearFreeTierGuardCache,
  checkFreeTierAdmission,
  registerFreeTierStream,
  getFreeTierBlockedCounts,
  resetFreeTierGuardState,
};
