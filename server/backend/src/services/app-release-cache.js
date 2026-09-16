const { CacheService } = require('./cache');

/**
 * Cache for the GitHub "latest release" lookup used by the app-update endpoints.
 *
 * Every install polls `/api/v1/app/version` at boot, so a live api.github.com call per
 * request exhausts the API rate limit and the endpoints degrade to HTTP 429 (observed
 * in the 2026-09-05 production load test: 0% success at 25 concurrent users). The
 * response is therefore cached in Redis under `ghrel:latest`.
 *
 * The cache has no TTL write-through from the publish path, so publishing a release
 * must invalidate it explicitly — see `POST /api/v1/admin/app-versions/cache/invalidate`
 * (`routes/admin-app-versions.js`). Without that, the API keeps advertising the previous
 * release for the length of the TTL.
 */
const RELEASE_CACHE_PREFIX = 'ghrel:';
const RELEASE_CACHE_TTL_SECONDS = 600; // 10 minutes
const LATEST_RELEASE_KEY = 'latest';

const ghReleaseCache = new CacheService(RELEASE_CACHE_PREFIX, RELEASE_CACHE_TTL_SECONDS);

/**
 * Drop the cached release lookup so the next request re-reads GitHub.
 *
 * Kept in its own module rather than exported from `routes/app-update.js` so the admin
 * router can invalidate the cache without reaching into another router's internals
 * (and without creating a route-to-route import).
 */
async function invalidateReleaseCaches() {
  await ghReleaseCache.delete(LATEST_RELEASE_KEY);
  return true;
}

module.exports = {
  ghReleaseCache,
  invalidateReleaseCaches,
  RELEASE_CACHE_PREFIX,
  RELEASE_CACHE_TTL_SECONDS,
  LATEST_RELEASE_KEY,
};
