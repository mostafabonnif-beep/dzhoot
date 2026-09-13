/**
 * Ads endpoints.
 *
 *   GET /api/v1/ads/config — public. The operator's ad identifiers plus the
 *                            rendering hints. Ad client/slot ids are public by
 *                            design (they ship inside every client build); no
 *                            secret ever leaves this endpoint.
 *   GET /api/v1/ads/me     — authenticated. Whether THIS account should show
 *                            ads, with the config, in one round trip.
 *
 * Nothing is served when the operator has not enabled ads.
 */
const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/resolveUser');
const { getAdsConfig, publicAdsConfig, adsPolicyForUser } = require('../services/ads-policy');

router.get('/config', async (req, res) => {
  try {
    const config = await getAdsConfig();
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({ success: true, data: publicAdsConfig(config) });
  } catch (err) {
    console.error('[ads] config error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

router.get('/me', optionalAuth, async (req, res) => {
  try {
    const policy = await adsPolicyForUser(req.user || null);
    return res.json({
      success: true,
      data: { show: policy.showAds, reason: policy.reason, ...policy.config },
    });
  } catch (err) {
    console.error('[ads] me error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
