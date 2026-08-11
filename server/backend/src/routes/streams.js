const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { resolveUser } = require('../middleware/resolveUser');
const {
  buildPlaybackUrl,
  isManagedContent,
  resolvePlaybackContent,
} = require('../utils/playback-security');
const {
  isSubscriptionRequired,
  getActiveSubscription,
} = require('../services/subscription-service');

// Stream authorization: /api/v1/streams
// The client requests a playable URL here instead of using raw catalog URLs,
// so the backend can enforce subscription state per playback.
router.use(resolveUser);

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

// POST /authorize — { contentType: 'LIVE'|'MOVIE'|'EPISODE', contentId }
router.post('/authorize', async (req, res) => {
  try {
    const { contentType, contentId } = req.body || {};
    if (!contentType || !contentId) {
      return res.status(400).json({ success: false, error: 'contentType and contentId are required' });
    }

    const id = parseId(contentId);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid contentId' });

    const isAdmin = req.user?.role === 'Admin';
    const subscriptionRequired = await isSubscriptionRequired();

    // Subscription gate (skipped for admins, and while the flag is off).
    let subscription = null;
    if (subscriptionRequired && !isAdmin) {
      subscription = await getActiveSubscription(req.user.id);
      if (!subscription) {
        return res.status(403).json({
          success: false,
          error: 'Your subscription has expired. Activate a new code to continue watching.',
          code: 'SUBSCRIPTION_EXPIRED',
        });
      }
    }

    let content = null;
    if (contentType === 'LIVE' || contentType === 'MOVIE' || contentType === 'EPISODE') {
      content = await resolvePlaybackContent(contentType, contentId);
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported contentType' });
    }

    if (!content) {
      return res.status(404).json({ success: false, error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
    }

    const playbackUrl = isManagedContent(content, contentType)
      ? buildPlaybackUrl(req, contentType, id)
      : contentType === 'LIVE'
        ? content.channelUrl
        : content.streamUrl;

    return res.json({
      success: true,
      data: {
        contentType,
        contentId: String(id),
        playbackUrl,
        authorized: true,
        subscriptionRequired,
        subscription: subscription
          ? { status: subscription.status, expiresAt: subscription.expiresAt }
          : null,
      },
    });
  } catch (err) {
    console.error('[streams] authorize error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
