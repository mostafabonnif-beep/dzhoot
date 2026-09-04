const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const Channel = require('../models/Channel');
const XtreamSource = require('../models/XtreamSource');
const Movie = require('../models/Movie');
const Series = require('../models/Series');
const Episode = require('../models/Episode');
const EpgProgram = require('../models/EpgProgram');
const PairingRequest = require('../models/PairingRequest');
const { isValidObjectId } = require('./catalog-helpers');
const { epgService } = require('../services/epg-service');
const { audit } = require('../services/audit-log');
const { issuePlaybackToken, verifyPlaybackToken, altStreamHash } = require('../services/playback-token');
const { proxyUpstreamStream, resolveSegmentUrlBySequence } = require('../services/upstream-proxy');
const fs = require('fs');
const path = require('path');
const hlsRemux = require('../services/hls-remux-service');
const {
  isCatchupSupported,
  buildCatchupUrlForChannel,
} = require('../services/catchup-service');
const { registerStreamSession, isStreamSessionActive } = require('../services/stream-session-service');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');
const { epgCache } = require('../services/cache');
const { decryptSecret } = require('../utils/crypto');
const { getPublicBaseUrl } = require('../utils/public-url');
const { checkPlaybackSubscription } = require('../services/playback-access-service');
const {
  hasRestrictedPresentationMarker,
  publicCatalogPresentationQuery,
  publicCatalogHideQuery,
  publicCatalogDedupQuery,
  presentChannelForClient,
  sortClientCatalogChannels,
} = require('../utils/catalog-presentation');
const { isSourceDown, getFailoverTarget } = require('../services/source-failover-service');
const { rewriteStreamUrlBase } = require('../services/xtream-service');
const { proxyLogoUrl } = require('../utils/logo-proxy');

// Curated groups exposed to demo users — mirrors channels.js so the demo
// browsing endpoint and the playback-token endpoint agree on the same subset.
const DEMO_CHANNEL_GROUPS = (process.env.DEMO_CHANNEL_GROUPS || 'AR| ALGERIA الجزائر')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);

// GET /logo?url=… — relay channel logos through OUR server so customers and
// resellers never see the upstream providers' image hosts. SSRF-guarded and
// cached (the catalog shares logo URLs across channels, so the cache hits a lot).
const LOGO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const logoCache = new Map();
router.get('/logo', async (req, res) => {
  try {
    const raw = String(req.query.url || '').trim();
    if (!raw || !/^https?:\/\//i.test(raw)) {
      return res.status(400).json({ success: false, error: 'url must be an http(s) URL' });
    }
    const cacheKey = raw;
    const cached = logoCache.get(cacheKey);
    if (cached && Date.now() - cached.at < LOGO_CACHE_TTL_MS) {
      res.setHeader('Content-Type', cached.type);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(cached.body);
    }

    // SSRF guard: logos must not be a gateway to internal network fetches.
    const { validateUrlForSSRF } = require('../utils/ssrf-guard');
    const ssrf = await validateUrlForSSRF(raw);
    if (!ssrf.safe) {
      return res.status(400).json({ success: false, error: `Logo URL blocked: ${ssrf.reason}` });
    }
    const axios = require('axios');
    const upstream = await axios.get(raw, {
      timeout: 6000,
      maxRedirects: 3,
      responseType: 'arraybuffer',
      maxContentLength: 300 * 1024,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: { 'User-Agent': 'Mozilla/5.0 DZ-HOOF', Accept: 'image/*' },
    });
    const contentType = String(upstream.headers['content-type'] || 'image/png').split(';')[0].trim();
    if (!/^image\//.test(contentType)) {
      return res.status(502).json({ success: false, error: 'Upstream did not return an image' });
    }
    const body = Buffer.from(upstream.data);
    logoCache.set(cacheKey, { at: Date.now(), body, type: contentType });
    // Keep the cache bounded.
    if (logoCache.size > 5000) {
      const oldest = logoCache.keys().next().value;
      if (oldest) logoCache.delete(oldest);
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(body);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ success: false, error: 'Logo fetch failed' });
  }
});

async function getVerifiedXtreamSourceIds() {
  // Sources that passed live playback verification (and are Active), OR that the
  // operator explicitly marked customer-visible (catalog-only import decision —
  // visible even while Inactive, since such sources cannot pass verification),
  // OR that opted into direct playback (clients fetch from their own network).
  return new Set((await XtreamSource.find({
    $or: [
      { status: 'Active', verificationStatus: 'verified' },
      { customerVisible: true },
      { directPlayback: true },
    ],
  }).distinct('_id')).map((id) => String(id)));
}

async function getDirectPlaybackSourceIds() {
  return new Set((await XtreamSource.find({ directPlayback: true }).distinct('_id')).map((id) => String(id)));
}

function isCustomerVisibleChannel(channel, verifiedSourceIds, directPlaybackSourceIds) {
  const isDirectSource = directPlaybackSourceIds.has(String(channel.metadata?.xtreamSourceId || ''));
  if (hasRestrictedPresentationMarker(channel)) return false;
  // A known-dead stream must never be offered to a customer, regardless of
  // whether it came from IPTV-org, Xtream, or another managed source.
  // Direct-playback sources are exempt: their isWorking flag reflects the
  // server's datacenter IP, not the customer's network.
  if (channel.isActive === false || channel.flaggedBad?.isFlagged === true) return false;
  if (channel.metadata?.isWorking === false && !isDirectSource) return false;
  if (channel.metadata?.source !== 'xtream') return true;
  return verifiedSourceIds.has(String(channel.metadata?.xtreamSourceId || ''));
}

function inferPlaybackMimeType(streamUrl) {
  // Shared implementation lives in utils/playback-mime (also used by
  // routes/streams.js) — kept as a local alias so existing call sites and
  // tests stay untouched.
  return require('../utils/playback-mime').inferPlaybackMimeType(streamUrl);
}

/** True when the tokenized URL serves an HLS playlist (vs progressive bytes). */
function isHlsPlayback(streamUrl) {
  return inferPlaybackMimeType(streamUrl) === 'application/x-mpegurl';
}

/** Token URL with a container hint suffix only when the payload is HLS. */
function playbackTokenUrl(baseUrl, token, streamUrl) {
  const suffix = isHlsPlayback(streamUrl) ? '.m3u8' : '';
  return `${baseUrl}/api/v1/tv/playback/${token}${suffix}`;
}

// ── v2 channel-reference token resolution ─────────────────────────────────
// v2 tokens carry `channelId` (+ optional alternate fingerprint) instead of
// the upstream URL, so the ~16k-channel sync payload stays small enough for
// low-end TV sticks. Resolve the CURRENT stream URL from the Channel document
// at play time. Cache briefly: segment requests resolve per segment and a
// 60s window is far beyond the live-window rotation granularity.

const resolvedTargetCache = new Map(); // nonce -> { at, value }

function cachedResolvedTarget(nonce) {
  const hit = resolvedTargetCache.get(nonce);
  if (hit && hit.at > Date.now() - 60_000) return hit.value;
  resolvedTargetCache.delete(nonce);
  return undefined;
}

async function resolvePlaybackTarget(payload) {
  if (payload.v !== 2) {
    // v1: the URL (and headers) were embedded at issue time.
    return { streamUrl: payload.streamUrl, upstreamHeaders: payload.upstreamHeaders };
  }
  const cached = cachedResolvedTarget(payload.nonce);
  if (cached) return cached;

  const Channel = require('../models/Channel');
  const channel = await Channel.findOne({ channelId: payload.channelId, ownerId: null })
    .select('channelUrl activeUserAgent activeReferrer alternateStreams')
    .lean();
  if (!channel || !channel.channelUrl) return null;

  let streamUrl = channel.channelUrl;
  let upstreamHeaders = {
    ...(channel.activeUserAgent ? { userAgent: channel.activeUserAgent } : {}),
    ...(channel.activeReferrer ? { referrer: channel.activeReferrer } : {}),
  };
  if (payload.altUrlHash) {
    const alternate = (channel.alternateStreams || []).find(
      (a) => a.streamUrl && altStreamHash(a.streamUrl) === payload.altUrlHash,
    );
    if (!alternate || !alternate.streamUrl) return null;
    streamUrl = alternate.streamUrl;
    upstreamHeaders = {
      ...(alternate.userAgent ? { userAgent: alternate.userAgent } : {}),
      ...(alternate.referrer ? { referrer: alternate.referrer } : {}),
    };
  }

  const value = { streamUrl, upstreamHeaders };
  // Same-panel mirror fallback for v2 channel-reference tokens: resolve the
  // source once and rewrite the primary domain to the mirror when it is down.
  if (channel.metadata?.source === 'xtream' && channel.metadata?.xtreamSourceId) {
    const src = await XtreamSource.findById(channel.metadata.xtreamSourceId)
      .select('serverUrl mirrorServerUrls')
      .lean();
    if (src && Array.isArray(src.mirrorServerUrls) && src.mirrorServerUrls.length) {
      const primaryBase = String(src.serverUrl || '').replace(/\/+$/, '');
      const mirrorBase = String(src.mirrorServerUrls[0]).replace(/\/+$/, '');
      if (mirrorBase && primaryBase && streamUrl.startsWith(primaryBase) && (await isSourceDown(String(src._id)))) {
        const rewritten = rewriteStreamUrlBase(streamUrl, mirrorBase);
        if (rewritten) streamUrl = rewritten;
      }
    }
  }
  if (resolvedTargetCache.size > 4000) resolvedTargetCache.clear();
  resolvedTargetCache.set(payload.nonce, { at: Date.now(), value });
  return value;
}

/**
 * Same-panel mirror fallback for VOD streams (movies / series episodes).
 * Rewrites the stream URL to the source's mirror domain when the primary
 * domain is down AND the URL is under the primary base. No-op otherwise.
 */
async function applyVodMirrorFallback(streamUrl, sourceId) {
  if (!streamUrl || !sourceId) return streamUrl;
  try {
    const source = await XtreamSource.findById(sourceId)
      .select('serverUrl mirrorServerUrls')
      .lean();
    if (!source || !Array.isArray(source.mirrorServerUrls) || !source.mirrorServerUrls.length) return streamUrl;
    const primaryBase = String(source.serverUrl || '').replace(/\/+$/, '');
    const mirrorBase = String(source.mirrorServerUrls[0]).replace(/\/+$/, '');
    if (!primaryBase || !mirrorBase || !streamUrl.startsWith(primaryBase)) return streamUrl;
    if (!(await isSourceDown(String(source._id)))) return streamUrl;
    return rewriteStreamUrlBase(streamUrl, mirrorBase) || streamUrl;
  } catch {
    // Never break playback because of a mirror lookup — return the original.
    return streamUrl;
  }
}

async function ensurePlaybackSubscription(user, res) {
  const access = await checkPlaybackSubscription(String(user?._id || user?.id || ''), user?.role, 'Live');
  if (access.allowed) return true;
  res.status(403).json({
    success: false,
    error: 'Your subscription has expired. Activate a new code to continue watching.',
    code: 'SUBSCRIPTION_EXPIRED',
  });
  return false;
}

// Same cap as the /channels sync — the EPG only needs to cover what the TV can list.
const TV_CHANNELS_MAX = Number(process.env.TV_CHANNELS_MAX) || 20000;

async function tokenizeChannelForClient(channel, user, baseUrl) {
  const source = channel.toObject ? channel.toObject() : channel;
  const safe = { ...source, channelUrl: '' };
  // Never expose the raw catchup-source template (may embed credentials) —
  // only the capability flags.
  const stored = source.catchup;
  const legacyXtream =
    source.metadata?.source === 'xtream' &&
    source.metadata?.xtreamStreamId !== undefined &&
    source.metadata?.xtreamStreamId !== null;
  safe.catchup = stored?.type
    ? { type: stored.type, days: stored.days || null }
    : legacyXtream
      ? { type: 'timeshift', days: null }
      : null;
  // Channel logos live on the upstream providers' image servers — never expose
  // those hosts to customers/resellers. Relay them through our logo proxy.
  if (safe.tvgLogo) safe.tvgLogo = proxyLogoUrl(baseUrl, safe.tvgLogo);
  if (safe.channelImg) safe.channelImg = proxyLogoUrl(baseUrl, safe.channelImg);
  if (!user.channelListCode) return presentChannelForClient(safe);
  // Skip channels whose URL scheme the playback layer can't proxy (e.g. rtmp://,
  // udp://) instead of letting one bad channel break the whole customer playlist.
  if (source.channelUrl && !/^https?:\/\//i.test(String(source.channelUrl))) return presentChannelForClient(safe);
  if (source.channelUrl) {
    const channelId = String(source.channelId || '').trim();
    // v2 channel-reference token (slim — the list payload matters on TV sticks).
    // Fall back to v1 (embedded URL) only when the catalog channelId is absent.
    const { token } = issuePlaybackToken(
      channelId
        ? {
            userId: String(user._id),
            channelListCode: user.channelListCode,
            channelRef: { channelId, hls: isHlsPlayback(source.channelUrl) },
          }
        : {
            userId: String(user._id),
            channelListCode: user.channelListCode,
            streamUrl: source.channelUrl,
            upstreamHeaders: {
              userAgent: source.activeUserAgent || undefined,
              referrer: source.activeReferrer || undefined,
            },
          },
    );
    safe.channelUrl = playbackTokenUrl(baseUrl, token, source.channelUrl);
  }
  safe.alternateStreams = await Promise.all(
    (source.alternateStreams || [])
      .filter((alternate) => alternate.liveness?.status !== 'dead' && alternate.flaggedBad?.isFlagged !== true)
      .slice(0, 10)
      .map(async (alternate) => {
        if (!alternate.streamUrl) return { ...alternate, streamUrl: '' };
        const channelId = String(source.channelId || '').trim();
        const { token } = issuePlaybackToken(
          channelId
            ? {
                userId: String(user._id),
                channelListCode: user.channelListCode,
                channelRef: {
                  channelId,
                  altUrlHash: altStreamHash(alternate.streamUrl),
                  hls: isHlsPlayback(alternate.streamUrl),
                },
              }
            : {
                userId: String(user._id),
                channelListCode: user.channelListCode,
                streamUrl: alternate.streamUrl,
                upstreamHeaders: {
                  userAgent: alternate.userAgent || undefined,
                  referrer: alternate.referrer || undefined,
                },
              },
        );
        return { ...alternate, streamUrl: playbackTokenUrl(baseUrl, token, alternate.streamUrl) };
      }),
  );
  return presentChannelForClient(safe);
}

// NO authentication required for TV endpoints

// Load the channels relevant to a user's EPG, projected to only the fields the guide
// needs, and pre-intersect candidate EPG ids against the ids that actually have guide
// data (~1.7k) — otherwise the $in carries 3 ids per channel (~100k+) for nothing.
async function loadEpgChannelIds(user) {
  const catalogView = user.role === 'Admin' || user.allCatalog === true;
  const verifiedSourceIds = await getVerifiedXtreamSourceIds();
  const baseQuery = catalogView ? { ownerId: null } : { _id: { $in: user.channels } };
  const query = {
    $and: [
      baseQuery,
      publicCatalogPresentationQuery(),
      publicCatalogHideQuery(),
      ...(user.role !== 'Admin' ? [await publicCatalogDedupQuery()] : []),
      {
        $nor: [
          {
            'metadata.source': 'xtream',
            'metadata.xtreamSourceId': { $nin: [...verifiedSourceIds] },
          },
        ],
      },
    ],
  };
  const channels = await Channel.find(query)
    .sort({ channelGroup: 1, order: 1 })
    .limit(TV_CHANNELS_MAX)
    .select('channelId tvgId tvgName channelName tvgLogo channelImg')
    .lean();

  let knownEpgIds = await epgCache.get('known-ids');
  if (!knownEpgIds) {
    knownEpgIds = await EpgProgram.distinct('channelEpgId');
    await epgCache.set('known-ids', knownEpgIds, 600);
  }
  // EPG channel ids in guides and provider-issued tvgIds disagree on casing
  // (beINSPORTS1.tr vs beINSports1.tr). Matching is case-insensitive everywhere
  // else (coverage query, app cache keys), so normalize here too: the known set
  // and the info map are keyed lowercased, while epgIds keep the original casing
  // and are matched case-insensitively by the program query (collation).
  const knownSet = new Set(knownEpgIds.map((id) => String(id).toLowerCase()));

  const epgIds = [];
  const channelInfoMap = new Map();
  for (const ch of channels) {
    const ids = [ch.channelId, ch.tvgId, ch.tvgName].filter(Boolean);
    for (const id of ids) {
      const key = String(id).toLowerCase();
      if (!channelInfoMap.has(key)) {
        channelInfoMap.set(key, {
          epgId: id,
          channelId: ch.channelId,
          name: ch.channelName,
          icon: ch.tvgLogo || ch.channelImg || '',
        });
        if (knownSet.has(key)) epgIds.push(id);
      }
    }
  }
  return { epgIds, channelInfoMap };
}

// Shared helper: validate code, find user, update lastLogin
async function findUserByCode(code, res) {
  if (!code || code.length !== 6 || !/^[A-Z0-9]{6}$/.test(code.toUpperCase())) {
    res.status(400).json({
      success: false,
      error: 'Invalid channel list code. Code must be 6 characters.',
    });
    return null;
  }
  const user = await User.findOne({
    channelListCode: code.toUpperCase(),
    isActive: true,
  });
  if (!user) {
    res.status(404).json({
      success: false,
      error: 'Invalid or inactive channel list code',
    });
    return null;
  }
  if (user.codeRevokedAt) {
    res.status(403).json({
      success: false,
      error: 'This channel list code has been revoked. Please regenerate your code.',
    });
    return null;
  }
  // Called on every request (incl. each HLS segment). Only touch lastLogin when
  // it's stale (>5 min) and use a lightweight atomic update, fire-and-forget so a
  // failed write never blocks streaming.
  const FIVE_MINUTES = 5 * 60 * 1000;
  if (!user.lastLogin || Date.now() - user.lastLogin.getTime() > FIVE_MINUTES) {
    User.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } }).catch((err) =>
      console.error('Failed to update lastLogin:', err.message),
    );
  }
  return user;
}

// Get playlist by code (TV App endpoint)
router.get('/playlist/:code', async (req, res) => {
  try {
    const user = await findUserByCode(req.params.code, res);
    if (!user) return;
    if (!(await ensurePlaybackSubscription(user, res))) return;

    // Generate M3U playlist for this user (with EPG URL)
    const baseUrl = getPublicBaseUrl(req);
    const m3uContent = await user.generateUserPlaylist(baseUrl);

    // Set response headers for M3U
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    const safeUsername = user.username.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeUsername}-playlist.m3u"`);
    res.send(m3uContent);
  } catch (error) {
    console.error('Error fetching playlist:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch playlist',
    });
  }
});

// Get playlist as JSON (alternative format for TV apps)
router.get('/playlist/:code/json', async (req, res) => {
  try {
    const user = await findUserByCode(req.params.code, res);
    if (!user) return;
    if (!(await ensurePlaybackSubscription(user, res))) return;

    const Channel = require('../models/Channel');
    let channels;

    if (user.role === 'Admin' || user.allCatalog === true) {
      // Admin/demo and trial users with allCatalog get the shared catalog only.
      channels = await Channel.find({ ownerId: null }).sort({ channelGroup: 1, order: 1 });
    } else {
      // Regular users get only their assigned active channels
      const channelIds = (user.channels || []).filter(Boolean);
      channels = await Channel.find({
        _id: { $in: channelIds },
        isActive: { $ne: false },
      }).sort({ channelGroup: 1, order: 1 });
    }

    const verifiedSourceIds = await getVerifiedXtreamSourceIds();
    const directSourceIds = await getDirectPlaybackSourceIds();
    const visibleChannels = channels.filter((channel) => isCustomerVisibleChannel(channel, verifiedSourceIds, directSourceIds));
    const baseUrl = getPublicBaseUrl(req);
    const tokenizedChannels = await Promise.all(
      sortClientCatalogChannels(visibleChannels)
        .map((channel) => tokenizeChannelForClient(channel, user, baseUrl)),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.json({
      success: true,
      user: {
        username: user.username,
      },
      count: tokenizedChannels.length,
      channels: tokenizedChannels,
    });
  } catch (error) {
    console.error('Error fetching playlist JSON:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch playlist',
    });
  }
});

// Issue a short-lived encrypted playback token for a catalog channel.
// The client sends only its channel reference and never submits an upstream URL.
router.post('/playback-token', requireTvOrSessionAuth, async (req, res) => {
  try {
    const channelRef = String(req.body?.channelId || '').trim();
    const movieId = String(req.body?.movieId || '').trim();
    const episodeId = String(req.body?.episodeId || '').trim();
    const slot = Number(req.body?.slot ?? 0);
    const catchupStartMs = Number(req.body?.catchupStartMs ?? 0);
    const catchupDurationMin = Math.min(Math.max(Number(req.body?.catchupDurationMin ?? 0), 1), 24 * 60);
    if (!Number.isFinite(catchupStartMs) || catchupStartMs < 0 || !Number.isFinite(catchupDurationMin)) {
      return res.status(400).json({ success: false, error: 'Invalid catch-up parameters' });
    }

    const hasChannelRef = Boolean(channelRef);
    const hasVodRef = Boolean(movieId || episodeId);
    if ((hasChannelRef && hasVodRef) || (!hasChannelRef && !hasVodRef)) {
      return res.status(400).json({
        success: false,
        error: 'Provide exactly one of channelId, movieId or episodeId',
      });
    }
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) {
      return res.status(400).json({ success: false, error: 'channelId and a valid slot are required' });
    }
    if (hasChannelRef && channelRef.length > 200) {
      return res.status(400).json({ success: false, error: 'channelId is too long' });
    }

    const user = req.user;
    // Demo is a curated LIVE-only preview (mirrors streams.js). Demo users have
    // no subscription and no assigned channels, so they need explicit carve-outs
    // in the subscription gate and the channel-access check below.
    const isDemo = user?.demo === true;
    const { isSubscriptionRequired, getActiveSubscription } = require('../services/subscription-service');
    if (!isDemo && await isSubscriptionRequired() && user.role !== 'Admin' && !(await getActiveSubscription(user.id))) {
      return res.status(403).json({
        success: false,
        error: 'Your subscription has expired. Activate a new code to continue watching.',
        code: 'SUBSCRIPTION_EXPIRED',
      });
    }

    // ── VOD (movie or series episode) — same encrypted-token + proxy pipeline ──
    if (hasVodRef) {
      // Demo is a curated LIVE-only preview. Movies/episodes are paid content —
      // never authorize them for the public demo code (same policy as streams.js).
      if (isDemo) {
        return res.status(404).json({ success: false, error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
      }
      let vodDoc = null;
      let vodKind = 'movie';
      if (movieId) {
        if (!isValidObjectId(movieId)) {
          return res.status(400).json({ success: false, error: 'Invalid movie id' });
        }
        vodDoc = await Movie.findOne({ _id: movieId, isActive: true }).lean();
        vodKind = 'movie';
      } else {
        if (!isValidObjectId(episodeId)) {
          return res.status(400).json({ success: false, error: 'Invalid episode id' });
        }
        vodDoc = await Episode.findOne({ _id: episodeId, isActive: { $ne: false } }).lean();
        vodKind = 'episode';
      }
      if (!vodDoc) {
        return res.status(404).json({ success: false, error: 'Content not found' });
      }
      // An episode stays playable only while its parent series is active —
      // { isActive: { $ne: false } } keeps legacy docs (no field) playable.
      if (vodKind === 'episode' && vodDoc.seriesId) {
        const parentSeries = await Series.findOne(
          { _id: vodDoc.seriesId, isActive: { $ne: false } },
        ).select('_id').lean();
        if (!parentSeries) {
          return res.status(404).json({ success: false, error: 'Content not found' });
        }
      }
      if (!vodDoc.streamUrl) {
        return res.status(404).json({ success: false, error: 'Content has no playable stream' });
      }

      // Same-panel MIRROR fallback for VOD: movies carry sourceId directly,
      // episodes resolve it through their parent series. When the primary
      // panel domain is down, the same movie/episode stream URL is rewritten
      // to the mirror domain (same account, same stream id).
      let vodSourceId = null;
      if (vodKind === 'movie') {
        vodSourceId = vodDoc.sourceId || null;
      } else if (vodDoc.seriesId) {
        const parentSeries = await Series.findById(vodDoc.seriesId).select('sourceId').lean();
        vodSourceId = parentSeries?.sourceId || null;
      }
      if (vodSourceId) {
        vodDoc.streamUrl = await applyVodMirrorFallback(vodDoc.streamUrl, vodSourceId);
      }

      const rootSessionId = crypto.randomBytes(16).toString('hex');
      const { token, expiresAt } = issuePlaybackToken({
        userId: String(user.id),
        channelListCode: String(user.channelListCode || ''),
        streamUrl: vodDoc.streamUrl,
        upstreamHeaders: {},
        sessionId: rootSessionId,
      });
      const session = await registerStreamSession({
        userId: String(user.id),
        sessionId: rootSessionId,
        ttlSec: Math.max(0, (expiresAt - Date.now()) / 1000),
        metadata: {
          username: user.username,
          channelListCode: user.channelListCode,
          contentType: vodKind,
          contentName: vodDoc.title || '',
          platform: String(req.headers['x-platform'] || req.headers['user-agent'] || '').slice(0, 40),
        },
      });
      return res.json({
        success: true,
        data: {
          playbackUrl: playbackTokenUrl(getPublicBaseUrl(req), token, vodDoc.streamUrl),
          mimeType: inferPlaybackMimeType(vodDoc.streamUrl),
          expiresAt,
          slot: 0,
          type: vodKind,
          streamLimit: { max: session.max, active: session.active },
        },
      });
    }

    // Demo access is a curated subset of the catalog — restrict the lookup to
    // the same groups the browsing endpoint exposes (channels.js DEMO_CHANNEL_GROUPS).
    const channelQuery = { channelId: channelRef, isActive: { $ne: false } };
    if (isDemo) channelQuery.channelGroup = { $in: DEMO_CHANNEL_GROUPS };
    let channel = await Channel.findOne(channelQuery).lean();
    // Clients historically send the Mongo _id (e.g. older app builds) — resolve
    // it defensively so a stale client can't brick playback with a 404.
    if (!channel && isValidObjectId(channelRef)) {
      const demoIdQuery = { _id: channelRef, isActive: { $ne: false } };
      if (isDemo) demoIdQuery.channelGroup = { $in: DEMO_CHANNEL_GROUPS };
      channel = await Channel.findOne(demoIdQuery).lean();
    }
    if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });

    let xtreamDirectPlayback = false;
    let failoverTarget = null;
    // Same-panel mirror domain to fall back to when the PRIMARY domain is down
    // (set inside the xtream block below, applied to slot 0 afterwards).
    let mirrorTargetBase = null;
    let mirrorPrimaryBase = null;
    if (channel.metadata?.source === 'xtream' && channel.metadata?.xtreamSourceId) {
      const source = await XtreamSource.findById(channel.metadata.xtreamSourceId).lean();
      const sourceEligible = !!source && (
        (source.status === 'Active' && source.verificationStatus === 'verified') ||
        // Customer-visible sources are listed in the public catalog
        // (channels.js verifiedXtreamChannelQuery uses the same OR set), so
        // their channels must be playable — otherwise the catalog shows
        // channels that always fail with SOURCE_NOT_VERIFIED.
        source.customerVisible === true ||
        source.directPlayback === true
      );
      // Watchdog says the primary is down → look for a verified backup mapping
      // (catch-up NEVER fails over — the backup has no catch-up support).
      const sourceDown = source ? await isSourceDown(String(source._id)) : false;
      if (source && sourceDown && catchupStartMs === 0) {
        failoverTarget = await getFailoverTarget(channel, source._id);
        // No provider-level backup map? The same panel may still be reachable
        // via a configured MIRROR domain — remember it so slot 0 is rewritten.
        if (!failoverTarget && Array.isArray(source.mirrorServerUrls) && source.mirrorServerUrls.length) {
          mirrorTargetBase = String(source.mirrorServerUrls[0]).replace(/\/+$/, '');
          mirrorPrimaryBase = String(source.serverUrl || '').replace(/\/+$/, '');
        }
      }
      if (!sourceEligible && !failoverTarget && !mirrorTargetBase) {
        return res.status(404).json({ success: false, error: 'Channel source is not verified', code: 'SOURCE_NOT_VERIFIED' });
      }
      xtreamDirectPlayback = failoverTarget
        ? failoverTarget.source.directPlayback === true
        : (source && source.directPlayback === true);
    }

    const isCatalogUser = user.role === 'Admin' || user.allCatalog === true || isDemo;
    const assigned = (user.channels || []).some((id) => String(id) === String(channel._id));
    if (!isCatalogUser && !assigned) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const viableAlternates = (channel.alternateStreams || []).filter(
      (alternate) => alternate.liveness?.status !== 'dead' && alternate.flaggedBad?.isFlagged !== true,
    );
    let streamUrl = slot === 0 ? channel.channelUrl : viableAlternates[slot - 1]?.streamUrl;
    if (catchupStartMs > 0) {
      // Xtream channels resolve their timeshift URL from the panel credentials
      // (fetched only when this channel actually came from an Xtream source).
      const isXtreamChannel =
        channel.metadata?.source === 'xtream' &&
        channel.metadata?.xtreamSourceId &&
        channel.metadata?.xtreamStreamId !== undefined &&
        channel.metadata?.xtreamStreamId !== null;

      if (!isCatchupSupported(channel) && !isXtreamChannel) {
        return res.status(404).json({
          success: false,
          error: 'Catch-up is not available for this channel',
          code: 'CATCHUP_UNAVAILABLE',
        });
      }

      let xtreamCreds = null;
      if (isXtreamChannel) {
        const source = await XtreamSource.findOne({ _id: channel.metadata.xtreamSourceId, status: 'Active' }).lean();
        if (!source) {
          return res.status(404).json({
            success: false,
            error: 'Xtream source is unavailable',
            code: 'XTREAM_SOURCE_UNAVAILABLE',
          });
        }
        xtreamCreds = {
          serverUrl: source.serverUrl,
          username: decryptSecret(source.usernameEncrypted),
          password: decryptSecret(source.passwordEncrypted),
        };
      }

      const built = buildCatchupUrlForChannel(channel, {
        startMs: catchupStartMs,
        durationMin: catchupDurationMin,
        nowMs: Date.now(),
        xtreamCreds,
      });
      if (!built.ok) {
        const status = built.code === 'INVALID_CATCHUP_TIME' ? 400 : 404;
        return res.status(status).json({ success: false, error: built.error, code: built.code });
      }
      streamUrl = built.url;
    }
    // Primary source is down and a verified backup mapping exists: serve the
    // backup stream (primary slot only — an explicit alternate slot the user
    // picked stays as-is).
    // NOTE: keep the PRE-rewrite URL aside — the mirror rewrite only reflects
    // reachability FROM THE SERVER (the primary may be blocked for the VPS
    // datacenter IP but perfectly fine for residential viewers). The browser
    // direct-playback URL must use the original (usually https) provider URL.
    const preMirrorStreamUrl = streamUrl;
    if (failoverTarget && slot === 0) {
      streamUrl = failoverTarget.streamUrl;
    } else if (mirrorTargetBase && slot === 0 && streamUrl.startsWith(mirrorPrimaryBase)) {
      // No provider-level backup: rewrite the SAME stream to the mirror panel
      // domain (same account, same stream id) — automatic, zero app change.
      const rewritten = rewriteStreamUrlBase(streamUrl, mirrorTargetBase);
      if (rewritten) streamUrl = rewritten;
    }
    if (!streamUrl) return res.status(404).json({ success: false, error: 'Stream slot not found' });

    const selectedAlternate = slot > 0 ? viableAlternates[slot - 1] : null;
    const rootSessionId = crypto.randomBytes(16).toString('hex');
    const tokenOpts = {
      userId: String(user.id),
      channelListCode: String(user.channelListCode || ''),
      streamUrl,
      sessionId: rootSessionId,
      // Mid-stream proxy failover: the token carries the catalog channel ref
      // so the proxy can resolve a backup target if the upstream dies mid-play.
      channelId: String(channel._id),
      primarySourceId:
        channel.metadata?.source === 'xtream' && channel.metadata?.xtreamSourceId
          ? String(channel.metadata.xtreamSourceId)
          : undefined,
      upstreamHeaders: {
        userAgent: slot === 0 ? channel.activeUserAgent : selectedAlternate?.userAgent,
        referrer: slot === 0 ? channel.activeReferrer : selectedAlternate?.referrer,
      },
    };
    const { token, expiresAt } = issuePlaybackToken({
      ...tokenOpts,
      // Direct playback is a MASTER-SWITCHED capability: it hands the client a
      // provider URL (with the panel credentials embedded) via a 302 — customers
      // and resellers must never see our sources. When ALLOW_DIRECT_PLAYBACK is
      // not 'true', every token is server-relayed and the only URL a client ever
      // sees is iptv.ld-11.net.
      direct: xtreamDirectPlayback && process.env.ALLOW_DIRECT_PLAYBACK === 'true' ? true : undefined,
    });

    // Direct mode is opt-in. When it's on, also mint a PROXY token over the
    // same session so clients can fall back to server-relayed playback when
    // the direct provider URL fails from their network (ISP blocks, geo, etc).
    // Both tokens share rootSessionId — one concurrent-stream slot, not two.
    //
    // HLS-remux (web) is gated by ALLOW_HLS_REMUX: browsers cannot play the
    // raw provider TS (mixed content on http:// CDNs + no native TS support),
    // so the server remuxes it to live HLS (ffmpeg, copy) served over HTTPS
    // same-origin. The same relay token is reused — still one concurrent slot.
    let proxyPlaybackUrl;
    let hlsUrl;
    const directEnabled =
      xtreamDirectPlayback && process.env.ALLOW_DIRECT_PLAYBACK === 'true';
    const hlsRemuxEnabled = process.env.ALLOW_HLS_REMUX === 'true';

    // Direct BROWSER playback (web player): when the provider stream URL is
    // HTTPS (no browser mixed-content) and direct playback is enabled for the
    // source, hand the viewer's browser the provider URL directly. Residential
    // viewers fetch from the provider's own CDN (their IP is allowed) — no
    // server relay needed, so streams keep working even when the provider
    // blocks the VPS datacenter IP (HTTP 456). `.ts` → mpegts.js in the
    // player, plus an `.m3u8` twin for hls.js when the source is Xtream.
    // Server-side remux/relay remain as fallbacks (datacenter clients,
    // http:// mirror URLs, tunnel-down periods).
    let directUrl;
    let directHlsUrl;
    // The direct browser URL must be the ORIGINAL provider URL (pre-mirror
    // rewrite): the mirror is http:// and only reflects server-side
    // reachability. Residential browsers reach the https primary fine.
    const directCandidateUrl =
      failoverTarget && /^https:/i.test(failoverTarget.streamUrl)
        ? failoverTarget.streamUrl
        : /^https:/i.test(preMirrorStreamUrl)
          ? preMirrorStreamUrl
          : /^https:/i.test(streamUrl)
            ? streamUrl
            : null;
    if (directEnabled && directCandidateUrl) {
      directUrl = directCandidateUrl;
      if (/\.ts(\?|$)/i.test(directCandidateUrl) && channel.metadata?.source === 'xtream') {
        directHlsUrl = directCandidateUrl.replace(/\.ts(\?|$)/i, '.m3u8$1');
      }
    }
    if (directEnabled || hlsRemuxEnabled) {
      const proxyToken = issuePlaybackToken({ ...tokenOpts, direct: false });
      if (directEnabled) {
        proxyPlaybackUrl = `${getPublicBaseUrl(req)}/api/v1/tv/playback/${proxyToken.token}.m3u8`;
      }
      if (hlsRemuxEnabled) {
        hlsUrl = `${getPublicBaseUrl(req)}/api/v1/tv/hls/${proxyToken.token}/index.m3u8`;
      }
    }

    // Enforce the per-user concurrent stream limit (oldest session is evicted
    // when exceeded; no-op when Redis is not configured).
    const playbackAccess = await checkPlaybackSubscription(String(user.id), user.role, 'Live');
    const session = await registerStreamSession({
      userId: String(user.id),
      sessionId: rootSessionId,
      ttlSec: Math.max(0, (expiresAt - Date.now()) / 1000),
      maxConcurrentStreams: playbackAccess.plan?.maxConcurrentStreams,
      metadata: {
        username: user.username,
        channelListCode: user.channelListCode,
        contentType: 'live',
        contentName: channel.channelName || '',
        contentGroup: channel.channelGroup || '',
        platform: String(req.headers['x-platform'] || req.headers['user-agent'] || '').slice(0, 40),
      },
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
        playbackUrl: playbackTokenUrl(getPublicBaseUrl(req), token, streamUrl),
        // The token URL has no file extension. Tell clients whether the first
        // response is an HLS manifest or an MPEG-TS stream so Media3 does not
        // have to guess from an opaque URL.
        mimeType: inferPlaybackMimeType(streamUrl),
        expiresAt,
        slot,
        streamLimit: { max: session.max, active: session.active },
        // Tells the operator (and future clients) whether this token was
        // served from the backup source because the primary was down.
        ...(failoverTarget ? { source: 'backup', failoverSourceId: String(failoverTarget.source._id) } : {}),
        // Or from a same-panel mirror domain (primary domain unreachable).
        ...(mirrorTargetBase && !failoverTarget ? { source: 'mirror', mirrorBase: mirrorTargetBase } : {}),
        // Present only when direct playback is enabled for the source: the
        // client may retry through the server relay if the direct URL fails.
        ...(proxyPlaybackUrl ? { proxyPlaybackUrl } : {}),
        // Web player: direct provider URLs (HTTPS only — no mixed content).
        // Residential viewers play straight from the provider CDN; the server
        // paths below remain as automatic fallbacks.
        ...(directUrl ? { directUrl } : {}),
        ...(directHlsUrl ? { directHlsUrl } : {}),
        // Web player primary source: server-side HLS remux (hls.js) when the
        // deployment has HLS remux enabled.
        ...(hlsUrl ? { hlsUrl } : {}),
      },
    });
  } catch (error) {
    console.error('Error issuing playback token:', error);
    return res.status(500).json({ success: false, error: 'Failed to issue playback token' });
  }
});

// Resolve proxy URL for a channel (legacy clients only; new clients use playback-token).
// GET /tv/proxy-url/:code?url=<stream_url>
router.get('/proxy-url/:code', async (req, res) => {
  try {
    if (process.env.ALLOW_LEGACY_RAW_PROXY !== 'true') {
      return res.status(410).json({ success: false, error: 'Legacy raw proxy disabled; request a playback token' });
    }
    const user = await findUserByCode(req.params.code, res);
    if (!user) return;

    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: 'url parameter is required' });
    }

    try {
      new URL(url);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid URL format' });
    }

    const baseUrl = getPublicBaseUrl(req);
    const proxyUrl = `${baseUrl}/api/v1/tv/stream/${req.params.code}?url=${encodeURIComponent(url)}`;

    res.json({ success: true, data: { proxyUrl } });
  } catch (error) {
    console.error('Error resolving proxy URL:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve proxy URL' });
  }
});

// Tokenized TV stream proxy. The token carries an encrypted upstream URL and expires quickly.
// GET /tv/playback/:token/segments/:seq — normalized media-playlist segments
// addressed by absolute media sequence under the ROOT token (short, stable URLs
// that stay identical across playlist reloads — AndroidX Media3 refuses the
// previous per-segment 500+ char child-token URLs with PARSING_CONTAINER_UNSUPPORTED).
router.get('/playback/:token/segments/:seq', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    // :seq arrives with the literal .ts extension (…/segments/3.ts)
    const seq = Number(String(req.params.seq || '').replace(/\.ts$/i, ''));
    if (!Number.isInteger(seq) || seq < 0) {
      return res.status(400).send('Invalid segment sequence');
    }
    const payload = verifyPlaybackToken(token);
    if (!payload) return res.status(401).send('Playback token expired or invalid');

    const user = await User.findOne({
      _id: payload.userId,
      channelListCode: payload.channelListCode,
      isActive: true,
    }).select('_id channelListCode role');
    if (!user) return res.status(401).send('Playback authorization revoked');
    if (!(await ensurePlaybackSubscription(user, res))) return;

    // v2 channel-reference tokens resolve the current upstream URL from the
    // Channel document (cached briefly); v1 tokens carry it embedded.
    const target = await resolvePlaybackTarget(payload);
    if (!target) return res.status(404).send('Stream not found');

    const rootSessionId = payload.sessionId || token;
    if (!(await isStreamSessionActive(String(user._id), rootSessionId))) {
      const ttlMs = payload.expiresAt ? payload.expiresAt - Date.now() : 30 * 60 * 1000;
      const session = await registerStreamSession({
        userId: String(user._id),
        sessionId: rootSessionId,
        ttlSec: Math.max(60, Math.round(ttlMs / 1000)),
      });
      if (!session.allowed) {
        return res.status(429).send('Playback session could not be registered');
      }
    }

    // Resolve the requested absolute sequence to an upstream segment URL by
    // re-reading the current upstream window (cached ~3s per stream).
    const segUrl = await resolveSegmentUrlBySequence(
      target.streamUrl,
      seq,
      target.upstreamHeaders,
      // Resolve against the exact playlist snapshot this client received
      // (primed when its media playlist was served) — not a fresh re-fetch,
      // whose live window may have already rotated past this sequence.
      `root:${token}`,
    );
    if (!segUrl) return res.status(404).send('Segment not found in current window');

    const proxyContext = {
      userId: String(user._id),
      channelListCode: user.channelListCode,
      sessionId: rootSessionId,
    };
    return proxyUpstreamStream(req, res, segUrl, proxyContext, undefined, target.upstreamHeaders);
  } catch (error) {
    console.error('Segment proxy error:', error);
    if (!res.headersSent) res.status(502).send('Bad Gateway');
  }
});

// GET /tv/playback/:token
router.get('/playback/:token', async (req, res) => {
  try {
    // Token URLs may carry a trailing .m3u8 so media players infer HLS from the
    // extension alone (the app's mimeType hint can be lost, which makes players
    // treat the URL as a progressive file and fail with PARSING_CONTAINER_UNSUPPORTED).
    const token = String(req.params.token).replace(/\.m3u8$/, '');
    const payload = verifyPlaybackToken(token);
    if (!payload) return res.status(401).send('Playback token expired or invalid');

    const user = await User.findOne({
      _id: payload.userId,
      channelListCode: payload.channelListCode,
      isActive: true,
    }).select('_id channelListCode role');
    if (!user) return res.status(401).send('Playback authorization revoked');
    if (!(await ensurePlaybackSubscription(user, res))) return;

    // v2 channel-reference tokens resolve the current upstream URL from the
    // Channel document (cached briefly); v1 tokens carry it embedded.
    const target = await resolvePlaybackTarget(payload);
    if (!target) return res.status(404).send('Stream not found');

    // A valid token is not sufficient by itself: the concurrency session must
    // still be active. This also makes administrative revocation effective.
    // Child HLS playlist, key and segment tokens inherit the root playback
    // session. This keeps concurrency enforcement intact while allowing Media3
    // to fetch every resource referenced by a tokenized manifest.
    const rootSessionId = payload.sessionId || req.params.token;
    if (!(await isStreamSessionActive(String(user._id), rootSessionId))) {
      // Pre-issued tokens (channel lists, alternate slots) may arrive without a
      // registered session — create one lazily (bounded by the user's concurrent
      // limit) instead of failing the first playback with a hard 429.
      const ttlMs = payload.expiresAt ? payload.expiresAt - Date.now() : 30 * 60 * 1000;
      const session = await registerStreamSession({
        userId: String(user._id),
        sessionId: rootSessionId,
        ttlSec: Math.max(60, Math.round(ttlMs / 1000)),
      });
      if (!session.allowed) {
        return res.status(429).send('Playback session could not be registered');
      }
    }

    const proxyContext = {
      userId: String(user._id),
      channelListCode: user.channelListCode,
      sessionId: rootSessionId,
      rootToken: token,
    };

    // Mid-stream failover context: when the proxied upstream connection dies,
    // the proxy re-resolves a backup target (NEO 4K / MIBOX) and keeps the
    // client session alive instead of dropping the stream.
    const failoverCtx = payload.channelId
      ? { channelId: payload.channelId, primarySourceId: payload.primarySourceId }
      : undefined;

    if (payload.direct === true) {
      // Direct mode is deliberately gated by deployment configuration. The
      // authorization token remains opaque in the initial API response, but
      // the final HTTP redirect necessarily exposes the provider URL to the
      // client. Operators should enable this only when their provider contract
      // permits direct client playback and source-URL exposure is acceptable.
      if (process.env.ALLOW_DIRECT_PLAYBACK !== 'true') {
        return proxyUpstreamStream(req, res, payload.streamUrl, proxyContext, undefined, payload.upstreamHeaders, failoverCtx);
      }

      const parsed = new URL(target.streamUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).send('Unsupported upstream protocol');
      }

      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Referrer-Policy': 'no-referrer',
      });
      return res.redirect(302, target.streamUrl);
    }

    return proxyUpstreamStream(req, res, target.streamUrl, proxyContext, undefined, target.upstreamHeaders, failoverCtx);
  } catch (error) {
    console.error('Tokenized TV proxy error:', error);
    if (!res.headersSent) res.status(502).send('Bad Gateway');
  }
});

// Legacy TV stream proxy. Kept temporarily for old clients; new clients must use
// /playback/:token so upstream credentials never appear in a client-visible URL.
// GET /tv/stream/:code?url=<stream_url>
router.get('/stream/:code', async (req, res) => {
  try {
    if (process.env.ALLOW_LEGACY_RAW_PROXY !== 'true') {
      return res.status(410).send('Legacy raw proxy disabled; request a playback token');
    }
    const user = await findUserByCode(req.params.code, res);
    if (!user) return;
    const { url } = req.query;
    if (!url) return res.status(400).send('URL parameter is required');
    return proxyUpstreamStream(
      req,
      res,
      String(url),
      { userId: String(user._id), channelListCode: user.channelListCode },
      req.params.code,
    );
  } catch (error) {
    console.error('Legacy TV proxy error:', error);
    if (!res.headersSent) res.status(502).send('Bad Gateway');
  }
});

// Pair device with code (verify code exists)
router.post('/pair', async (req, res) => {
  try {
    const { code, deviceName, deviceModel } = req.body;

    if (!code || code.length !== 6) {
      return res.status(400).json({
        success: false,
        error: 'Invalid channel list code. Code must be 6 characters.',
      });
    }

    // Find user by channel list code
    const user = await User.findOne({
      channelListCode: code.toUpperCase(),
      isActive: true,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or inactive channel list code',
      });
    }

    // A revoked list code must not pair new devices — same guard as
    // findUserByCode() for playlist/verify/stream.
    if (user.codeRevokedAt) {
      return res.status(403).json({
        success: false,
        error: 'This channel list code has been revoked. Please regenerate your code.',
      });
    }

    // Update device metadata
    user.metadata = user.metadata || {};
    user.metadata.lastPairedDevice = deviceName || 'Unknown Device';
    user.metadata.deviceModel = deviceModel || 'Unknown Model';
    user.metadata.pairedAt = new Date();
    user.lastLogin = new Date();

    await user.save();
    audit({
      userId: String(user._id),
      action: 'pair_device',
      resource: 'pairing',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: 'Device paired successfully',
      data: {
        username: user.username,
        channelListCode: user.channelListCode,
        channelsCount: user.role === 'Admin' ? 'All' : user.channels.length,
      },
    });
  } catch (error) {
    console.error('Error pairing device:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to pair device',
    });
  }
});

// Verify code (check if valid without pairing)
router.get('/verify/:code', async (req, res) => {
  try {
    const { code } = req.params;

    if (!code || code.length !== 6) {
      return res.status(400).json({
        success: false,
        error: 'Invalid channel list code format',
      });
    }

    const user = await User.findOne({
      channelListCode: code.toUpperCase(),
      isActive: true,
    });

    if (!user) {
      return res.json({
        success: false,
        valid: false,
        message: 'Invalid or inactive code',
      });
    }

    // Revoked codes are reported as invalid without disclosing the reason —
    // this endpoint stays a tight oracle (no username/role/catalog leak), and
    // /pair already tells the legitimate user to regenerate their code.
    if (user.codeRevokedAt) {
      return res.json({
        success: false,
        valid: false,
        message: 'Invalid or inactive code',
      });
    }

    // This endpoint is an oracle for a bearer credential. Return only validity;
    // never disclose the matched username, role, or catalog size.
    res.json({
      success: true,
      valid: true,
    });
  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify code',
    });
  }
});

// ====================
// EPG (Electronic Program Guide) ENDPOINTS
// ====================

// Get EPG as XMLTV format by channel list code
router.get('/epg/:code', async (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours) || 24, 72);
    const user = await findUserByCode(req.params.code, res);
    if (!user) return;

    // Rendered XMLTV is stable for the cache window (matches Cache-Control below).
    const cacheKey = `xml:${user.channelListCode}:${hours}`;
    const cachedXml = await epgCache.get(cacheKey);
    if (cachedXml) {
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.send(cachedXml);
    }

    const { epgIds, channelInfoMap } = await loadEpgChannelIds(user);

    // Query EPG programs
    const programs = await epgService.getEpgForChannels(epgIds, hours);

    // Build channel info for XMLTV output (only channels that have programs)
    const activeChannelIds = new Set(programs.map((p) => p.channelEpgId));
    const channelInfos = [];
    const epgBaseUrl = getPublicBaseUrl(req);
    for (const id of activeChannelIds) {
      const info = channelInfoMap.get(id);
      if (info) {
        channelInfos.push({ ...info, icon: proxyLogoUrl(epgBaseUrl, info.icon) });
      } else {
        channelInfos.push({ epgId: id, name: id, icon: '' });
      }
    }

    const xmltv = epgService.generateXmltv(channelInfos, programs);
    await epgCache.set(cacheKey, xmltv);

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Pragma', 'no-cache');
    res.send(xmltv);
  } catch (error) {
    console.error('Error fetching EPG:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch EPG data',
    });
  }
});

// Get EPG as JSON by channel list code
router.get('/epg/:code/json', async (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours) || 24, 72);
    const user = await findUserByCode(req.params.code, res);
    if (!user) return;

    const cacheKey = `json:${user.channelListCode}:${hours}`;
    const cachedPayload = await epgCache.get(cacheKey);
    if (cachedPayload) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json(cachedPayload);
    }

    const { epgIds, channelInfoMap } = await loadEpgChannelIds(user);

    const programs = await epgService.getEpgForChannels(epgIds, hours);

    // Group programs by channel
    const grouped = {};
    for (const prog of programs) {
      if (!grouped[prog.channelEpgId]) {
        const info = channelInfoMap.get(String(prog.channelEpgId).toLowerCase()) || {};
        grouped[prog.channelEpgId] = {
          channelId: prog.channelEpgId,
          channelName: info.name || prog.channelEpgId,
          tvgLogo: info.icon || '',
          programs: [],
        };
      }
      grouped[prog.channelEpgId].programs.push({
        title: prog.title,
        description: prog.description,
        category: prog.category,
        start: prog.startTime,
        end: prog.endTime,
        icon: prog.icon,
        language: prog.language,
      });
    }

    const payload = {
      success: true,
      hours,
      channelCount: Object.keys(grouped).length,
      programCount: programs.length,
      channels: Object.values(grouped),
    };
    await epgCache.set(cacheKey, payload);

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(payload);
  } catch (error) {
    console.error('Error fetching EPG JSON:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch EPG data',
    });
  }
});

// ====================
// PIN-BASED PAIRING ENDPOINTS
// ====================

// Request new pairing (TV generates PIN)
router.post('/pairing/request', async (req, res) => {
  try {
    const { deviceName, deviceModel } = req.body;

    // Get pairing expiry from environment (default 10 minutes)
    const expiryMinutes = parseInt(process.env.PAIRING_PIN_EXPIRY_MINUTES || '10', 10);
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Generate unique PIN
    const pin = await PairingRequest.generatePin();

    // Create pairing request
    const pairingRequest = new PairingRequest({
      pin,
      deviceName: deviceName || 'Android TV',
      deviceModel: deviceModel || 'Unknown Model',
      status: 'pending',
      expiresAt,
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    await pairingRequest.save();
    audit({
      action: 'pairing_request',
      resource: 'pairing',
      resourceId: String(pairingRequest._id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    console.info('Pairing request created', {
      pairingRequestId: String(pairingRequest._id),
      expiresAt,
    });

    res.json({
      success: true,
      pin,
      expiresAt,
      expiryMinutes,
      message: 'Enter this PIN on the web dashboard to pair your device',
    });
  } catch (error) {
    console.error('Error creating pairing request:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create pairing request',
    });
  }
});

// Confirm pairing (Web dashboard links user to PIN)
router.post('/pairing/confirm', async (req, res) => {
  try {
    const { pin } = req.body;

    console.info('Pairing confirmation attempt', {
      hasBody: !!req.body,
      hasSessionHeader: !!req.headers['x-session-id'],
    });

    if (!pin || pin.length !== 6) {
      console.warn('Invalid pairing PIN format');
      return res.status(400).json({
        success: false,
        error: 'Invalid PIN format. PIN must be 6 digits.',
      });
    }

    // Get session ID from header or body
    const sessionId = req.headers['x-session-id'] || req.body.sessionId;

    if (!sessionId) {
      console.warn('No session ID provided in pairing request');
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please log in.',
      });
    }

    // Verify session and get user
    const Session = require('../models/Session');
    const session = await Session.findOne({ sessionId }).populate('userId');

    if (!session || !session.userId) {
      console.warn('Pairing session not found or has no user');
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session. Please log in again.',
      });
    }

    // Check if session is still valid
    if (!session.isValid()) {
      console.warn('Pairing session expired', { userId: String(session.userId?._id || '') });
      await Session.deleteOne({ sessionId });
      return res.status(401).json({
        success: false,
        error: 'Session has expired. Please log in again.',
      });
    }

    const user = session.userId;
    console.info('Pairing user authenticated', { userId: String(user._id), role: user.role });

    // Find pairing request
    const pairingRequest = await PairingRequest.findOne({
      pin: pin.toString(),
      status: 'pending',
    });

    if (!pairingRequest) {
      console.warn('Pairing PIN not found or not pending');
      return res.status(404).json({
        success: false,
        error:
          'Invalid or expired PIN. The TV may have generated a new PIN or the PIN has already been used.',
      });
    }

    // Check if expired
    if (pairingRequest.isExpired()) {
      console.warn('Pairing PIN expired');
      await pairingRequest.markExpired();
      return res.status(400).json({
        success: false,
        error: 'PIN has expired. Please generate a new one on your TV.',
      });
    }

    // Link user to pairing request
    pairingRequest.userId = user._id;
    pairingRequest.status = 'completed';
    await pairingRequest.save();

    // Update user metadata
    user.metadata = user.metadata || {};
    user.metadata.lastPairedDevice = pairingRequest.deviceName;
    user.metadata.deviceModel = pairingRequest.deviceModel;
    user.metadata.pairedAt = new Date();
    user.lastLogin = new Date();
    await user.save();

    audit({
      userId: String(user._id),
      action: 'pairing_confirm',
      resource: 'pairing',
      resourceId: String(pairingRequest._id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    console.info('Pairing confirmed', {
      pairingRequestId: String(pairingRequest._id),
      userId: String(user._id),
      role: user.role,
    });

    res.json({
      success: true,
      message: 'Device paired successfully',
      device: {
        name: pairingRequest.deviceName,
        model: pairingRequest.deviceModel,
      },
      user: {
        username: user.username,
        channelListCode: user.channelListCode,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('❌ Error confirming pairing:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm pairing. Please try again.',
    });
  }
});

// Check pairing status (TV polls this endpoint)
router.get('/pairing/status/:pin', async (req, res) => {
  try {
    const { pin } = req.params;

    if (!pin || pin.length !== 6) {
      return res.status(400).json({
        success: false,
        error: 'Invalid PIN format',
      });
    }

    // Find pairing request
    const pairingRequest = await PairingRequest.findOne({
      pin: pin.toString(),
    }).populate('userId');

    if (!pairingRequest) {
      return res.json({
        success: false,
        paired: false,
        status: 'invalid',
        message: 'PIN not found',
      });
    }

    // Check if expired
    if (pairingRequest.isExpired() && pairingRequest.status === 'pending') {
      await pairingRequest.markExpired();
      return res.json({
        success: false,
        paired: false,
        status: 'expired',
        message: 'PIN has expired. Please request a new one.',
      });
    }

    // Check if completed — only return channelListCode (needed by TV app),
    // not username/role which leaks user info to anyone polling the PIN.
    // SECURITY RISK (accepted): channelListCode is the credential the TV needs to
    // fetch playlists. The PIN-based flow has no other authenticated/device-bound
    // channel to deliver it — the TV holds only the PIN — so it must be returned here.
    // Residual risk: anyone who guesses/knows the PIN during its short expiry window
    // (default 10 min) can read the code. Mitigated by the short-lived PIN and the
    // pairingStatusLimiter rate limit in server.js.
    if (pairingRequest.status === 'completed' && pairingRequest.userId) {
      const user = pairingRequest.userId;
      return res.json({
        success: true,
        paired: true,
        status: 'completed',
        channelListCode: user.channelListCode,
        message: 'Device paired successfully!',
      });
    }

    // Still pending
    res.json({
      success: true,
      paired: false,
      status: 'pending',
      expiresAt: pairingRequest.expiresAt,
      message: 'Waiting for user to confirm pairing on web dashboard...',
    });
  } catch (error) {
    console.error('Error checking pairing status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check pairing status',
    });
  }
});

// ── Server-side HLS remux (web playback) ────────────────────────────────────
// The token is the relay token minted by /playback-token (shares the same
// stream session slot). First request lazily starts an ffmpeg remux (upstream
// TS → live HLS fMP4); the playlist + segments are served over HTTPS
// same-origin so hls.js can play sources whose media CDN is http:// only.
// GET /tv/hls/:token/:file
const hlsAuthCache = new Map(); // token -> { at } — positive auth cached 30s
router.get('/hls/:token/:file', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const file = String(req.params.file || '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(file)) {
      return res.status(400).send('Bad request');
    }

    const payload = verifyPlaybackToken(token);
    if (!payload) return res.status(401).send('Playback token expired or invalid');

    // Authorize once and cache positively for 30s — segment fetches arrive
    // every ~2s and must not hit Mongo/Redis per segment.
    const cachedAuth = hlsAuthCache.get(token);
    if (!cachedAuth || Date.now() - cachedAuth.at > 30_000) {
      const user = await User.findOne({
        _id: payload.userId,
        channelListCode: payload.channelListCode,
        isActive: true,
      }).select('_id channelListCode role');
      if (!user) return res.status(401).send('Playback authorization revoked');
      if (!(await ensurePlaybackSubscription(user, res))) return;
      if (!(await isStreamSessionActive(String(user._id), payload.sessionId || token))) {
        const ttlMs = payload.expiresAt ? payload.expiresAt - Date.now() : 30 * 60 * 1000;
        const session = await registerStreamSession({
          userId: String(user._id),
          sessionId: payload.sessionId || token,
          ttlSec: Math.max(60, Math.round(ttlMs / 1000)),
        });
        if (!session.allowed) {
          return res.status(429).send('Playback session could not be registered');
        }
      }
      hlsAuthCache.set(token, { at: Date.now() });
      if (hlsAuthCache.size > 2000) hlsAuthCache.clear();
    }

    let hlsSession = hlsRemux.getHlsSession(token);
    if (!hlsSession) {
      const target = await resolvePlaybackTarget(payload);
      if (!target) return res.status(404).send('Stream not found');
      const started = hlsRemux.startHlsSession(token, {
        streamUrl: target.streamUrl,
        upstreamHeaders: target.upstreamHeaders,
      });
      if (!started.ok) {
        if (started.busy) return res.status(503).send('Live stream is busy — retry shortly');
        return res.status(502).send('Failed to start stream');
      }
      hlsSession = hlsRemux.getHlsSession(token);
    }
    hlsRemux.touchHlsSession(token);

    // The first playlist request races the ffmpeg startup (spawn → connect →
    // mux → first playlist, ~4-6s). Wait for it so hls.js's initial manifest
    // fetch succeeds instead of 404ing and falling back unnecessarily.
    if (hlsSession && file === 'index.m3u8') {
      const playlistPath = path.join(hlsSession.dir, file);
      const deadline = Date.now() + 12_000;
      while (!fs.existsSync(playlistPath) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 400));
        hlsSession = hlsRemux.getHlsSession(token) || hlsSession;
      }
    }

    if (!hlsSession || !fs.existsSync(path.join(hlsSession.dir, file))) {
      return res.status(404).send('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    const contentType =
      ext === '.m3u8'
        ? 'application/vnd.apple.mpegurl'
        : ext === '.mp4' || ext === '.m4s'
          ? 'video/mp4'
          : 'application/octet-stream';
    res.set({
      'Content-Type': contentType,
      'Cache-Control':
        ext === '.m3u8' ? 'no-store, no-cache, must-revalidate' : 'public, max-age=120',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(path.join(hlsSession.dir, file)).pipe(res);
  } catch (error) {
    console.error('HLS remux route error:', error);
    if (!res.headersSent) res.status(500).send('Internal error');
  }
});

module.exports = router;
