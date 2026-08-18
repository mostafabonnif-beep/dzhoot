const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AppSetting = require('../models/AppSetting');
const Channel = require('../models/Channel');
const Movie = require('../models/Movie');
const Episode = require('../models/Episode');
const Series = require('../models/Series');
const Season = require('../models/Season');
const XtreamSource = require('../models/XtreamSource');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');
const { resolveUser } = require('../middleware/resolveUser');
const { checkPlaybackSubscription } = require('../services/playback-access-service');
const { issuePlaybackToken } = require('../services/playback-token');
const { registerStreamSession } = require('../services/stream-session-service');
const { getPublicBaseUrl } = require('../utils/public-url');

// Stream authorization: /api/v1/streams
// The client requests a playable URL here instead of using raw catalog URLs,
// so the backend can enforce subscription state per playback.
router.use((req, res, next) => {
  const hasBearer = String(req.headers.authorization || '').startsWith('Bearer ');
  const hasTvOrSession = Boolean(req.headers['x-tv-code'] || req.headers['x-session-id']);
  return hasBearer && !hasTvOrSession
    ? resolveUser(req, res, next)
    : requireTvOrSessionAuth(req, res, next);
});

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

    const playbackAccess = await checkPlaybackSubscription(
      req.user?.id ? String(req.user.id) : undefined,
      req.user?.role,
    );
    const isAdmin = req.user?.role === 'Admin';
    const subscriptionRequired = playbackAccess.required;
    const subscription = playbackAccess.subscription;
    const entitlement = playbackAccess.entitlement;
    const contentEntitlementAllowed = contentType === 'LIVE' ? entitlement.allowLive : entitlement.allowVod;
    if (playbackAccess.required && !isAdmin && !contentEntitlementAllowed) {
      return res.status(403).json({ success: false, error: 'Your subscription plan does not include this content type', code: 'ENTITLEMENT_DENIED' });
    }
    if (!playbackAccess.allowed) {
      return res.status(req.user ? 403 : 401).json({
        success: false,
        error: req.user
          ? 'Your subscription has expired. Activate a new code to continue watching.'
          : 'Authentication required',
        code: req.user ? 'SUBSCRIPTION_EXPIRED' : 'AUTHENTICATION_REQUIRED',
      });
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
      if (content) {
        const sourceIsActive = await XtreamSource.exists({ _id: content.sourceId, status: 'Active' });
        if (!sourceIsActive) content = null;
        else url = content.streamUrl;
      }
    } else if (contentType === 'EPISODE') {
      content = await Episode.findById(id).lean();
      if (content) {
        const [series, season] = await Promise.all([
          Series.findOne({ _id: content.seriesId, isActive: true }).select('sourceId').lean(),
          Season.findOne({ _id: content.seasonId, seriesId: content.seriesId }).select('_id').lean(),
        ]);
        const sourceIsActive = series
          ? await XtreamSource.exists({ _id: series.sourceId, status: 'Active' })
          : null;
        if (!series || !season || !sourceIsActive) content = null;
        else url = content.streamUrl;
      }
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
      credentialVersion: Number(req.user.playbackCredentialVersion || 1),
      ...(req.device ? { deviceId: req.device.deviceId, deviceCredentialVersion: req.device.credentialVersion } : {}),
      streamUrl: url,
    });
    const playbackUrl = `${getPublicBaseUrl(req)}/api/v1/tv/playback/${token}`;

    // Per-user concurrent stream limit (oldest evicted; no-op without Redis).
    const session = await registerStreamSession({
      userId: String(req.user.id),
      sessionId: token,
      ttlSec: Math.max(0, (expiresAt - Date.now()) / 1000),
      maxStreams: isAdmin ? undefined : entitlement.maxConcurrentStreams || undefined,
    });

    return res.json({
      success: true,
      data: {
        contentType,
        contentId: String(id),
        url: playbackUrl,
        expiresAt,
        authorized: true,
        subscriptionRequired,
        streamLimit: { max: session.max, active: session.active },
        subscription: subscription
          ? { status: subscription.status, expiresAt: subscription.expiresAt, plan: playbackAccess.plan ? { id: String(playbackAccess.plan._id || playbackAccess.plan.id || ''), name: playbackAccess.plan.name } : null }
          : null,
      },
    });
  } catch (err) {
    console.error('[streams] authorize error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
