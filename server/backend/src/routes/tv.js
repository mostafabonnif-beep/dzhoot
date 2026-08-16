const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Channel = require('../models/Channel');
const XtreamSource = require('../models/XtreamSource');
const EpgProgram = require('../models/EpgProgram');
const PairingRequest = require('../models/PairingRequest');
const { epgService } = require('../services/epg-service');
const { audit } = require('../services/audit-log');
const { issuePlaybackToken, verifyPlaybackToken } = require('../services/playback-token');
const { proxyUpstreamStream } = require('../services/upstream-proxy');
const {
  isCatchupSupported,
  buildCatchupUrlForChannel,
} = require('../services/catchup-service');
const { registerStreamSession } = require('../services/stream-session-service');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');
const { epgCache } = require('../services/cache');
const { decryptSecret } = require('../utils/crypto');
const { getPublicBaseUrl } = require('../utils/public-url');
const { checkPlaybackSubscription } = require('../services/playback-access-service');

async function getVerifiedXtreamSourceIds() {
  return new Set((await XtreamSource.find({
    status: 'Active',
    verificationStatus: 'verified',
  }).distinct('_id')).map((id) => String(id)));
}

function isCustomerVisibleChannel(channel, verifiedSourceIds) {
  if (channel.metadata?.source !== 'xtream') return true;
  return verifiedSourceIds.has(String(channel.metadata?.xtreamSourceId || ''));
}

async function ensurePlaybackSubscription(user, res) {
  const access = await checkPlaybackSubscription(String(user?._id || user?.id || ''), user?.role);
  if (access.allowed) return true;
  res.status(403).json({
    success: false,
    error: 'Your subscription has expired. Activate a new code to continue watching.',
    code: 'SUBSCRIPTION_EXPIRED',
  });
  return false;
}

// Same cap as the /channels sync — the EPG only needs to cover what the TV can list.
const TV_CHANNELS_MAX = Number(process.env.TV_CHANNELS_MAX) || 2000;

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
  if (!user.channelListCode) return safe;
  if (source.channelUrl) {
    const { token } = issuePlaybackToken({
      userId: String(user._id),
      channelListCode: user.channelListCode,
      streamUrl: source.channelUrl,
      upstreamHeaders: {
        userAgent: source.activeUserAgent || undefined,
        referrer: source.activeReferrer || undefined,
      },
    });
    safe.channelUrl = `${baseUrl}/api/v1/tv/playback/${token}`;
  }
  safe.alternateStreams = await Promise.all(
    (source.alternateStreams || [])
      .filter((alternate) => alternate.liveness?.status !== 'dead' && alternate.flaggedBad?.isFlagged !== true)
      .slice(0, 10)
      .map(async (alternate) => {
        if (!alternate.streamUrl) return { ...alternate, streamUrl: '' };
        const { token } = issuePlaybackToken({
          userId: String(user._id),
          channelListCode: user.channelListCode,
          streamUrl: alternate.streamUrl,
          upstreamHeaders: {
            userAgent: alternate.userAgent || undefined,
            referrer: alternate.referrer || undefined,
          },
        });
        return { ...alternate, streamUrl: `${baseUrl}/api/v1/tv/playback/${token}` };
      }),
  );
  return safe;
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
  const knownSet = new Set(knownEpgIds);

  const epgIds = [];
  const channelInfoMap = new Map();
  for (const ch of channels) {
    const ids = [ch.channelId, ch.tvgId, ch.tvgName].filter(Boolean);
    for (const id of ids) {
      if (!channelInfoMap.has(id)) {
        channelInfoMap.set(id, {
          epgId: id,
          channelId: ch.channelId,
          name: ch.channelName,
          icon: ch.tvgLogo || ch.channelImg || '',
        });
        if (knownSet.has(id)) epgIds.push(id);
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
    const visibleChannels = channels.filter((channel) => isCustomerVisibleChannel(channel, verifiedSourceIds));
    const baseUrl = getPublicBaseUrl(req);
    const tokenizedChannels = await Promise.all(
      visibleChannels.map((channel) => tokenizeChannelForClient(channel, user, baseUrl)),
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
    const slot = Number(req.body?.slot ?? 0);
    const catchupStartMs = Number(req.body?.catchupStartMs ?? 0);
    const catchupDurationMin = Math.min(Math.max(Number(req.body?.catchupDurationMin ?? 0), 1), 24 * 60);
    if (!Number.isFinite(catchupStartMs) || catchupStartMs < 0 || !Number.isFinite(catchupDurationMin)) {
      return res.status(400).json({ success: false, error: 'Invalid catch-up parameters' });
    }
    if (!channelRef || channelRef.length > 200 || !Number.isInteger(slot) || slot < 0 || slot > 3) {
      return res.status(400).json({ success: false, error: 'channelId and a valid slot are required' });
    }

    const user = req.user;
    const { isSubscriptionRequired, getActiveSubscription } = require('../services/subscription-service');
    if (await isSubscriptionRequired() && user.role !== 'Admin' && !(await getActiveSubscription(user.id))) {
      return res.status(403).json({
        success: false,
        error: 'Your subscription has expired. Activate a new code to continue watching.',
        code: 'SUBSCRIPTION_EXPIRED',
      });
    }

    const channel = await Channel.findOne({ channelId: channelRef, isActive: { $ne: false } }).lean();
    if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });

    if (channel.metadata?.source === 'xtream') {
      const source = await XtreamSource.findOne({
        _id: channel.metadata.xtreamSourceId,
        status: 'Active',
        verificationStatus: 'verified',
      }).lean();
      if (!source) return res.status(404).json({ success: false, error: 'Channel source is not verified', code: 'SOURCE_NOT_VERIFIED' });
    }

    const isCatalogUser = user.role === 'Admin' || user.allCatalog === true;
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
    if (!streamUrl) return res.status(404).json({ success: false, error: 'Stream slot not found' });

    const selectedAlternate = slot > 0 ? viableAlternates[slot - 1] : null;
    const { token, expiresAt } = issuePlaybackToken({
      userId: String(user.id),
      channelListCode: String(user.channelListCode || ''),
      streamUrl,
      upstreamHeaders: {
        userAgent: slot === 0 ? channel.activeUserAgent : selectedAlternate?.userAgent,
        referrer: slot === 0 ? channel.activeReferrer : selectedAlternate?.referrer,
      },
    });

    // Enforce the per-user concurrent stream limit (oldest session is evicted
    // when exceeded; no-op when Redis is not configured).
    const session = await registerStreamSession({
      userId: String(user.id),
      sessionId: token,
      ttlSec: Math.max(0, (expiresAt - Date.now()) / 1000),
    });

    return res.json({
      success: true,
      data: {
        playbackUrl: `${getPublicBaseUrl(req)}/api/v1/tv/playback/${token}`,
        expiresAt,
        slot,
        streamLimit: { max: session.max, active: session.active },
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
// GET /tv/playback/:token
router.get('/playback/:token', async (req, res) => {
  try {
    const payload = verifyPlaybackToken(req.params.token);
    if (!payload) return res.status(401).send('Playback token expired or invalid');

    const user = await User.findOne({
      _id: payload.userId,
      channelListCode: payload.channelListCode,
      isActive: true,
    }).select('_id channelListCode role');
    if (!user) return res.status(401).send('Playback authorization revoked');
    if (!(await ensurePlaybackSubscription(user, res))) return;

    return proxyUpstreamStream(req, res, payload.streamUrl, {
      userId: String(user._id),
      channelListCode: user.channelListCode,
    }, undefined, payload.upstreamHeaders);
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
    for (const id of activeChannelIds) {
      const info = channelInfoMap.get(id);
      if (info) {
        channelInfos.push(info);
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
        const info = channelInfoMap.get(prog.channelEpgId) || {};
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
      resourceId: pin,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    console.log(`Pairing request created: PIN ${pin}, expires at ${expiresAt}`);

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

    console.log('Pairing confirmation attempt:', {
      pin,
      hasBody: !!req.body,
      hasHeader: !!req.headers['x-session-id'],
    });

    if (!pin || pin.length !== 6) {
      console.warn('Invalid PIN format:', pin);
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
      console.warn('Session not found or has no user:', sessionId);
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session. Please log in again.',
      });
    }

    // Check if session is still valid
    if (!session.isValid()) {
      console.warn('Session expired for user:', session.username);
      await Session.deleteOne({ sessionId });
      return res.status(401).json({
        success: false,
        error: 'Session has expired. Please log in again.',
      });
    }

    const user = session.userId;
    console.log(`User authenticated for pairing: ${user.username} (${user.role})`);

    // Find pairing request
    const pairingRequest = await PairingRequest.findOne({
      pin: pin.toString(),
      status: 'pending',
    });

    if (!pairingRequest) {
      console.warn('PIN not found or not pending:', pin);
      return res.status(404).json({
        success: false,
        error:
          'Invalid or expired PIN. The TV may have generated a new PIN or the PIN has already been used.',
      });
    }

    // Check if expired
    if (pairingRequest.isExpired()) {
      console.warn('PIN expired:', pin);
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
      resourceId: pin,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    console.log(
      `✅ Pairing confirmed: PIN ${pin} linked to user ${user.username} (${user.channelListCode})`,
    );

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

module.exports = router;
