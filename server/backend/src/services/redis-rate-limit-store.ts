import type { Store, Options } from 'express-rate-limit';
import { getRedisClient } from './redis';

/**
 * Distributed express-rate-limit store backed by Redis.
 * Production preflight requires REDIS_URL, so API replicas share counters.
 */
export class RedisRateLimitStore implements Store {
  private windowMs = 60_000;

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const redis = getRedisClient();
    if (!redis) throw new Error('Redis rate-limit store is not configured');

    const redisKey = `dzhoof:rl:${key}`;
    const results = await redis.multi().incr(redisKey).pttl(redisKey).exec();
    const hits = Number((results?.[0]?.[1] as number | string) ?? 0);
    let ttl = Number((results?.[1]?.[1] as number | string) ?? -1);
    if (ttl < 0) {
      await redis.pexpire(redisKey, this.windowMs);
      ttl = this.windowMs;
    }
    return { totalHits: hits, resetTime: new Date(Date.now() + ttl) };
  }

  async decrement(key: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    const redisKey = `dzhoof:rl:${key}`;
    await redis.decr(redisKey);
  }

  async resetKey(key: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.del(`dzhoof:rl:${key}`);
  }

  async shutdown(): Promise<void> {
    // The application owns the shared Redis connection; do not close it here.
  }
}

module.exports = { RedisRateLimitStore };
