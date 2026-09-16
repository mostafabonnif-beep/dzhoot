/**
 * OAuth CSRF state store (Google / GitHub sign-in).
 *
 * The state used to live in a process-global `Map`, which made an in-flight
 * sign-in fail with "Invalid or missing state parameter" whenever the API
 * restarted — and the platform deploys by replacing the container, so that is
 * the common case, not the edge case. It also cannot work with more than one
 * API replica, because the replica that answers the callback is not necessarily
 * the one that issued the state.
 *
 * The state is now written to Redis (durable across restarts, shared between
 * replicas) *and* to the in-process map (so a Redis outage degrades to exactly
 * the old behaviour instead of breaking sign-in). Consumption deletes from both
 * and succeeds if either holds a non-expired entry — one-time use is preserved.
 *
 * Redis calls are best-effort and time-boxed: a slow or missing Redis must never
 * add latency to the login redirect.
 */
'use strict';

const crypto = require('crypto');

const KEY_PREFIX = 'dzhoof:oauth:state:';
/** Google/GitHub redirect round-trips are seconds; 10 minutes is generous. */
const STATE_TTL_MS = 10 * 60 * 1000;
/** Soft cap on simultaneously pending sign-ins held in this process. */
const MAX_PENDING = 1000;
/** Never let Redis add more than this to an interactive redirect. */
const REDIS_TIMEOUT_MS = 750;

function memoryStore() {
  if (!global._oauthStates) global._oauthStates = new Map();
  return global._oauthStates;
}

function purgeExpired(store) {
  const now = Date.now();
  for (const [key, value] of store) {
    if (!value || value.expiresAt < now) store.delete(key);
  }
}

function redisClient() {
  try {
    // Lazy require: the JS route module must not depend on the TS build graph.
    const { getRedisClient } = require('../services/redis');
    return getRedisClient();
  } catch {
    return null;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Issue a new one-time state value.
 * @returns {Promise<string|null>} null when the local pending cap is reached.
 */
async function issueOAuthState() {
  const store = memoryStore();
  purgeExpired(store);
  if (store.size >= MAX_PENDING) return null;

  const state = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + STATE_TTL_MS;
  store.set(state, { expiresAt });

  const redis = redisClient();
  if (redis) {
    try {
      await withTimeout(
        redis.set(`${KEY_PREFIX}${state}`, '1', 'PX', STATE_TTL_MS),
        REDIS_TIMEOUT_MS,
      );
    } catch {
      // Memory-only state still works for this process.
    }
  }
  return state;
}

/**
 * Consume a state value (one-time use).
 * @returns {Promise<{ok: boolean, expired: boolean}>}
 */
async function consumeOAuthState(state) {
  if (!state || typeof state !== 'string') return { ok: false, expired: false };

  const store = memoryStore();
  const local = store.get(state);
  store.delete(state);

  let remote = null;
  const redis = redisClient();
  if (redis) {
    try {
      remote = await withTimeout(redis.del(`${KEY_PREFIX}${state}`), REDIS_TIMEOUT_MS);
    } catch {
      remote = null;
    }
  }

  const foundLocally = Boolean(local);
  const foundRemotely = typeof remote === 'number' && remote > 0;
  if (!foundLocally && !foundRemotely) return { ok: false, expired: false };
  if (foundLocally && local.expiresAt < Date.now()) return { ok: false, expired: true };
  return { ok: true, expired: false };
}

/** Reset the in-process store (tests). */
function _resetForTests() {
  memoryStore().clear();
}

module.exports = { issueOAuthState, consumeOAuthState, STATE_TTL_MS, _resetForTests };
