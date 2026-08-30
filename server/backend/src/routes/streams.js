const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const mongoose = require('mongoose');
const AppSetting = require('../models/AppSetting');
const Channel = require('../models/Channel');
const Movie = require('../models/Movie');
const Episode = require('../models/Episode');
const Series = require('../models/Series');
const Season = require('../models/Season');
const XtreamSource = require('../models/XtreamSource');
const M3USource = require('../models/M3USource');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');
const { resolveUser } = require('../middleware/resolveUser');
const { checkPlaybackSubscription } = require('../services/playback-access-service');
const { issuePlaybackToken } = require('../services/playback-token');
const { registerStreamSession } = require('../services/stream-session-service');
const { getPublicBaseUrl } = require('../utils/public-url');
const { inferPlaybackMimeType, HLS_MIME_TYPE } = require('../utils/playback-mime');

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

// Demo mode: the same curated group set the browsing endpoint (channels.js)
// exposes. Demo callers can browse these groups but previously could never
// play anything — playback failed the subscription gate (CastError on the
// 'demo' id) and then the ownership check. Short-circuit demo here and scope
// LIVE playback to the curated set.
const DEMO_CHANNEL_GROUPS = (process.env.DEMO_CHANNEL_GROUPS || 'AR| ALGERIA الجزائر')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);
const isDemoRequest = (req) => req.user?.demo === true;

// POST /authorize — { contentType: 'LIVE'|'MOVIE'|'EPISODE', contentId }
router.post('/authorize', async (req, res) => {
  try {
    const { contentType, contentId } = req.body || {};
    if (!contentType || !contentId) {
      return res.status(400).json({ success: false, error: 'contentType and contentId are required' });
    }

    const id = parseId(contentId);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid contentId' });

    // Demo callers skip the subscription gate (they have no account, and the
    // 'demo' id would otherwise crash the ObjectId lookup with a CastError).
    const isDemo = isDemoRequest(req);
    const playbackAccess = isDemo
      ? { required: false, allowed: true, subscription: null }
      : await checkPlaybackSubscription(
          req.user?.id ? String(req.user.id) : undefined,
          req.user?.role,
        );
    const isAdmin = req.user?.role === 'Admin';
    const subscriptionRequired = playbackAccess.required;
    const subscription = playbackAccess.subscription;
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
    let directPlayback = false;

    // Direct playback is opt-in at deployment and provider level. This keeps
    // the default architecture server-authorized/proxy playback while allowing
    // operators with suitable redistribution rights to keep video bytes off
    // the DZ HOOF VPS.
    const directPlaybackEnabled = process.env.ALLOW_DIRECT_PLAYBACK === 'true';

    if (contentType === 'LIVE') {
      // Demo: restrict to the curated groups the browsing endpoint exposes.
      const liveQuery = { _id: id, isActive: { $ne: false } };
      if (isDemo) liveQuery.channelGroup = { $in: DEMO_CHANNEL_GROUPS };
      content = await Channel.findOne(liveQuery).lean();
      if (content) {
        const canAccessCatalog = isAdmin || req.user?.allCatalog === true || isDemo;
        const assigned = (req.user?.channels || []).some((channelId) => String(channelId) === String(content._id));
        if (!canAccessCatalog && !assigned) {
          return res.status(404).json({ success: false, error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
        }
        url = content.channelUrl;

        // Only Xtream sources currently expose an operator-controlled
        // directPlayback flag. M3U remains proxy-delivered unless it gets the
        // same explicit policy in a future source-management revision.
        const xtreamSourceId = content?.metadata?.xtreamSourceId;
        const m3uSourceId = content?.metadata?.m3uSourceId;
        if (xtreamSourceId) {
          const source = await XtreamSource.findOne({
            _id: xtreamSourceId,
            status: 'Active',
            verificationStatus: 'verified',
          }).select('directPlayback').lean();
          directPlayback = directPlaybackEnabled && source?.directPlayback === true;
        } else if (m3uSourceId) {
          // An M3U source is eligible only when its latest source-level
          // health state is usable. A stale/broken source must not become
          // playable merely because it was previously marked Active.
          const source = await M3USource.findOne({
            _id: m3uSourceId,
            status: 'Active',
            healthStatus: { $in: ['ONLINE', 'DEGRADED'] },
          }).select('directPlayback healthStatus lastHealthCheckAt').lean();
          directPlayback = directPlaybackEnabled && source?.directPlayback === true;
        }
      }
    } else if (contentType === 'MOVIE') {
      content = await Movie.findOne({ _id: id, isActive: true }).lean();
      if (content) {
        const source = await XtreamSource.findOne({
          _id: content.sourceId,
          status: 'Active',
          verificationStatus: 'verified',
        }).select('directPlayback').lean();
        if (!source) content = null;
        else {
          url = content.streamUrl;
          directPlayback = directPlaybackEnabled && source.directPlayback === true;
        }
      }
    } else if (contentType === 'EPISODE') {
      content = await Episode.findById(id).lean();
      if (content) {
        const [series, season] = await Promise.all([
          Series.findOne({ _id: content.seriesId, isActive: true }).select('sourceId').lean(),
          Season.findOne({ _id: content.seasonId, seriesId: content.seriesId }).select('_id').lean(),
        ]);
        const source = series
          ? await XtreamSource.findOne({
              _id: series.sourceId,
              status: 'Active',
              verificationStatus: 'verified',
            }).select('directPlayback').lean()
          : null;
        if (!series || !season || !source) content = null;
        else {
          url = content.streamUrl;
          directPlayback = directPlaybackEnabled && source.directPlayback === true;
        }
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

    // The initial API response never contains the upstream URL. In proxy mode
    // the token is resolved server-side. In direct mode the token endpoint
    // returns a redirect only after all authorization checks have succeeded.
    const rootSessionId = crypto.randomBytes(16).toString('hex');
    const { token, expiresAt } = issuePlaybackToken({
      userId: String(req.user.id),
      channelListCode,
      streamUrl: url,
      direct: directPlayback,
      sessionId: rootSessionId,
    });
    // The token URL carries a container hint: HLS payloads keep the .m3u8
    // suffix, progressive containers (MKV/MP4/AVI/TS — i.e. ALL of our VOD)
    // must NOT get it, otherwise Media3 infers HLS from the extension and
    // fails parsing the video bytes as a playlist (PARSING_CONTAINER_UNSUPPORTED).
    const playbackMimeType = inferPlaybackMimeType(url);
    const suffix = playbackMimeType === HLS_MIME_TYPE ? '.m3u8' : '';
    const playbackUrl = `${getPublicBaseUrl(req)}/api/v1/tv/playback/${token}${suffix}`;

    // Per-user concurrent stream limit. A new session is rejected when the limit is reached; existing sessions are preserved.
    const session = await registerStreamSession({
      userId: String(req.user.id),
      sessionId: rootSessionId,
      ttlSec: Math.max(0, (expiresAt - Date.now()) / 1000),
      maxConcurrentStreams: playbackAccess.plan?.maxConcurrentStreams,
    });
    if (!session.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Concurrent playback limit reached for this subscription',
        code: 'CONCURRENT_STREAM_LIMIT',
        streamLimit: { max: session.max, active: session.active },
      });
    }

    return res.json({
      success: true,
      data: {
        contentType,
        contentId: String(id),
        url: playbackUrl,
        expiresAt,
        // Container hint so clients pick the right extractor instead of
        // guessing from the (possibly extension-less) token URL.
        mimeType: playbackMimeType,
        authorized: true,
        deliveryMode: directPlayback ? 'direct' : 'proxy',
        subscriptionRequired,
        streamLimit: { max: session.max, active: session.active },
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
