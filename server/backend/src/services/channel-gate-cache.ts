/**
 * In-process memo for the channel "visibility gate".
 *
 * The customer-facing catalog endpoints (`/channels`, `/channels/grouped`,
 * `/categories`, `/tv/*`, the M3U/JSON playlists) all ask the same two
 * questions before touching a channel:
 *
 *   1. which Xtream sources are customer-visible? (3 `distinct('_id')` reads)
 *   2. which channel copies must be hidden as duplicates? (a full scan of the
 *      shared catalog to derive a normalized key per channel)
 *
 * Neither answer depends on the caller, yet both were recomputed on EVERY
 * request — a ~32.7k-document read per hit once the Redis copy of the dedup
 * list is cold (Redis down/restart, or a TTL that just expired). At 1000
 * customers that is the difference between an O(N)-per-request endpoint and an
 * O(1) one.
 *
 * This module memoizes those shared answers in a module-level Map with a short
 * TTL (`CHANNEL_GATE_CACHE_TTL_MS`, default 60s; `0` disables the cache
 * entirely for diagnostics).
 *
 * Safety rule — nothing user-scoped is stored here. `groupScopeClause(user)`
 * (the freemium boundary) is NEVER memoized: it depends on the caller's role,
 * `accessGroups` and the operator's `free_access` setting, and a leak between
 * scopes would expose paid content to a free code. It keeps its own settings
 * cache in `services/channel-scope.js`.
 *
 * Thundering herd: the promise is stored BEFORE it is awaited, so every
 * concurrent caller during a cold start (or right after an invalidation) shares
 * one computation instead of stampeding Mongo.
 *
 * Invalidation: catalog/source mutations call `clearChannelGateCache()`
 * (see routes/channels.js, routes/admin.js, routes/channel-test.js,
 * routes/admin-xtream-sources.js, services/xtream-service.ts,
 * services/m3u-service.ts, services/stream-health-service.ts,
 * services/source-failover-service.ts).
 */

const DEFAULT_TTL_MS = 60_000;
/** Only computations this slow are worth a log line (a hot path must stay quiet). */
const SLOW_COMPUTE_LOG_MS = 500;
/** Fixed keys + a handful of env-keyed variants; pruned when it grows past this. */
const MAX_ENTRIES = 64;

export interface ChannelGateCounts {
  /** Channel documents read by the computation (0 when it reads none). */
  channels: number;
  /** Source/identity ids resolved by the computation. */
  identities: number;
}

interface ChannelGateEntry {
  promise: Promise<unknown>;
  expiresAt: number;
}

interface ChannelGateSyncEntry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, ChannelGateEntry>();
const syncStore = new Map<string, ChannelGateSyncEntry>();

/**
 * Effective memo TTL. `CHANNEL_GATE_CACHE_TTL_MS=0` disables caching; an
 * unset/blank/negative/non-numeric value keeps the 60s default.
 */
export function channelGateCacheTtlMs(): number {
  const raw = process.env.CHANNEL_GATE_CACHE_TTL_MS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TTL_MS;
  return parsed;
}

/** Drop every memoized gate result (catalog/source mutations, tests). */
export function clearChannelGateCache(): void {
  store.clear();
  syncStore.clear();
}

/** Number of live memo entries — diagnostics/tests only. */
export function channelGateCacheSize(): number {
  return store.size + syncStore.size;
}

function pruneStore(now: number): void {
  if (store.size > MAX_ENTRIES) {
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
    while (store.size > MAX_ENTRIES) {
      const oldestKey = store.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
  }
  if (syncStore.size > MAX_ENTRIES) {
    for (const [key, entry] of syncStore) {
      if (entry.expiresAt <= now) syncStore.delete(key);
    }
    while (syncStore.size > MAX_ENTRIES) {
      const oldestKey = syncStore.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      syncStore.delete(oldestKey);
    }
  }
}

function logSlowCompute(elapsedMs: number, counts?: ChannelGateCounts): void {
  if (elapsedMs < SLOW_COMPUTE_LOG_MS) return;
  const channels = counts?.channels ?? 0;
  const identities = counts?.identities ?? 0;
  console.log(`[channel-gate] computed in ${elapsedMs}ms (channels=${channels}, identities=${identities})`);
}

async function computeMeasured<T>(
  key: string,
  compute: () => Promise<T>,
  describe?: (value: T) => ChannelGateCounts | undefined,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const value = await compute();
    logSlowCompute(Date.now() - startedAt, describe ? describe(value) : undefined);
    return value;
  } catch (error) {
    // A failed computation must never be served for the whole TTL.
    store.delete(key);
    throw error;
  }
}

/**
 * Memoize one shared (user-independent) computation.
 *
 * @param key      stable cache key ('verifiedSourceIds', 'dedupQuery', ...)
 * @param compute  the expensive computation
 * @param describe optional counts for the slow-computation log line
 */
export function memoChannelGate<T>(
  key: string,
  compute: () => Promise<T>,
  describe?: (value: T) => ChannelGateCounts | undefined,
): Promise<T> {
  const ttl = channelGateCacheTtlMs();
  if (ttl <= 0) return computeMeasured(key, compute, describe);

  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;

  const promise = computeMeasured(key, compute, describe);
  store.set(key, { promise, expiresAt: now + ttl });
  pruneStore(now);
  return promise;
}

/** Synchronous variant (the pure query builders) — same TTL, same invalidation. */
export function memoChannelGateSync<T>(key: string, compute: () => T): T {
  const ttl = channelGateCacheTtlMs();
  if (ttl <= 0) return compute();

  const now = Date.now();
  const hit = syncStore.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = compute();
  syncStore.set(key, { value, expiresAt: now + ttl });
  pruneStore(now);
  return value;
}

// ── Shared clauses (identical for every caller) ────────────────────────────

function catalogPresentation(): {
  publicCatalogPresentationQuery: () => Record<string, unknown>;
  publicCatalogHideQuery: () => Record<string, unknown>;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../utils/catalog-presentation');
}

/** Neutral-presentation clause (###, supplier "NEO" markers). Static → safe. */
export function getPublicCatalogPresentationQuery(): Record<string, unknown> {
  return memoChannelGateSync('presentationQuery', () => catalogPresentation().publicCatalogPresentationQuery());
}

/**
 * Operator-curated hidden-group clause. Memoized per env VALUE (the builder
 * reads `CATALOG_HIDE_GROUPS`), so changing the setting yields a new key
 * instead of serving a stale clause for up to a TTL.
 */
export function getPublicCatalogHideQuery(): Record<string, unknown> {
  const envValue = String(process.env.CATALOG_HIDE_GROUPS ?? '');
  return memoChannelGateSync(`hideQuery:${envValue}`, () => catalogPresentation().publicCatalogHideQuery());
}

// ── Xtream source visibility sets (3 distinct reads, same on every request) ─

/** Sources whose channels are customer-visible (verified / curated / direct). */
const VERIFIED_OR_VISIBLE_SOURCES = {
  $or: [
    { status: 'Active', verificationStatus: 'verified' },
    { customerVisible: true },
    { directPlayback: true },
  ],
};

/** Sources exempt from the server-side `isWorking` probe verdict. */
const IS_WORKING_EXEMPT_SOURCES = {
  $or: [{ directPlayback: true }, { customerVisible: true }],
};

/** Sources whose streams clients fetch from their own network. */
const DIRECT_PLAYBACK_SOURCES = { directPlayback: true };

async function distinctSourceIds(filter: Record<string, unknown>): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XtreamSource = require('../models/XtreamSource');
  const ids: unknown[] = await XtreamSource.find(filter).distinct('_id');
  return ids.map((id) => String(id));
}

export function getVerifiedXtreamSourceIds(): Promise<string[]> {
  return memoChannelGate('verifiedSourceIds', () => distinctSourceIds(VERIFIED_OR_VISIBLE_SOURCES), (ids) => ({
    channels: 0,
    identities: ids.length,
  }));
}

export function getIsWorkingExemptSourceIds(): Promise<string[]> {
  return memoChannelGate('isWorkingExemptSourceIds', () => distinctSourceIds(IS_WORKING_EXEMPT_SOURCES), (ids) => ({
    channels: 0,
    identities: ids.length,
  }));
}

export function getDirectPlaybackSourceIds(): Promise<string[]> {
  return memoChannelGate('directPlaybackSourceIds', () => distinctSourceIds(DIRECT_PLAYBACK_SOURCES), (ids) => ({
    channels: 0,
    identities: ids.length,
  }));
}

module.exports = {
  channelGateCacheTtlMs,
  clearChannelGateCache,
  channelGateCacheSize,
  memoChannelGate,
  memoChannelGateSync,
  getPublicCatalogPresentationQuery,
  getPublicCatalogHideQuery,
  getVerifiedXtreamSourceIds,
  getIsWorkingExemptSourceIds,
  getDirectPlaybackSourceIds,
};
