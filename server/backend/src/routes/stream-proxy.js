const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { resolveManagedPlayback, canonicalResourcePath } = require('../utils/playback-security');
const { proxyResolvedStream } = require('../services/secure-playback-proxy');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { contentType, contentId, resource, url } = req.query;
    if (url || !contentType || !contentId || !['LIVE', 'MOVIE', 'EPISODE'].includes(String(contentType))) {
      return res.status(400).send('Managed playback requires contentType and contentId');
    }

    const playback = await resolveManagedPlayback(String(contentType), String(contentId), resource);
    if (!playback) return res.status(404).send('Managed content not found');

    return proxyResolvedStream(
      req,
      res,
      playback.url,
      '/api/v1/stream-proxy',
      (absoluteUrl) => {
        const resourcePath = canonicalResourcePath(absoluteUrl, playback.canonicalUrl, playback.content, String(contentType));
        return `/api/v1/stream-proxy?contentType=${encodeURIComponent(String(contentType))}&contentId=${encodeURIComponent(String(contentId))}&resource=${encodeURIComponent(resourcePath)}`;
      },
    );
  } catch (error) {
    if (res.headersSent) return;
    return res.status(502).send('Bad Gateway');
  }
});

router.options('/', (req, res) => {
  res.sendStatus(204);
});

module.exports = router;
