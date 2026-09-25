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
const { isSourceEligibleForVod } = require('../services/source-eligibility');
const { resolveStreamDeviceHash } = require('../utils/stream-device-hash');
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
// Demo/free-tier LIVE scoping lives in services/channel-scope.
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
    // Part 5: plans may be Live-only or VOD-only — map the requested content
    // family onto the subscription gate. Legacy plans (no contentTypes) allow both.
    const planContentType = contentType === 'LIVE' ? 'Live' : 'VOD';
    const playbackAccess = isDemo
      ? { required: false, allowed: true, subscription: null }
      : await checkPlaybackSubscription(
          req.user?.id ? String(req.user.id) : undefined,
          req.user?.role,
          planContentType,
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

    // Free-tier capacity guard (shared with /tv/playback-token): the free code is
    // meant to be shared, so its consumption is capped — capacity and daily
    // egress. Shadow mode counts without refusing; no Redis fails open.
    const { resolveEgressTier } = require('../services/stream-usage-service');
    const { checkFreeTierAdmission } = require('../services/free-tier-guard');
    const viewerTier = await resolveEgressTier(
      String(req.user?.id || ''),
      req.user?.channelListCode,
    );
    if (viewerTier === 'free') {
      const viewerKey = req.user?.channelListCode
        ? `code:${req.user.channelListCode}`
        : `user:${req.user?.id || 'anonymous'}`;
      const ttlSec = Math.max(60, Math.round((Number(process.env.PLAYBACK_TOKEN_TTL_MS) || 900000) / 1000));
      const admission = await checkFreeTierAdmission(viewerKey, ttlSec);
      if (!admission.allowed) {
        return res.status(429).json({
          success: false,
          error: 'The free preview is at capacity right now. Activate a subscription code to keep watching.',
          code: admission.reason,
        });
      }
    }

    let content = null;
    let url = null;
    let directPlayback = false;

    // Direct playback is opt-in at deployment and provider level. This keeps
    // the default architecture server-authorized/proxy playback while allowing
    // operators with suitable redistribution rights to keep video bytes off
    // the DZ HOOF VPS.
    const directPlaybackEnabled = process.env.ALLOW_DIRECT_PLAYBACK === 'true';

    // Demo is a curated LIVE-only preview. Movies/episodes are paid content —
    // never authorize them for the public demo code, otherwise the whole VOD
    // catalog becomes playable for free.
    if (isDemo && contentType !== 'LIVE') {
      return res.status(404).json({ success: false, error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
    }

    if (contentType === 'LIVE') {
      // Freemium scope: a plan/free code limited to a set of channel groups can
      // only play inside them. Unrestricted callers (admin, full codes) get no
      // clause, so a channel outside the plan is simply not found — no leak.
      const { groupScopeClause } = require('../services/channel-scope');
      const liveQuery = { _id: id, isActive: { $ne: false } };
      Object.assign(liveQuery, (await groupScopeClause(req.user)) || {});
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
        // A movie is listed to the customer (isActive) or it is not — and a listed
        // movie must be playable. Requiring the LIVE verdict here meant one source
        // with dead channels turned every one of its 17,176 movies into a 404 while
        // the video bytes were reachable. See services/source-eligibility.ts.
        const source = await XtreamSource.findOne({ _id: content.sourceId })
          .select('status verificationStatus vodVerificationStatus customerVisible directPlayback')
          .lean();
        if (!isSourceEligibleForVod(source)) content = null;
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
        // Same reasoning as the MOVIE branch above: gate on whether the source may
        // serve customer-visible titles, not on the live-probe verdict.
        const source = series
          ? await XtreamSource.findOne({ _id: series.sourceId })
              .select('status verificationStatus vodVerificationStatus customerVisible directPlayback')
              .lean()
          : null;
        if (!series || !season || !isSourceEligibleForVod(source)) content = null;
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

    // Per-user concurrent stream limit (plan.maxConcurrentStreams, env default
    // otherwise). Under the strict policy (STREAM_LIMIT_POLICY=refuse, default)
    // only the SAME device may replace its own session; another device sharing
    // the subscription is refused instead of silently kicking the viewer out.
    const session = await registerStreamSession({
      userId: String(req.user.id),
      sessionId: rootSessionId,
      ttlSec: Math.max(0, (expiresAt - Date.now()) / 1000),
      maxConcurrentStreams: playbackAccess.plan?.maxConcurrentStreams,
      deviceHash: resolveStreamDeviceHash(req),
    });
    if (!session.allowed) {
      return res.status(429).json({
        success: false,
        code: 'CONCURRENT_STREAM_LIMIT',
        error: 'This subscription is already streaming on another device. Stop it there, or add a device to your plan.',
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
