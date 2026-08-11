const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { isManagedPlaybackRequest, resolveManagedPlayback, canonicalResourcePath } = require('../utils/playback-security');
const { proxyResolvedStream } = require('../services/secure-playback-proxy');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const managedRequest = isManagedPlaybackRequest(req);
    if (managedRequest && req.query.url) {
      return res.status(400).send('Managed playback cannot include a raw URL');
    }

    let url = req.query.url;
    let playback = null;
    if (managedRequest) {
      playback = await resolveManagedPlayback(req.query.contentType, req.query.contentId, req.query.resource);
      if (!playback) return res.status(404).send('Managed content not found');
      url = playback.url;
    }

    if (!url) return res.status(400).send('URL parameter is required');
    try {
      new URL(url);
    } catch {
      return res.status(400).send('Invalid URL format');
    }

    if (!managedRequest) return proxyResolvedStream(req, res, url, '/api/v1/stream-proxy');

    const { contentType, contentId } = req.query;
    return proxyResolvedStream(
      req,
      res,
      url,
      '/api/v1/stream-proxy',
      (absoluteUrl) => {
        const resourcePath = canonicalResourcePath(absoluteUrl, playback.canonicalUrl, playback.content, contentType);
        return `/api/v1/stream-proxy?contentType=${encodeURIComponent(contentType)}&contentId=${encodeURIComponent(contentId)}&resource=${encodeURIComponent(resourcePath)}`;
      },
    );
  } catch (error) {
    if (res.headersSent) return;
    return res.status(502).send('Bad Gateway');
  }
});

router.options('/', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
  });
  res.sendStatus(204);
});

module.exports = router;
