const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();
const Channel = require('../models/Channel');
const XtreamSource = require('../models/XtreamSource');
const { recordPlaybackEvent } = require('../services/playback-event-service');
const User = require('../models/User');
const { requireAuth, requireAdmin } = require('./auth');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');
const { escapeRegex } = require('../utils/escapeRegex');
const { validateUrlForSSRF, isPrivateIP, createPinnedLookup } = require('../utils/ssrf-guard');
const { audit } = require('../services/audit-log');
const { channelCache } = require('../services/cache');
const { buildChannelHealth } = require('../utils/channel-health');

// The shared admin/demo catalog is identical for every admin hit and is the heaviest
// read. Cache it (10 min TTL via channelCache) and bust it on any catalog mutation.
// Per-user lists are NOT cached here — they change through many assignment paths.
function invalidateCatalogCache() {
  return channelCache.deletePattern('catalog:*');
}

// Xtream channels are customer-visible only when their source has passed a live
// playback probe. Missing verification is intentionally treated as unavailable.
// Direct-playback / customer-visible sources are exempt: their isWorking flag
// reflects the server's datacenter IP (blocked upstream), not the customer's
// network — the same policy as the playlist routes (tv.js / User.ts).
async function verifiedXtreamChannelQuery(baseQuery) {
  const verifiedSourceIds = (await XtreamSource.find({
    $or: [
      { status: 'Active', verificationStatus: 'verified' },
      { customerVisible: true },
      { directPlayback: true },
    ],
  }).distinct('_id')).map((id) => String(id));
  const directPlaybackSourceIds = (await XtreamSource.find({
    directPlayback: true,
  }).distinct('_id')).map((id) => String(id));
  return {
    $and: [
      baseQuery,
      {
        isActive: { $ne: false },
        'flaggedBad.isFlagged': { $ne: true },
      },
      {
        $nor: [
          // Sources that are neither verified nor operator-visible are hidden.
          {
            'metadata.source': 'xtream',
            'metadata.xtreamSourceId': { $nin: verifiedSourceIds },
          },
          // isWorking is measured from the server datacenter IP — exempt
          // direct-playback sources so their whole catalog stays visible.
          {
            'metadata.isWorking': false,
            'metadata.xtreamSourceId': { $nin: directPlaybackSourceIds },
          },
        ],
      },
    ],
  };
}

// Max channels the TV app receives in one sync. DZ HOOF serves the full catalog
// (~16.6k channels) to subscribers — the cap is a safety valve against pathological
// payloads, not a browse limit. Override via TV_CHANNELS_MAX if the catalog grows.
const TV_CHANNELS_MAX = Number(process.env.TV_CHANNELS_MAX) || 20000;

// In-memory rate-limit maps for stream metrics reporting
const reportStatusLimits = new Map();
const reportPlayLimits = new Map();
const qoeReportLimits = new Map();
const healthSyncLimits = new Map();
const flagLimits = new Map();

// Android and M3U clients use the external channelId (for example, m3u:source:hash),
// while legacy clients may still send MongoDB _id values. Resolve both safely so a text
// identifier never reaches a findById() cast path.
function channelRouteQuery(channelRef) {
  const value = String(channelRef || '').trim();
  if (!value) return { channelId: '__missing_channel__' };
  return mongoose.isValidObjectId(value)
    ? { $or: [{ _id: value }, { channelId: value }] }
    : { channelId: value };
}

// Cleanup stale rate-limit entries every 10 minutes
// .unref() ensures this timer doesn't prevent graceful process exit
setInterval(
  () => {
    const now = Date.now();
    for (const [key, ts] of reportStatusLimits) {
      if (now - ts > 5 * 60 * 1000) reportStatusLimits.delete(key);
    }
    for (const [key, ts] of reportPlayLimits) {
      if (now - ts > 60 * 1000) reportPlayLimits.delete(key);
    }
    for (const [key, timestamps] of qoeReportLimits) {
      const recent = timestamps.filter((ts) => now - ts <= 60 * 1000);
      if (recent.length === 0) qoeReportLimits.delete(key);
      else qoeReportLimits.set(key, recent);
    }
    for (const [key, ts] of healthSyncLimits) {
      if (now - ts > 5 * 60 * 1000) healthSyncLimits.delete(key);
    }
    for (const [key, ts] of flagLimits) {
      if (now - ts > 60 * 1000) flagLimits.delete(key);
    }
    // Cap map sizes to prevent unbounded growth between cleanups
    if (reportStatusLimits.size > 50000) reportStatusLimits.clear();
    if (reportPlayLimits.size > 50000) reportPlayLimits.clear();
    if (qoeReportLimits.size > 50000) qoeReportLimits.clear();
    if (healthSyncLimits.size > 50000) healthSyncLimits.clear();
    if (flagLimits.size > 50000) flagLimits.clear();
  },
  10 * 60 * 1000,
).unref();

// Filter alternateStreams to viable entries for client consumption.
// Keeps full objects (liveness, flaggedBad, etc.) so web frontend can display rich details.
function slimAlternates(channel, directPlaybackSourceIds = new Set()) {
  const safeChannel = { ...channel, channelUrl: '' };
  safeChannel.alternateStreams = (channel.alternateStreams || [])
    .filter((alt) => alt.liveness?.status !== 'dead' && alt.flaggedBad?.isFlagged !== true)
    .slice(0, 10)
    .map((alt) => ({ ...alt, streamUrl: '' }));
  // Expose only the catch-up CAPABILITY — never the raw source template, which
  // may embed upstream credentials (catchup-source="http://user:pass@…").
  // Legacy Xtream channels (pre-catch-up sync) are reported as capable so the
  // app can offer timeshift playback even before the backfill migration runs.
  const stored = channel.catchup;
  const legacyXtream =
    channel.metadata?.source === 'xtream' &&
    channel.metadata?.xtreamStreamId !== undefined &&
    channel.metadata?.xtreamStreamId !== null;
  safeChannel.catchup = stored?.type
    ? { type: stored.type, days: stored.days || null }
    : legacyXtream
      ? { type: 'timeshift', days: null }
      : null;
  // Add an explainable, URL-free availability summary for TV clients and admin UI.
  // Direct-playback sources can't be probed from the datacenter — mark them so
  // the health summary doesn't report a false "dead/unavailable".
  safeChannel.health = buildChannelHealth({
    ...channel,
    directPlayback: directPlaybackSourceIds.has(String(channel.metadata?.xtreamSourceId || '')),
  });
  return safeChannel;
}

// Direct-playback source ids — sources whose streams clients fetch from their
// own networks; the server's datacenter probe cannot judge their liveness.
async function getDirectPlaybackSourceIds() {
  return new Set(
    (await XtreamSource.find({ directPlayback: true }).distinct('_id')).map((id) => String(id)),
  );
}

// Whitelist projection for the list endpoints (/, /grouped, /search) — verified against what
// the Android app deserializes and the web frontend reads from THESE endpoints. Drops metrics,
// timestamps, ownerId, DRM key, unused metadata and heavy alternate subfields (~40% smaller).
// Single-channel endpoints (/:id, /:id/with-fallbacks) still return the full document.
const CHANNEL_LIST_FIELDS = [
  'channelId channelName channelUrl channelImg tvgLogo tvgName tvgId channelGroup',
  'channelDrmType order isActive',
  'metadata.country metadata.language metadata.quality',
  'metadata.isWorking metadata.lastTested metadata.responseTime',
  'metadata.source metadata.xtreamStreamId metadata.xtreamSourceId',
  'identityKey identityConfidence identityMatch',
  'catchup.type catchup.days',
  'flaggedBad.isFlagged flaggedBad.reason',
  'alternateStreams.streamUrl alternateStreams.quality',
  'alternateStreams.liveness.status alternateStreams.liveness.responseTimeMs',
  'alternateStreams.liveness.lastCheckedAt',
  'alternateStreams.flaggedBad.isFlagged alternateStreams.flaggedBad.reason',
].join(' ');

// Get channels (for Android app sync) — accepts TV code or session auth, excludes DRM keys
router.get('/', requireTvOrSessionAuth, async (req, res) => {
  try {
    // allCatalog users are served the shared catalog like admins — avoids a giant $in.
    const catalogView = req.user.role === 'Admin' || req.user.allCatalog === true;

    // The catalog payload is identical across requests — serve from cache when present.
    if (catalogView) {
      const cached = await channelCache.get('catalog:list');
      if (cached) return res.json(cached);
    }

    // Catalog view sees the shared catalog only (ownerId:null); a user sees their own selection.
    const baseQuery = catalogView
      ? { ownerId: null }
      : { _id: { $in: (req.user.channels || []).filter(Boolean) }, isActive: { $ne: false } };
    const query = await verifiedXtreamChannelQuery(baseQuery);

    const channels = await Channel.find(query)
      .sort({ channelGroup: 1, order: 1 })
      // Bound every response — large payloads crash low-end TV sticks.
      .limit(TV_CHANNELS_MAX)
      .select(CHANNEL_LIST_FIELDS)
      .lean();

    const directSourceIds = await getDirectPlaybackSourceIds();
    const payload = {
      success: true,
      count: channels.length,
      data: channels.map((channel) => slimAlternates(channel, directSourceIds)),
    };

    if (catalogView) await channelCache.set('catalog:list', payload);

    res.json(payload);
  } catch (error) {
    console.error('Error fetching channels:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch channels',
    });
  }
});

// Get channels grouped by category
router.get('/grouped', requireTvOrSessionAuth, async (req, res) => {
  try {
    const catalogView = req.user.role === 'Admin' || req.user.allCatalog === true;

    if (catalogView) {
      const cached = await channelCache.get('catalog:grouped');
      if (cached) return res.json(cached);
    }

    // Catalog view sees the shared catalog only (ownerId:null); a user sees their own selection.
    const baseQuery = catalogView
      ? { ownerId: null }
      : { _id: { $in: (req.user.channels || []).filter(Boolean) }, isActive: { $ne: false } };
    const query = await verifiedXtreamChannelQuery(baseQuery);

    const channels = await Channel.find(query)
      .sort({ channelGroup: 1, order: 1 })
      // Bound every response — large payloads crash low-end TV sticks.
      .limit(TV_CHANNELS_MAX)
      .select(CHANNEL_LIST_FIELDS)
      .lean();

    // Group by channelGroup (dead/flagged alternates slimmed, same as /)
    const directSourceIds = await getDirectPlaybackSourceIds();
    const grouped = channels.reduce((acc, channel) => {
      const group = channel.channelGroup || 'Uncategorized';
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push(slimAlternates(channel, directSourceIds));
      return acc;
    }, {});

    const payload = {
      success: true,
      data: grouped,
    };

    if (catalogView) await channelCache.set('catalog:grouped', payload);

    res.json(payload);
  } catch (error) {
    console.error('Error fetching grouped channels:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch grouped channels',
    });
  }
});

// Get M3U playlist (requires global playlist code - LEGACY ENDPOINT)
router.get('/playlist.m3u', async (req, res) => {
  try {
    if (process.env.ALLOW_LEGACY_RAW_PLAYLIST !== 'true') {
      return res.status(410).json({ success: false, error: 'Legacy raw playlist disabled; use an authenticated playlist' });
    }
    const providedCode = req.query.code || req.headers['x-playlist-code'];
    const requiredCode = process.env.PLAYLIST_CODE || process.env.SUPER_ADMIN_CHANNEL_LIST_CODE;

    if (!requiredCode) {
      return res.status(500).json({ success: false, error: 'Playlist access not configured' });
    }
    if (!providedCode) {
      return res.status(401).json({ success: false, error: 'Playlist code required' });
    }
    // Constant-time compare to avoid leaking the code via timing side-channel.
    const providedBuf = Buffer.from(String(providedCode));
    const requiredBuf = Buffer.from(String(requiredCode));
    if (
      providedBuf.length !== requiredBuf.length ||
      !crypto.timingSafeEqual(providedBuf, requiredBuf)
    ) {
      return res.status(403).json({ success: false, error: 'Invalid playlist code' });
    }

    // Rendered playlist is identical for every caller — cache it (busted with catalog:* on mutations).
    let m3uContent = await channelCache.get('catalog:m3u');
    if (!m3uContent) {
      m3uContent = await Channel.generateM3UPlaylist();
      await channelCache.set('catalog:m3u', m3uContent);
    }
    res.setHeader('Content-Type', 'application/x-mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u"');
    res.send(m3uContent);
  } catch (error) {
    console.error('Error generating M3U playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to generate M3U playlist' });
  }
});

// Search channels (with regex escaping to prevent ReDoS)
router.get('/search', requireTvOrSessionAuth, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Search query is required' });
    }
    if (q.length > 500) {
      return res
        .status(400)
        .json({ success: false, error: 'Search query too long (max 500 characters)' });
    }

    const escaped = escapeRegex(q);
    const searchFilter = {
      $or: [
        { channelName: { $regex: escaped, $options: 'i' } },
        { channelGroup: { $regex: escaped, $options: 'i' } },
        { channelId: { $regex: escaped, $options: 'i' } },
      ],
    };

    if (req.user.role !== 'Admin' && req.user.allCatalog !== true) {
      searchFilter._id = { $in: (req.user.channels || []).filter(Boolean) };
      searchFilter.isActive = { $ne: false };
    } else {
      // Admin/demo/allCatalog search the shared catalog only, never users' private channels.
      searchFilter.ownerId = null;
    }

    const channels = await Channel.find(searchFilter)
      .sort({ channelGroup: 1, order: 1 })
      .limit(TV_CHANNELS_MAX)
      .select(CHANNEL_LIST_FIELDS)
      .lean();

    res.json({ success: true, count: channels.length, data: channels.map(slimAlternates) });
  } catch (error) {
    console.error('Error searching channels:', error);
    res.status(500).json({ success: false, error: 'Failed to search channels' });
  }
});

// Bulk health sync from scanner/client — TV or session auth (must be BEFORE /:id to avoid route shadowing)
// Rate limit: 1 per device per 5 minutes
router.post('/health-sync', requireTvOrSessionAuth, async (req, res) => {
  try {
    const { deviceId, reports: reportsRaw, results: resultsRaw } = req.body;
    // Android app sends "results", web may send "reports" — accept both
    const reports = reportsRaw || resultsRaw;

    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ success: false, error: 'deviceId is required' });
    }
    if (!Array.isArray(reports) || reports.length === 0) {
      return res.status(400).json({ success: false, error: 'reports array is required' });
    }
    if (reports.length > 100) {
      return res.status(400).json({ success: false, error: 'Maximum 100 reports per sync' });
    }

    // Rate limiting — key by authenticated user + device to prevent spoofing
    const userId = req.user?.id?.toString() || 'anon';
    const rateLimitKey = `health-sync:${userId}:${deviceId}`;
    const lastSync = healthSyncLimits.get(rateLimitKey);
    if (lastSync && Date.now() - lastSync < 5 * 60 * 1000) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. One health sync per device per 5 minutes.',
      });
    }

    // A client may report either MongoDB _id or the external M3U channelId.
    // Never pass compound IDs such as "m3u:source:hash" into an ObjectId query.
    const reportedIds = [
      ...new Set(reports.map((r) => r.channelId).filter((id) => id && typeof id === 'string')),
    ];
    const mongoIds = reportedIds.filter((id) => mongoose.isValidObjectId(id));
    const lookupClauses = [{ channelId: { $in: reportedIds } }];
    if (mongoIds.length > 0) lookupClauses.push({ _id: { $in: mongoIds } });

    const existingChannels = await Channel.find(
      { $or: lookupClauses },
      { _id: 1, channelId: 1 },
    ).lean();
    const databaseIdsByReportedId = new Map();
    for (const channel of existingChannels) {
      databaseIdsByReportedId.set(channel._id.toString(), channel._id);
      if (typeof channel.channelId === 'string' && channel.channelId.length > 0) {
        databaseIdsByReportedId.set(channel.channelId, channel._id);
      }
    }

    const validStatuses = ['dead', 'alive', 'unresponsive', 'played'];
    const results = { updated: 0, failed: 0, skipped: 0 };

    for (const report of reports) {
      if (!report.channelId || !report.status || !validStatuses.includes(report.status)) {
        results.skipped++;
        continue;
      }
      const databaseId = databaseIdsByReportedId.get(report.channelId.toString());
      if (!databaseId) {
        results.skipped++;
        continue;
      }

      const update = {};
      const now = new Date();

      if (report.status === 'dead') {
        update.$inc = { 'metrics.deadCount': 1 };
        update.$set = { 'metrics.lastDeadAt': now };
      } else if (report.status === 'alive') {
        update.$inc = { 'metrics.aliveCount': 1 };
        update.$set = { 'metrics.lastAliveAt': now };
      } else if (report.status === 'unresponsive') {
        update.$inc = { 'metrics.unresponsiveCount': 1 };
        update.$set = { 'metrics.lastUnresponsiveAt': now };
      } else if (report.status === 'played') {
        update.$inc = { 'metrics.playCount': 1 };
        update.$set = { 'metrics.lastPlayedAt': now };
      }

      try {
        const result = await Channel.findByIdAndUpdate(databaseId, update);
        if (result) {
          results.updated++;
        } else {
          results.failed++;
        }
      } catch {
        results.failed++;
      }
    }

    healthSyncLimits.set(rateLimitKey, Date.now());

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Error processing health sync:', error);
    res.status(500).json({ success: false, error: 'Failed to process health sync' });
  }
});

// Get test status (must be BEFORE /:id to avoid route shadowing)
router.get('/test-status', requireAuth, async (req, res) => {
  try {
    res.json({ success: true, isLocked: false });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to check test status' });
  }
});

// Get channel by ID
router.get('/:id', requireTvOrSessionAuth, async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      const userChannelIds = (req.user.channels || []).map((id) => id.toString());
      if (!userChannelIds.includes(req.params.id)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
      }
    }

    const channel = await Channel.findById(req.params.id).select('-channelDrmKey').lean();
    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    res.json({ success: true, data: slimAlternates(channel) });
  } catch (error) {
    console.error('Error fetching channel:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch channel' });
  }
});

// Create new channel (admin only, field whitelist)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      channelId,
      channelName,
      channelUrl,
      channelImg,
      tvgLogo,
      tvgName,
      tvgId,
      channelGroup,
      channelDrmKey,
      order,
      isActive,
      metadata,
      alternateStreams,
    } = req.body;

    if (channelId) {
      const existing = await Channel.findOne({ channelId, ownerId: null });
      if (existing) {
        return res
          .status(400)
          .json({ success: false, error: 'Channel with this ID already exists' });
      }
    }

    const channel = new Channel({
      channelId,
      channelName,
      channelUrl,
      channelImg,
      tvgLogo,
      tvgName,
      tvgId,
      channelGroup,
      channelDrmKey,
      order,
      isActive,
      metadata,
      alternateStreams,
    });
    await channel.save();
    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'create_channel',
      resource: 'channel',
      resourceId: String(channel._id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ success: true, data: channel });
  } catch (error) {
    console.error('Error creating channel:', error);
    res.status(500).json({ success: false, error: 'Failed to create channel' });
  }
});

// Update channel (admin only, field whitelist)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      channelId,
      channelName,
      channelUrl,
      channelImg,
      tvgLogo,
      tvgName,
      tvgId,
      channelGroup,
      channelDrmKey,
      order,
      isActive,
      metadata,
      alternateStreams,
      flaggedBad,
    } = req.body;

    const allowedUpdates = {};
    if (channelId !== undefined) allowedUpdates.channelId = channelId;
    if (channelName !== undefined) allowedUpdates.channelName = channelName;
    if (channelUrl !== undefined) allowedUpdates.channelUrl = channelUrl;
    if (channelImg !== undefined) allowedUpdates.channelImg = channelImg;
    if (tvgLogo !== undefined) allowedUpdates.tvgLogo = tvgLogo;
    if (tvgName !== undefined) allowedUpdates.tvgName = tvgName;
    if (tvgId !== undefined) allowedUpdates.tvgId = tvgId;
    if (channelGroup !== undefined) allowedUpdates.channelGroup = channelGroup;
    if (channelDrmKey !== undefined) allowedUpdates.channelDrmKey = channelDrmKey;
    if (order !== undefined) allowedUpdates.order = order;
    if (isActive !== undefined) allowedUpdates.isActive = isActive;
    if (metadata !== undefined) allowedUpdates.metadata = metadata;
    if (alternateStreams !== undefined) allowedUpdates.alternateStreams = alternateStreams;
    if (flaggedBad !== undefined) allowedUpdates.flaggedBad = flaggedBad;

    // Scope to the shared catalog so an admin can't mutate a user's private channel
    const channel = await Channel.findOneAndUpdate(
      { _id: req.params.id, ownerId: null },
      { $set: allowedUpdates },
      { new: true, runValidators: true },
    );

    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'update_channel',
      resource: 'channel',
      resourceId: String(channel._id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ success: true, data: channel });
  } catch (error) {
    console.error('Error updating channel:', error);
    res.status(500).json({ success: false, error: 'Failed to update channel' });
  }
});

// Delete channel (admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const channel = await Channel.findOneAndDelete({ _id: req.params.id, ownerId: null });
    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    // Remove the deleted channel id from every user's channels array to avoid orphan refs
    await User.updateMany({ channels: req.params.id }, { $pull: { channels: req.params.id } });
    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'delete_channel',
      resource: 'channel',
      resourceId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ success: true, message: 'Channel deleted successfully' });
  } catch (error) {
    console.error('Error deleting channel:', error);
    res.status(500).json({ success: false, error: 'Failed to delete channel' });
  }
});

// Get channel with filtered fallback streams (for Android app)
router.get('/:id/with-fallbacks', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      const userChannelIds = (req.user.channels || []).map((id) => id.toString());
      if (!userChannelIds.includes(req.params.id)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
      }
    }

    const channel = await Channel.findById(req.params.id).select('-channelDrmKey').lean();
    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    // Filter alternates: only alive + non-flagged, sorted by ranking
    const viableAlternates = (channel.alternateStreams || [])
      .filter((alt) => alt.liveness?.status !== 'dead' && alt.flaggedBad?.isFlagged !== true)
      .sort((a, b) => {
        const scoreA = getStreamScore(a);
        const scoreB = getStreamScore(b);
        return scoreB - scoreA;
      });

    channel.alternateStreams = viableAlternates;
    res.json({ success: true, data: slimAlternates(channel) });
  } catch (error) {
    console.error('Error fetching channel with fallbacks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch channel' });
  }
});

// Flag primary stream as bad (any authenticated user, rate-limited: 1 per channel per user per minute)
router.post('/:id/flag', requireAuth, async (req, res) => {
  try {
    const flagKey = `${req.user.id}:${req.params.id}:primary`;
    if (flagLimits.has(flagKey)) {
      return res.status(429).json({ success: false, error: 'Please wait before flagging again' });
    }

    const { reason } = req.body;
    const validReasons = ['looping', 'frozen', 'wrong-content', 'other'];
    if (!reason || !validReasons.includes(reason)) {
      return res
        .status(400)
        .json({ success: false, error: `Reason must be one of: ${validReasons.join(', ')}` });
    }

    const channel = await Channel.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          'flaggedBad.isFlagged': true,
          'flaggedBad.reason': reason,
          'flaggedBad.flaggedBy': req.user.id,
          'flaggedBad.flaggedAt': new Date(),
        },
      },
      { new: true },
    );

    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    // flaggedBad is part of the cached catalog payload — bust it so clients see the flag.
    await invalidateCatalogCache();
    flagLimits.set(flagKey, Date.now());

    audit({
      userId: req.user.id,
      action: 'flag_channel',
      resource: 'channel',
      resourceId: req.params.id,
      details: { reason },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, message: 'Stream flagged as bad' });
  } catch (error) {
    console.error('Error flagging channel:', error);
    res.status(500).json({ success: false, error: 'Failed to flag channel' });
  }
});

// Unflag primary stream (admin only)
router.post('/:id/unflag', requireAuth, requireAdmin, async (req, res) => {
  try {
    const channel = await Channel.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          'flaggedBad.isFlagged': false,
          'flaggedBad.reason': null,
          'flaggedBad.flaggedBy': null,
          'flaggedBad.flaggedAt': null,
        },
      },
      { new: true },
    );

    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'unflag_channel',
      resource: 'channel',
      resourceId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, message: 'Stream flag cleared' });
  } catch (error) {
    console.error('Error unflagging channel:', error);
    res.status(500).json({ success: false, error: 'Failed to unflag channel' });
  }
});

// Flag an alternate stream as bad (any authenticated user, rate-limited)
router.post('/:id/alternates/:index/flag', requireAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const index = parseInt(req.params.index, 10);
    const flagKey = `${req.user.id}:${req.params.id}:alt${index}`;
    if (flagLimits.has(flagKey)) {
      return res.status(429).json({ success: false, error: 'Please wait before flagging again' });
    }

    const validReasons = ['looping', 'frozen', 'wrong-content', 'other'];

    if (!reason || !validReasons.includes(reason)) {
      return res
        .status(400)
        .json({ success: false, error: `Reason must be one of: ${validReasons.join(', ')}` });
    }

    const channel = await Channel.findById(req.params.id);
    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    if (!channel.alternateStreams || index < 0 || index >= channel.alternateStreams.length) {
      return res.status(400).json({ success: false, error: 'Invalid alternate stream index' });
    }

    channel.alternateStreams[index].flaggedBad = {
      isFlagged: true,
      reason,
      flaggedBy: req.user.id,
      flaggedAt: new Date(),
    };
    await channel.save();

    await invalidateCatalogCache();
    flagLimits.set(flagKey, Date.now());

    audit({
      userId: req.user.id,
      action: 'flag_alternate_stream',
      resource: 'channel',
      resourceId: req.params.id,
      details: { index, reason },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, message: 'Alternate stream flagged as bad' });
  } catch (error) {
    console.error('Error flagging alternate stream:', error);
    res.status(500).json({ success: false, error: 'Failed to flag alternate stream' });
  }
});

// Unflag an alternate stream (admin only)
router.post('/:id/alternates/:index/unflag', requireAuth, requireAdmin, async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);

    const channel = await Channel.findById(req.params.id);
    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    if (!channel.alternateStreams || index < 0 || index >= channel.alternateStreams.length) {
      return res.status(400).json({ success: false, error: 'Invalid alternate stream index' });
    }

    channel.alternateStreams[index].flaggedBad = {
      isFlagged: false,
      reason: null,
      flaggedBy: null,
      flaggedAt: null,
    };
    await channel.save();

    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'unflag_alternate_stream',
      resource: 'channel',
      resourceId: req.params.id,
      details: { index },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, message: 'Alternate stream flag cleared' });
  } catch (error) {
    console.error('Error unflagging alternate stream:', error);
    res.status(500).json({ success: false, error: 'Failed to unflag alternate stream' });
  }
});

// Test channel stream (session auth only, with SSRF protection)
router.post('/:id/test', requireAuth, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const ssrfCheck = await validateUrlForSSRF(channel.channelUrl);
    if (!ssrfCheck.safe) {
      return res
        .status(403)
        .json({ success: false, error: 'Stream URL blocked by security policy' });
    }

    const http = require('http');
    const https = require('https');
    const pinnedLookup = createPinnedLookup(ssrfCheck.resolvedAddresses);
    const httpAgent = new http.Agent({ lookup: pinnedLookup });
    const httpsAgent = new https.Agent({ lookup: pinnedLookup });

    const axios = require('axios');
    let isWorking = false;
    let error = null;

    try {
      const response = await axios.get(channel.channelUrl, {
        timeout: 20000,
        maxRedirects: 5,
        responseType: 'stream',
        validateStatus: (status) => status < 500,
        httpAgent,
        httpsAgent,
        headers: {
          'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
          Accept: '*/*',
          'Accept-Encoding': 'gzip, deflate',
          Connection: 'keep-alive',
        },
        beforeRedirect: (options) => {
          const hostname = (options.hostname || '').replace(/^\[|\]$/g, '');
          if (
            isPrivateIP(hostname) ||
            ['localhost', 'metadata.google.internal'].includes(hostname.toLowerCase())
          ) {
            throw new Error('Redirect to private/internal address blocked');
          }
        },
      });
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
      isWorking = response.status >= 200 && response.status < 400;
    } catch (err) {
      error = err.message;
      isWorking = false;
    }

    const now = new Date();
    const metadataUpdate = {
      'metadata.isWorking': isWorking,
      'metadata.lastTested': now,
    };
    if (error) {
      metadataUpdate['metadata.testError'] = error;
    }

    // Atomic update: metadata fields + metrics counters
    const metricsInc = isWorking ? { 'metrics.aliveCount': 1 } : { 'metrics.deadCount': 1 };
    const metricsSet = isWorking ? { 'metrics.lastAliveAt': now } : { 'metrics.lastDeadAt': now };

    const updateOp = {
      $set: { ...metadataUpdate, ...metricsSet },
      $inc: metricsInc,
    };
    if (!error) {
      updateOp.$unset = { 'metadata.testError': '' };
    }

    await Channel.findByIdAndUpdate(req.params.id, updateOp);
    audit({
      userId: req.user.id,
      action: 'test_channel',
      resource: 'channel',
      resourceId: String(channel._id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      data: {
        channelId: channel._id,
        channelName: channel.channelName,
        isWorking,
        testedAt: now,
        error: error || undefined,
      },
    });
  } catch (error) {
    console.error('Error testing channel:', error);
    res.status(500).json({ success: false, error: 'Failed to test channel' });
  }
});

// ─── Helpers ──────────────────────────────────────────────

function getStreamScore(stream) {
  const livenessScores = { alive: 20000, unknown: 10000, dead: 0 };
  const qualityScores = { '1080p': 400, '720p': 300, '480p': 200 };

  const liveness = livenessScores[stream.liveness?.status] ?? 10000;
  const quality = qualityScores[stream.quality] ?? 100;
  const speed = Math.max(0, 100 - (stream.liveness?.responseTimeMs || 5000) / 100);

  return liveness + quality + speed;
}

// ============ STREAM METRICS REPORTING ============

// Report stream status (dead/alive/unresponsive) — TV or session auth
// Rate limit: 1 per channel per device per 5 minutes
router.post('/:id/report-status', requireTvOrSessionAuth, async (req, res) => {
  try {
    const { status, deviceId } = req.body;

    if (!status || !['dead', 'alive', 'unresponsive'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'status must be one of: dead, alive, unresponsive',
      });
    }
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'deviceId is required',
      });
    }

    // Rate limiting
    const rateLimitKey = `${req.params.id}:${deviceId}`;
    const lastReport = reportStatusLimits.get(rateLimitKey);
    if (lastReport && Date.now() - lastReport < 5 * 60 * 1000) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. One report per channel per device per 5 minutes.',
      });
    }

    const update = {};
    const now = new Date();

    if (status === 'dead') {
      update.$inc = { 'metrics.deadCount': 1 };
      update.$set = { 'metrics.lastDeadAt': now };
    } else if (status === 'alive') {
      update.$inc = { 'metrics.aliveCount': 1 };
      update.$set = { 'metrics.lastAliveAt': now };
    } else if (status === 'unresponsive') {
      update.$inc = { 'metrics.unresponsiveCount': 1 };
      update.$set = { 'metrics.lastUnresponsiveAt': now };
    }

    const channel = await Channel.findOneAndUpdate(channelRouteQuery(req.params.id), update, { new: true });
    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    reportStatusLimits.set(rateLimitKey, Date.now());

    res.json({
      success: true,
      data: { channelId: channel._id, status, metrics: channel.metrics },
    });
  } catch (error) {
    console.error('Error reporting channel status:', error);
    res.status(500).json({ success: false, error: 'Failed to report channel status' });
  }
});

// Anonymous QoE event — stores aggregate-friendly playback quality data only.
// No device ID, IP address, stream URL, user agent, or session identifier is persisted.
// Rate limit: at most 12 events per channel per authenticated principal/IP per minute.
router.post('/:id/report-playback-event', requireTvOrSessionAuth, async (req, res) => {
  try {
    const {
      eventType,
      startupMs,
      rebufferCount,
      fallbackUsed,
      fallbackSucceeded,
      errorCode,
      platform,
      appVersion,
    } = req.body || {};

    if (!['startup_success', 'startup_failure'].includes(eventType)) {
      return res.status(400).json({ success: false, error: 'eventType must be startup_success or startup_failure' });
    }
    if (startupMs !== undefined && startupMs !== null && (!Number.isFinite(Number(startupMs)) || Number(startupMs) < 0)) {
      return res.status(400).json({ success: false, error: 'startupMs must be a non-negative number' });
    }
    if (rebufferCount !== undefined && (!Number.isFinite(Number(rebufferCount)) || Number(rebufferCount) < 0)) {
      return res.status(400).json({ success: false, error: 'rebufferCount must be a non-negative number' });
    }
    if (fallbackUsed !== undefined && typeof fallbackUsed !== 'boolean') {
      return res.status(400).json({ success: false, error: 'fallbackUsed must be boolean' });
    }
    if (fallbackSucceeded !== undefined && fallbackSucceeded !== null && typeof fallbackSucceeded !== 'boolean') {
      return res.status(400).json({ success: false, error: 'fallbackSucceeded must be boolean or null' });
    }

    const channel = await Channel.findOne(channelRouteQuery(req.params.id)).select('_id').lean();
    if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });

    // The principal is used only as an in-memory throttle key and never reaches MongoDB.
    const principal = req.user?.id?.toString() || req.headers['x-session-id']?.toString() || req.ip || 'anonymous';
    const rateLimitKey = `qoe:${req.params.id}:${principal}`;
    const now = Date.now();
    const recent = (qoeReportLimits.get(rateLimitKey) || []).filter((timestamp) => now - timestamp <= 60 * 1000);
    if (recent.length >= 12) {
      return res.status(429).json({ success: false, error: 'Rate limit exceeded. Too many playback quality events.' });
    }

    await recordPlaybackEvent({
      channelId: String(channel._id),
      eventType,
      startupMs: startupMs === undefined || startupMs === null ? null : Math.min(Number(startupMs), 10 * 60 * 1000),
      rebufferCount: rebufferCount === undefined ? 0 : Math.min(Math.floor(Number(rebufferCount)), 1000),
      fallbackUsed: fallbackUsed === true,
      fallbackSucceeded: fallbackUsed === true ? fallbackSucceeded ?? eventType === 'startup_success' : null,
      errorCode,
      platform,
      appVersion,
    });
    qoeReportLimits.set(rateLimitKey, [...recent, now]);

    return res.status(202).json({ success: true, data: { accepted: true } });
  } catch (error) {
    console.error('Error recording playback quality event:', error);
    return res.status(500).json({ success: false, error: 'Failed to record playback quality event' });
  }
});

// Report successful playback — TV or session auth
// Rate limit: 1 per channel per device per 1 minute
router.post('/:id/report-play', requireTvOrSessionAuth, async (req, res) => {
  try {
    const { deviceId, proxyPlay } = req.body;

    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'deviceId is required',
      });
    }

    // Rate limiting
    const rateLimitKey = `${req.params.id}:${deviceId}`;
    const lastReport = reportPlayLimits.get(rateLimitKey);
    if (lastReport && Date.now() - lastReport < 60 * 1000) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. One play report per channel per device per minute.',
      });
    }

    const updateInc = { 'metrics.playCount': 1 };
    if (proxyPlay) {
      updateInc['metrics.proxyPlayCount'] = 1;
    }

    const channel = await Channel.findOneAndUpdate(
      channelRouteQuery(req.params.id),
      {
        $inc: updateInc,
        $set: { 'metrics.lastPlayedAt': new Date() },
      },
      { new: true },
    );

    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    // Note: auto-promotion from report-play was removed to avoid race conditions
    // with the stream-health-service scheduler and to prevent untrusted clients
    // from forcing promotions. The scheduler handles promotion based on health probes.

    reportPlayLimits.set(rateLimitKey, Date.now());

    res.json({
      success: true,
      data: { channelId: channel._id, metrics: channel.metrics },
    });
  } catch (error) {
    console.error('Error reporting channel play:', error);
    res.status(500).json({ success: false, error: 'Failed to report channel play' });
  }
});

module.exports = router;
