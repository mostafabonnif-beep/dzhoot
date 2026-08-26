const express = require('express');
const router = express.Router();
const axios = require('axios');
const { requireAuth, requireAdmin } = require('./auth');
const { validateUrlForSSRF } = require('../utils/ssrf-guard');
const { audit } = require('../services/audit-log');

/**
 * GET /api/v1/image-proxy
 * Validate a logo URL for safety (SSRF, protocol), fetch it server-side and
 * relay the bytes to the client. The origin host NEVER appears to the
 * client (no redirects — a 302 would hand the provider's image host to every
 * customer/reseller browser). Responses are cached in memory (shared catalog
 * logos hit the cache constantly).
 * Query params:
 *   - url: The image URL to relay
 */
const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const IMAGE_CACHE_MAX_ENTRIES = 2000;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const imageCache = new Map();

const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function sendPlaceholder(res) {
  res.set('Content-Type', 'image/png');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(PLACEHOLDER_PNG);
}

// Allow auth via query params for browser-initiated requests (e.g. <img src="...">)
router.get(
  '/',
  (req, res, next) => {
    if (!req.headers['x-session-id'] && req.query.sid) {
      req.headers['x-session-id'] = req.query.sid;
    }
    if (!req.headers['authorization'] && req.query.token) {
      req.headers['authorization'] = `Bearer ${req.query.token}`;
    }
    next();
  },
  requireAuth,
  async (req, res) => {
    try {
      const { url } = req.query;

      if (!url) {
        return res.status(400).json({
          success: false,
          error: 'URL parameter is required',
        });
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return res.status(400).json({
          success: false,
          error: 'Invalid URL format',
        });
      }

      // Serve from cache first (keyed by the exact upstream URL).
      const cached = imageCache.get(url);
      if (cached && Date.now() - cached.at < IMAGE_CACHE_TTL_MS) {
        res.set('Content-Type', cached.type);
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(cached.body);
      }

      // Block SSRF (with DNS resolution check)
      const ssrfCheck = await validateUrlForSSRF(url);
      if (!ssrfCheck.safe) {
        return res.status(403).json({
          success: false,
          error: ssrfCheck.reason,
        });
      }

      // Fetch server-side and relay the bytes — the client never learns the
      // origin host.
      const upstream = await axios.get(url, {
        timeout: 8000,
        maxRedirects: 3,
        responseType: 'arraybuffer',
        maxContentLength: IMAGE_MAX_BYTES,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DZHOOF/1.0)', Accept: 'image/*,*/*;q=0.8' },
      });
      const contentType = String(upstream.headers['content-type'] || 'image/png')
        .split(';')[0]
        .trim();
      if (!/^image\//.test(contentType)) {
        return sendPlaceholder(res);
      }
      const body = Buffer.from(upstream.data);
      imageCache.set(url, { at: Date.now(), body, type: contentType });
      if (imageCache.size > IMAGE_CACHE_MAX_ENTRIES) {
        const oldest = imageCache.keys().next().value;
        if (oldest) imageCache.delete(oldest);
      }

      res.set('Content-Type', contentType);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(body);
    } catch (error) {
      console.error('Image proxy error:', error.message);
      return sendPlaceholder(res);
    }
  },
);

/**
 * GET /api/v1/image-proxy/stats
 * Returns proxy mode + cache info
 */
router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  res.json({
    success: true,
    data: {
      mode: 'relay',
      description:
        'Image proxy fetches images server-side and relays the bytes. Origin hosts are never exposed to clients. Responses cached in memory for 24h.',
      cacheEntries: imageCache.size,
      cacheMaxEntries: IMAGE_CACHE_MAX_ENTRIES,
    },
  });
});

/**
 * DELETE /api/v1/image-proxy/cache
 * Clears the in-memory relay cache
 */
router.delete('/cache', requireAuth, requireAdmin, (req, res) => {
  const itemsCleared = imageCache.size;
  imageCache.clear();

  audit({
    userId: req.user.id,
    action: 'clear_image_cache',
    resource: 'image_proxy',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json({
    success: true,
    message: 'Image relay cache cleared',
    itemsCleared,
  });
});

module.exports = router;
