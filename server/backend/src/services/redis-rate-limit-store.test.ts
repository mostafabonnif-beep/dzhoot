import { RedisRateLimitStore } from './redis-rate-limit-store';

describe('RedisRateLimitStore', () => {
  it('creates isolated prefixes for independent limiters', () => {
    const apiStore = new RedisRateLimitStore('api');
    const authStore = new RedisRateLimitStore('auth');

    expect(apiStore.prefix).toBe('dzhoof:rl:api:');
    expect(authStore.prefix).toBe('dzhoof:rl:auth:');
    expect(apiStore.prefix).not.toBe(authStore.prefix);
  });
});
