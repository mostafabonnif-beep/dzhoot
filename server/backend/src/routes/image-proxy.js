const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { requireAuth, requireAdmin } = require('./auth');
const { validateUrlForSSRF } = require('../utils/ssrf-guard');
const { audit } = require('../services/audit-log');

// ---------------------------------------------------------------------------
// Signed image URLs (no more credentials in query strings)
//
// WHY: the old browser-initiated flow (<img src="/api/v1/image-proxy?url=..&sid=..">)
// put live session IDs / JWTs in the query string, which leak into Caddy
// access logs and browser history.
//
// Flow:
//   1. The frontend calls GET /api/v1/image-proxy/sign?url=<encoded> with the
//      session in headers (requireAuth — x-session-id or Bearer), never in the
//      URL. The endpoint answers { exp, sig, url } where sig is an HMAC-SHA256
//      over the literal string `${exp}:${rawUrl}`.
//   2. The frontend points <img src> at the returned `url` (relative proxy
//      path carrying url/exp/sig only). The proxy verifies exp is fresh (30s
//      clock-skew allowance) and the signature matches in constant time, then
//      proxies/redirects WITHOUT needing a session — so <img> tags work while
//      the signature (10 min TTL) limits replay and no credential ever touches
//      a URL or a log line.
//   3. Legacy ?sid= / ?token= auth below is kept ONLY so pages rendered before
//      this rollout keep working; new code must never put credentials in the
//      query string.
// ---------------------------------------------------------------------------

const IMAGE_SIGN_TTL_MS = 10 * 60 * 1000; // signatures are valid for 10 minutes
const IMAGE_SIGN_CLOCK_SKEW_MS = 30 * 1000; // allow 30s skew on exp

/**
 * HMAC key for image-URL signatures. Order mirrors services/playback-token.ts
 * (JWT_ACCESS_SECRET → PLAYBACK_TOKEN_SECRET → XTREAM_SECRET_KEY) so a
 * deployment only needs one of them configured. Never silently falls back to a
 * known development value in production — a predictable key would let anyone
 * mint signed image URLs.
 */
function getImageSigningSecret() {
  const secret =
    process.env.JWT_ACCESS_SECRET ||
    process.env.PLAYBACK_TOKEN_SECRET ||
    process.env.XTREAM_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET is required in production (image proxy signing)');
    }
    throw new Error('Image proxy signing secret is not configured');
  }
  return secret;
}

/** Constant-time comparison of two lowercase hex HMAC digests. */
function timingSafeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a signed proxy request (?url=&exp=&sig=).
 * Returns null when valid, otherwise an error message suitable for a 401.
 */
function verifySignedImageUrl(query) {
  const { url, exp, sig } = query;
  const expMs = Number(exp);
  if (typeof url !== 'string' || !url || !Number.isFinite(expMs) || typeof sig !== 'string') {
    return 'Invalid or missing signature parameters';
  }

  // exp must not be past (small clock-skew allowance).
  if (Date.now() > expMs + IMAGE_SIGN_CLOCK_SKEW_MS) {
    return 'Image URL signature expired';
  }

  // Recompute the HMAC over the exact literal the client sent back and compare
  // in constant time. Any tampering with url/exp/sig fails here.
  const expected = crypto
    .createHmac('sha256', getImageSigningSecret())
    .update(`${exp}:${url}`)
    .digest('hex');
  if (!timingSafeHexEqual(sig, expected)) {
    return 'Invalid image URL signature';
  }
  return null;
}

/**
 * GET /api/v1/image-proxy/sign?url=<encoded image url>
 * Auth-protected (same requireAuth the proxy itself relies on). Exchanges the
 * caller's session for a short-lived HMAC signature over the target URL so a
 * plain <img src> can load the image without embedding credentials.
 */
router.get('/sign', requireAuth, async (req, res) => {
  try {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!rawUrl) {
      return res.status(400).json({
        success: false,
        error: 'URL parameter is required',
      });
    }

    // Only http(s) targets are ever signed.
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format',
      });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).json({
        success: false,
        error: 'Only http and https URLs are allowed',
      });
    }

    const exp = Date.now() + IMAGE_SIGN_TTL_MS;
    const sig = crypto
      .createHmac('sha256', getImageSigningSecret())
      .update(`${exp}:${rawUrl}`)
      .digest('hex');

    res.json({
      exp,
      sig,
      url: `/api/v1/image-proxy?${new URLSearchParams({ url: rawUrl, exp: String(exp), sig })}`,
    });
  } catch (error) {
    console.error('Image proxy sign error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to sign image URL',
    });
  }
});

/**
 * GET /api/v1/image-proxy
 * Validate a logo URL for safety (SSRF, protocol) then 302 redirect to the original.
 * No bytes are proxied or cached — the browser fetches directly from the origin.
 * Query params:
 *   - url: The image URL to redirect to
 */
router.get(
  '/',
  // Auth gate: signed-URL fast path (HMAC + exp) OR legacy session flow.
  // The signed params are checked BEFORE any sid/token query param is trusted.
  (req, res, next) => {
    const hasSignedParams =
      req.query.sig != null && req.query.exp != null && req.query.url != null;

    if (hasSignedParams) {
      // Signed <img src> flow — a browser <img> cannot send auth headers, so a
      // valid short-lived signature stands in for the session.
      const error = verifySignedImageUrl(req.query);
      if (error) {
        return res.status(401).json({ success: false, error });
      }
      return next();
    }

    // Legacy flow (rollout compatibility for already-rendered pages): allow
    // auth via query params for browser-initiated requests (e.g. <img src="...">).
    if (!req.headers['x-session-id'] && req.query.sid) {
      req.headers['x-session-id'] = req.query.sid;
    }
    if (!req.headers['authorization'] && req.query.token) {
      req.headers['authorization'] = `Bearer ${req.query.token}`;
    }
    return requireAuth(req, res, next);
  },
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

      // Block SSRF (with DNS resolution check)
      const ssrfCheck = await validateUrlForSSRF(url);
      if (!ssrfCheck.safe) {
        return res.status(403).json({
          success: false,
          error: ssrfCheck.reason,
        });
      }

      // Redirect to the original URL — browser fetches the image directly
      res.set('Cache-Control', 'public, max-age=86400'); // browsers cache the redirect for 24h
      res.set('X-Content-Type-Options', 'nosniff');
      res.redirect(302, url);
    } catch (error) {
      console.error('Image proxy error:', error.message);

      // Return a default placeholder image (1x1 transparent PNG)
      const placeholderPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64',
      );

      res.set('Content-Type', 'image/png');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'public, max-age=300');
      res.send(placeholderPng);
    }
  },
);

/**
 * GET /api/v1/image-proxy/stats
 * Returns proxy mode info (no cache to report since we use redirect mode)
 */
router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  res.json({
    success: true,
    data: {
      mode: 'redirect',
      description:
        'Image proxy validates URLs and redirects to the original source. No server-side caching.',
    },
  });
});

/**
 * DELETE /api/v1/image-proxy/cache
 * No-op in redirect mode — kept for API compatibility
 */
router.delete('/cache', requireAuth, requireAdmin, (req, res) => {
  audit({
    userId: req.user.id,
    action: 'clear_image_cache',
    resource: 'image_proxy',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json({
    success: true,
    message: 'Image proxy uses redirect mode — no server-side cache to clear',
    itemsCleared: 0,
  });
});

module.exports = router;
