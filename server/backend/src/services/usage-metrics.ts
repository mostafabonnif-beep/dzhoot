/**
 * Usage metrics — the numbers that decide whether the box survives a free-tier
 * wave: how many streams are live (and how many of them are free), how many
 * bytes leave the server, and what the peak of the day looked like.
 *
 * Design notes:
 *  - Video responses emit thousands of chunks per minute. Writing each chunk to
 *    Redis would cost more than the feature is worth, so bytes are accumulated
 *    in process memory and flushed every few seconds.
 *  - Redis holds the recent window (minute/hour/day buckets). A scheduler task
 *    rolls the day into MongoDB (`UsageDaily`) so history survives a Redis
 *    restart and keeps 30 days.
 *  - Redis is optional in this project: with no client the counters still work
 *    in memory for the current process (the admin number is just less complete),
 *    and nothing throws.
 */

import { getRedisClient } from './redis';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Minute buckets are cheap but only the last 3 days are interesting live. */
const MINUTE_TTL_SEC = 3 * 24 * 60 * 60;
const HOUR_TTL_SEC = 8 * 24 * 60 * 60;
const DAY_TTL_SEC = 40 * 24 * 60 * 60;

const FLUSH_INTERVAL_MS = 5_000;

const EGRESS_MINUTE_PREFIX = 'dz:usage:eg:m:';
const EGRESS_HOUR_PREFIX = 'dz:usage:eg:h:';
const EGRESS_DAY_PREFIX = 'dz:usage:eg:d:';
const EGRESS_TIER_PREFIX = 'dz:usage:eg:tier:';
const EGRESS_PATH_PREFIX = 'dz:usage:eg:path:';
const PEAK_CONCURRENCY_PREFIX = 'dz:usage:peak:conc:';
const PEAK_MBPS_PREFIX = 'dz:usage:peak:mbps:';

export type UsageTier = 'free' | 'paid' | 'admin' | 'unknown';

export interface EgressContext {
  tier?: UsageTier;
  /** Where the bytes came from: proxy | remux | legacy-proxy. */
  path?: string;
}

interface PendingCounters {
  total: number;
  byTier: Record<string, number>;
  byPath: Record<string, number>;
}

const pending: PendingCounters = { total: 0, byTier: {}, byPath: {} };

let flushTimer: NodeJS.Timeout | null = null;

// An in-memory mirror so the snapshot still answers something when Redis is
// absent (dev, or a Redis blip) instead of returning zeros.
const memory = {
  byMinute: new Map<number, number>(),
  byTier: new Map<string, number>(),
  byPath: new Map<string, number>(),
  peakConcurrency: 0,
  peakMbps: 0,
};

function nowMs(): number {
  return Date.now();
}

export function minuteKey(ms: number = nowMs()): number {
  return Math.floor(ms / MINUTE_MS);
}

export function hourKey(ms: number = nowMs()): number {
  return Math.floor(ms / HOUR_MS);
}

export function dayKey(ms: number = nowMs()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Bytes → GB, rounded for display. */
export function toGb(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 1000) / 1000;
}

/** Bytes in a window → Mbps (megabits per second). */
export function toMbps(bytes: number, windowMs: number): number {
  if (windowMs <= 0) return 0;
  return Math.round(((bytes * 8) / (windowMs / 1000) / 1_000_000) * 100) / 100;
}

/**
 * Count egress bytes. Called from the streaming paths, so it must stay
 * allocation-free and synchronous: it only adds to the in-memory accumulator.
 */
export function recordEgressBytes(bytes: number, context: EgressContext = {}): void {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  const size = Math.floor(bytes);
  pending.total += size;
  const tier = context.tier || 'unknown';
  pending.byTier[tier] = (pending.byTier[tier] || 0) + size;
  const path = context.path || 'unknown';
  pending.byPath[path] = (pending.byPath[path] || 0) + size;
  const minute = minuteKey();
  memory.byMinute.set(minute, (memory.byMinute.get(minute) || 0) + size);
  memory.byTier.set(tier, (memory.byTier.get(tier) || 0) + size);
  memory.byPath.set(path, (memory.byPath.get(path) || 0) + size);
  scheduleFlush();
}

/** Flush the accumulator into Redis. Safe to call manually (tests, shutdown). */
export async function flushUsage(): Promise<void> {
  const snapshot = { ...pending, byTier: { ...pending.byTier }, byPath: { ...pending.byPath } };
  pending.total = 0;
  pending.byTier = {};
  pending.byPath = {};
  if (snapshot.total <= 0) return;

  const redis = getRedisClient();
  if (!redis) return;

  const now = nowMs();
  const minute = minuteKey(now);
  const hour = hourKey(now);
  const day = dayKey(now);
  try {
    await redis
      .multi()
      .incrby(`${EGRESS_MINUTE_PREFIX}${minute}`, snapshot.total)
      .expire(`${EGRESS_MINUTE_PREFIX}${minute}`, MINUTE_TTL_SEC)
      .incrby(`${EGRESS_HOUR_PREFIX}${hour}`, snapshot.total)
      .expire(`${EGRESS_HOUR_PREFIX}${hour}`, HOUR_TTL_SEC)
      .incrby(`${EGRESS_DAY_PREFIX}${day}`, snapshot.total)
      .expire(`${EGRESS_DAY_PREFIX}${day}`, DAY_TTL_SEC)
      .exec();
    for (const [tier, bytes] of Object.entries(snapshot.byTier)) {
      await redis
        .multi()
        .incrby(`${EGRESS_TIER_PREFIX}${day}:${tier}`, bytes)
        .expire(`${EGRESS_TIER_PREFIX}${day}:${tier}`, DAY_TTL_SEC)
        .exec();
    }
    for (const [path, bytes] of Object.entries(snapshot.byPath)) {
      await redis
        .multi()
        .incrby(`${EGRESS_PATH_PREFIX}${day}:${path}`, bytes)
        .expire(`${EGRESS_PATH_PREFIX}${day}:${path}`, DAY_TTL_SEC)
        .exec();
    }
  } catch {
    // Metrics must never break playback: drop this window and carry on.
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushUsage();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

export interface UsageConcurrency {
  total: number;
  byTier: Record<string, number>;
  bySource: Record<string, number>;
  topChannels: Array<{ name: string; count: number }>;
}

export interface UsageSnapshot {
  now: {
    concurrentTotal: number;
    concurrentFree: number;
    concurrentPaid: number;
    concurrentAdmin: number;
    concurrentUnknown: number;
    egressLast60sMb: number;
    egressMbps: number;
    egressTodayGb: number;
    activeSources: number;
  };
  peak: {
    concurrencyToday: number;
    mbpsToday: number;
  };
  byTier: Record<string, { concurrent: number; egressTodayGb: number }>;
  bySource: Array<{ sourceId: string; concurrent: number }>;
  byPath: Record<string, { egressTodayGb: number }>;
  topChannels: Array<{ name: string; concurrent: number }>;
  redisAvailable: boolean;
}

async function readEgressWindow(redis: any, ms: number): Promise<number> {
  const minute = minuteKey();
  const keys: string[] = [];
  for (let i = 0; i < Math.ceil(ms / MINUTE_MS); i += 1) {
    keys.push(`${EGRESS_MINUTE_PREFIX}${minute - i}`);
  }
  if (!keys.length) return 0;
  const values: Array<string | null> = await redis.mget(...keys);
  return values.reduce((sum: number, value: string | null) => sum + (Number(value) || 0), 0);
}

/**
 * Assemble the live snapshot. `concurrency` is supplied by the caller (the
 * route knows how to read stream sessions and resolve each user's tier), which
 * keeps this module free of model imports and easy to unit test.
 */
export async function getUsageSnapshot(
  concurrency: UsageConcurrency,
): Promise<UsageSnapshot> {
  const redis = getRedisClient();
  const day = dayKey();

  let egressLast60s = 0;
  let egressToday = 0;
  const tierEgress: Record<string, number> = {};
  const pathEgress: Record<string, number> = {};
  let peakConcurrency = 0;
  let peakMbps = 0;

  if (redis) {
    try {
      egressLast60s = await readEgressWindow(redis, MINUTE_MS);
      egressToday = Number(await redis.get(`${EGRESS_DAY_PREFIX}${day}`)) || 0;
      const tierKeys = ['free', 'paid', 'admin', 'unknown'].map(
        (tier) => `${EGRESS_TIER_PREFIX}${day}:${tier}`,
      );
      const tierValues: Array<string | null> = await redis.mget(...tierKeys);
      tierKeys.forEach((key, index) => {
        const tier = key.split(':').pop() as string;
        tierEgress[tier] = Number(tierValues[index]) || 0;
      });
      const pathKeys = ['proxy', 'remux', 'legacy-proxy', 'unknown'].map(
        (path) => `${EGRESS_PATH_PREFIX}${day}:${path}`,
      );
      const pathValues: Array<string | null> = await redis.mget(...pathKeys);
      pathKeys.forEach((key, index) => {
        const path = key.split(':').pop() as string;
        pathEgress[path] = Number(pathValues[index]) || 0;
      });
      peakConcurrency = Number(await redis.get(`${PEAK_CONCURRENCY_PREFIX}${day}`)) || 0;
      peakMbps = Number(await redis.get(`${PEAK_MBPS_PREFIX}${day}`)) || 0;
    } catch {
      // fall through with whatever is in memory
    }
  }

  if (!egressToday) {
    egressToday = [...memory.byMinute.values()].reduce((a, b) => a + b, 0);
  }
  for (const [tier, bytes] of memory.byTier) {
    if (!tierEgress[tier]) tierEgress[tier] = bytes;
  }
  for (const [path, bytes] of memory.byPath) {
    if (!pathEgress[path]) pathEgress[path] = bytes;
  }

  const concurrentFree = concurrency.byTier.free || 0;
  const concurrentPaid = concurrency.byTier.paid || 0;
  const concurrentAdmin = concurrency.byTier.admin || 0;
  const concurrentUnknown = concurrency.byTier.unknown || 0;
  const mbps = toMbps(egressLast60s, MINUTE_MS);

  // Keep the day's peak current for the panel (the rollup task also persists it).
  if (concurrency.total > memory.peakConcurrency) memory.peakConcurrency = concurrency.total;
  if (mbps > memory.peakMbps) memory.peakMbps = mbps;
  const peak = {
    concurrencyToday: Math.max(peakConcurrency, memory.peakConcurrency),
    mbpsToday: Math.max(peakMbps, memory.peakMbps),
  };

  const byTier: Record<string, { concurrent: number; egressTodayGb: number }> = {};
  for (const tier of ['free', 'paid', 'admin', 'unknown']) {
    byTier[tier] = {
      concurrent: concurrency.byTier[tier] || 0,
      egressTodayGb: toGb(tierEgress[tier] || 0),
    };
  }

  return {
    now: {
      concurrentTotal: concurrency.total,
      concurrentFree,
      concurrentPaid,
      concurrentAdmin,
      concurrentUnknown,
      egressLast60sMb: Math.round((egressLast60s / 1024 ** 2) * 10) / 10,
      egressMbps: mbps,
      egressTodayGb: toGb(egressToday),
      activeSources: Object.keys(concurrency.bySource).length,
    },
    peak,
    byTier,
    bySource: Object.entries(concurrency.bySource)
      .map(([sourceId, count]) => ({ sourceId, concurrent: count }))
      .sort((a, b) => b.concurrent - a.concurrent),
    byPath: Object.fromEntries(
      Object.entries(pathEgress).map(([path, bytes]) => [path, { egressTodayGb: toGb(bytes) }]),
    ),
    topChannels: concurrency.topChannels
      .slice(0, 10)
      .map((channel) => ({ name: channel.name, concurrent: channel.count })),
    redisAvailable: Boolean(redis),
  };
}

/** Persist today's peaks (called by the scheduler task every few minutes). */
export async function persistPeaks(concurrentTotal: number, mbps: number): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const day = dayKey();
  try {
    const concurrencyKey = `${PEAK_CONCURRENCY_PREFIX}${day}`;
    const mbpsKey = `${PEAK_MBPS_PREFIX}${day}`;
    const [storedConcurrency, storedMbps] = await Promise.all([
      redis.get(concurrencyKey),
      redis.get(mbpsKey),
    ]);
    const ops: any[] = [];
    if (concurrentTotal > (Number(storedConcurrency) || 0)) {
      ops.push(redis.set(concurrencyKey, String(concurrentTotal), 'EX', DAY_TTL_SEC));
    }
    // Micro-batches keep the Max as an integer of centi-Mbps for atomic MAX-free updates.
    if (mbps > (Number(storedMbps) || 0)) {
      ops.push(redis.set(mbpsKey, String(mbps), 'EX', DAY_TTL_SEC));
    }
    if (ops.length) await Promise.all(ops);
  } catch {
    /* metrics only */
  }
}

/** Hourly buckets for the last N hours (oldest → newest), in GB. */
export async function getHourlyEgressGb(hours = 24): Promise<Array<{ ts: string; egressGb: number }>> {
  const redis = getRedisClient();
  const out: Array<{ ts: string; egressGb: number }> = [];
  const currentHour = hourKey();
  const keys: string[] = [];
  for (let i = hours - 1; i >= 0; i -= 1) keys.push(`${EGRESS_HOUR_PREFIX}${currentHour - i}`);

  let values: Array<string | null> = [];
  if (redis) {
    try {
      values = await redis.mget(...keys);
    } catch {
      values = [];
    }
  }
  for (let i = 0; i < hours; i += 1) {
    const bucket = currentHour - (hours - 1 - i);
    const bytes = Number(values[i]) || 0;
    out.push({ ts: new Date(bucket * HOUR_MS).toISOString(), egressGb: toGb(bytes) });
  }
  return out;
}

/** Test seam: reset in-memory state between cases. */
export function resetUsageState(): void {
  pending.total = 0;
  pending.byTier = {};
  pending.byPath = {};
  memory.byMinute.clear();
  memory.byTier.clear();
  memory.byPath.clear();
  memory.peakConcurrency = 0;
  memory.peakMbps = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/**
 * A pass-through Transform that counts egress bytes on their way to the client.
 * Inserted between the upstream response and `res` in the streaming paths; it
 * never buffers or delays chunks (backpressure is preserved by the pipe), and it
 * reads the tier lazily so a stream that starts before the tier is resolved
 * still switches to the right bucket on the next flush instead of mislabeling
 * the whole session.
 */
export function createEgressMeter(getTier: () => UsageTier, path = 'proxy') {
  const { Transform } = require('stream') as typeof import('stream');
  return new Transform({
    transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: Buffer) => void) {
      try {
        recordEgressBytes(chunk?.length || 0, { tier: getTier(), path });
      } catch {
        // Counting is best-effort; never break the stream for a metric.
      }
      callback(null, chunk);
    },
  });
}

module.exports = {
  createEgressMeter,
  recordEgressBytes,
  flushUsage,
  getUsageSnapshot,
  persistPeaks,
  getHourlyEgressGb,
  resetUsageState,
  minuteKey,
  hourKey,
  dayKey,
  toGb,
  toMbps,
};
