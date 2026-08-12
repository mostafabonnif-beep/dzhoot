const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AppSetting = require('../models/AppSetting');
const Channel = require('../models/Channel');
const Movie = require('../models/Movie');
const Episode = require('../models/Episode');
const { resolveUser } = require('../middleware/resolveUser');
const {
  isSubscriptionRequired,
  getActiveSubscription,
} = require('../services/subscription-service');
const { issuePlaybackToken } = require('../services/playback-token');

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
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }
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
    let url = null;

    if (contentType === 'LIVE') {
      content = await Channel.findOne({ _id: id, isActive: { $ne: false } }).lean();
      if (content) {
        const canAccessCatalog = isAdmin || req.user?.allCatalog === true;
        const assigned = (req.user?.channels || []).some((channelId) => String(channelId) === String(content._id));
        if (!canAccessCatalog && !assigned) {
          return res.status(404).json({ success: false, error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
        }
        url = content.channelUrl;
      }
    } else if (contentType === 'MOVIE') {
      content = await Movie.findOne({ _id: id, isActive: true }).lean();
      if (content) url = content.streamUrl;
    } else if (contentType === 'EPISODE') {
      content = await Episode.findById(id).lean();
      if (content) url = content.streamUrl;
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported contentType' });
    }

    if (!content) {
      return res.status(404).json({ success: false, error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
    }

    const channelListCode = String(req.user?.channelListCode || '').trim();
    if (!channelListCode) {
      return res.status(403).json({
        success: false,
        error: 'A registered playback device is required',
        code: 'PLAYBACK_DEVICE_REQUIRED',
      });
    }

    // Never return or place the upstream URL in a client-visible URL. The
    // encrypted, short-lived token is resolved only by the server-side proxy.
    const { token, expiresAt } = issuePlaybackToken({
      userId: String(req.user.id),
      channelListCode,
      streamUrl: url,
    });
    const playbackUrl = `/api/v1/tv/playback/${token}`;

    return res.json({
      success: true,
      data: {
        contentType,
        contentId: String(id),
        url: playbackUrl,
        expiresAt,
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
