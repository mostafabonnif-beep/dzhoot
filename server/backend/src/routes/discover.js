const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/resolveUser');
const { getDiscoverHome, buildDiscoverHome } = require('../services/discover-service');

// Discover Engine — curated smart home for end users.
// Auth optional: anonymous visitors get the same curated home (playback itself
// is gated at /streams/authorize). No secrets or user data in this payload.
router.use(optionalAuth);

/**
 * GET /api/v1/discover/home
 * Cached (60s) curated home: trending, live-now, latest VOD, collections, EPG.
 */
router.get('/home', async (req, res) => {
  try {
    const data = await getDiscoverHome(req.query.refresh === '1');
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[discover] home error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
