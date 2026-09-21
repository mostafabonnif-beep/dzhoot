const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Channel = require('../models/Channel');
const { requireAuth } = require('./auth');
const { audit } = require('../services/audit-log');
const { issuePlaybackToken, altStreamHash } = require('../services/playback-token');
const { getPublicBaseUrl } = require('../utils/public-url');
const {
  hasRestrictedPresentationMarker,
  presentChannelForClient,
  publicCatalogPresentationQuery,
  sortClientCatalogChannels,
} = require('../utils/catalog-presentation');
const { verifiedXtreamChannelQuery } = require('../utils/verified-channel-query');
function tokenizeUserChannel(channel, user, baseUrl) {
  const source = channel.toObject ? channel.toObject() : channel;
  const safe = { ...source, channelUrl: '' };
  if (!user.channelListCode) return presentChannelForClient(safe);
  // v2 (channel-reference) tokens are re-resolved AND scope-re-checked by
  // `/tv/playback/:token`; v1 tokens embed the upstream URL and are only checked
  // where they are minted. Mint v2 whenever the reference can resolve: the
  // SHARED catalog is looked up as `{ ownerId: null, channelId }`, and the
  // unique `(ownerId, channelId)` index makes that unambiguous. A channel the
  // user imported themselves must keep v1 — `/tv/playback` never resolves refs
  // against private imports, so its channelId would either 404 or, worse, hit
  // an unrelated shared channel that happens to share the tvg-id.
  const candidateChannelId = source.ownerId ? '' : String(source.channelId || '').trim();
  // `issuePlaybackToken` refuses a channel reference longer than 200 chars;
  // such a channel falls back to the v1 embedded-URL token rather than failing
  // the whole list (the scope filter has already cleared it).
  const sharedChannelId = candidateChannelId.length <= 200 ? candidateChannelId : '';
  if (source.channelUrl) {
    const { token } = issuePlaybackToken(
      sharedChannelId
        ? {
            userId: String(user._id),
            channelListCode: user.channelListCode,
            channelRef: { channelId: sharedChannelId, hls: true },
          }
        : {
            userId: String(user._id),
            channelListCode: user.channelListCode,
            streamUrl: source.channelUrl,
          },
    );
    safe.channelUrl = `${baseUrl}/api/v1/tv/playback/${token}.m3u8`;
  }
  safe.alternateStreams = (source.alternateStreams || [])
    .filter((alternate) => alternate.liveness?.status !== 'dead' && alternate.flaggedBad?.isFlagged !== true)
    .slice(0, 10)
    .map((alternate) => {
      if (!alternate.streamUrl) return { ...alternate, streamUrl: '' };
      const { token } = issuePlaybackToken(
        sharedChannelId
          ? {
              userId: String(user._id),
              channelListCode: user.channelListCode,
              channelRef: {
                channelId: sharedChannelId,
                altUrlHash: altStreamHash(alternate.streamUrl),
                hls: true,
              },
            }
          : {
              userId: String(user._id),
              channelListCode: user.channelListCode,
              streamUrl: alternate.streamUrl,
            },
      );
      return { ...alternate, streamUrl: `${baseUrl}/api/v1/tv/playback/${token}.m3u8` };
    });
  return presentChannelForClient(safe);
}

const {
  resolveChannelGroups,
  clubByChannelId,
  capChannelAdditions,
  withChannelCapFilter,
  extractExtinfTitle,
} = require('../services/import-helpers');
const { allowedGroupsForUser, groupScopeClause } = require('../services/channel-scope');

/**
 * The freemium boundary must hold on the *personal selection* endpoints too.
 *
 * These routes mint a playback token for every channel they return, so a
 * group-limited / free-tier code that could put an out-of-scope shared channel
 * in `user.channels` would get a working stream URL straight out of
 * `GET /me/channels` — bypassing `/tv/playback-token`, which does apply the
 * scope. The scope applies to the SHARED catalog; a user's own private imports
 * (`ownerId = the user`) are always selectable.
 */
function privateImportClause(userId) {
  return { ownerId: userId };
}

function sharedCatalogClause(scopeClause) {
  return { ownerId: null, ...(scopeClause || {}) };
}

/** Mongo clause matching every channel this user is allowed to select. */
async function selectableChannelClause(user) {
  const scopeClause = await groupScopeClause(user);
  return {
    $or: [privateImportClause(user.id), sharedCatalogClause(scopeClause)],
  };
}

/**
 * In-memory twin of {@link selectableChannelClause} for already-populated docs.
 * `scopeGroups` is `allowedGroupsForUser` (null = unrestricted).
 */
function isSelectableChannel(scopeGroups, userId, channel) {
  if (!scopeGroups) return true;
  const ownerId = channel?.ownerId ? String(channel.ownerId) : '';
  if (ownerId && ownerId === String(userId)) return true;
  return scopeGroups.includes(String(channel?.channelGroup ?? '').trim());
}

/**
 * Populate projection shared by BOTH personal-playlist read endpoints.
 * `ownerId` is what the freemium scope filter keys on and `channelId` is what
 * lets {@link tokenizeUserChannel} mint a re-checkable v2 token; a handler with
 * its own (narrower) projection silently loses one of the two — which is how
 * `GET /me/channels-with-fallbacks` came to hand out playable URLs for
 * out-of-scope channels while `GET /me/channels` did not.
 */
const USER_CHANNEL_POPULATE_FIELDS =
  'channelName channelGroup channelUrl channelId tvgLogo channelImg ownerId metadata metrics flaggedBad alternateStreams';

/**
 * Presentation- and scope-filtered, tokenized channel list — the single
 * implementation behind `GET /me/channels` and
 * `GET /me/channels-with-fallbacks`, so the two can no longer disagree about
 * what the freemium boundary is.
 */
async function scopedTokenizedChannels(user, baseUrl) {
  // Scope filter: a stale selection (or one written before a plan changed) must
  // not keep handing out tokens for out-of-scope shared channels.
  const scopeGroups = await allowedGroupsForUser(user);
  const selected = (user.channels || [])
    .filter((channel) => !hasRestrictedPresentationMarker(channel))
    .filter((channel) => isSelectableChannel(scopeGroups, user._id, channel));
  // Same visibility gate the catalog uses, applied to the customer's own selection. A
  // selection outlives the channel's source (a replaced provider, a dead supplier stream) and
  // this helper hands out playback tokens, so returning a channel that every catalog endpoint
  // refuses to serve means a listed channel that fails the moment it is tapped.
  const selectedIds = selected.map((channel) => channel._id).filter(Boolean);
  const visibleIds = new Set(
    (
      await Channel.find(await verifiedXtreamChannelQuery({ _id: { $in: selectedIds } }))
        .select('_id')
        .lean()
    ).map((channel) => String(channel._id)),
  );
  return sortClientCatalogChannels(
    selected.filter((channel) => visibleIds.has(String(channel._id))),
  ).map((channel) => tokenizeUserChannel(channel, user, baseUrl));
}

// Get current user's channels
router.get('/me/channels', requireAuth, async (req, res) => {
  try {
    console.log('🔵 GET /me/channels called for user:', req.user.id);
    const user = await User.findById(req.user.id).populate(
      'channels',
      USER_CHANNEL_POPULATE_FIELDS,
    );
    if (!user) {
      console.error('❌ User not found:', req.user.id);
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    console.log(
      `✅ User: ${user.username}, Role: ${user.role}, Channels: ${user.channels?.length || 0}`,
    );
    console.log(
      '📋 Channel IDs in user.channels:',
      user.channels?.map((ch) => ch._id || ch).slice(0, 3),
    );
    const channels = await scopedTokenizedChannels(user, getPublicBaseUrl(req));
    res.json({ success: true, channels });
  } catch (error) {
    console.error('❌ Get my channels error:', error);
    res.status(500).json({ success: false, error: 'Failed to get channels' });
  }
});

// Set current user's channels (replace)
router.put('/me/channels', requireAuth, async (req, res) => {
  try {
    const { channelIds } = req.body;
    if (!Array.isArray(channelIds))
      return res.status(400).json({ success: false, error: 'channelIds must be an array' });

    // Validate all IDs are valid ObjectIds
    const invalidIds = channelIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ success: false, error: 'Invalid channel ID format' });
    }

    // Validate channel IDs — only shared catalog channels this user's code is
    // scoped to, or the user's own private imports, so a user can neither add
    // another user's private channel nor escape the freemium group boundary by
    // writing an out-of-scope shared channel into their selection.
    const scopeClause = await groupScopeClause(req.user);
    const channels = await Channel.find({
      $and: [
        { _id: { $in: channelIds } },
        { $or: [privateImportClause(req.user.id), sharedCatalogClause(scopeClause)] },
        publicCatalogPresentationQuery(),
      ],
    }).select('_id');

    if (channels.length !== channelIds.length) {
      const accepted = new Set(channels.map((c) => c._id.toString()));
      const rejected = channelIds.filter((id) => !accepted.has(String(id)));
      // Distinguish "not yours / not public" from "outside your plan's groups"
      // so the client can show an actionable message.
      const outOfScope = scopeClause
        ? await Channel.countDocuments({
            _id: { $in: rejected },
            ownerId: null,
            ...publicCatalogPresentationQuery(),
            channelGroup: { $nin: scopeClause.channelGroup.$in },
          })
        : 0;
      return res.status(400).json({
        success: false,
        error: outOfScope
          ? 'Some channels are outside your subscription scope'
          : 'Some channel IDs are invalid',
        code: outOfScope ? 'CHANNEL_OUT_OF_SCOPE' : 'INVALID_CHANNEL_IDS',
        rejectedCount: rejected.length,
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    user.channels = channelIds.map((id) => new mongoose.Types.ObjectId(id));
    await user.save();
    audit({
      userId: req.user.id,
      action: 'set_channels',
      resource: 'user_playlist',
      resourceId: String(req.user.id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, message: 'Channels updated', count: user.channels.length });
  } catch (error) {
    console.error('Set my channels error:', error);
    res.status(500).json({ success: false, error: 'Failed to update channels' });
  }
});

// Add channels to current user
router.post('/me/channels/add', requireAuth, async (req, res) => {
  try {
    const { channelIds } = req.body;
    if (!Array.isArray(channelIds))
      return res.status(400).json({ success: false, error: 'channelIds must be an array' });

    const invalidIds = channelIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ success: false, error: 'Invalid channel ID format' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const existingIds = new Set(user.channels.map((id) => id.toString()));
    const addScopeClause = await groupScopeClause(req.user);
    const validChannels = await Channel.find({
      $and: [
        { _id: { $in: channelIds } },
        { $or: [privateImportClause(req.user.id), sharedCatalogClause(addScopeClause)] },
        publicCatalogPresentationQuery(),
      ],
    }).select('_id');
    const validIds = validChannels.map((c) => c._id.toString());

    const wanted = validIds.filter((id) => !existingIds.has(id));
    const { allowed: toAdd, rejected } = capChannelAdditions(user.channels.length, wanted);
    let finalCount = user.channels.length;
    let addedCount = 0;
    if (toAdd.length > 0) {
      // Atomic $addToSet with the cap in the filter — a snapshot-then-save would let
      // concurrent additions overshoot USER_CHANNELS_MAX.
      const updated = await User.findOneAndUpdate(
        withChannelCapFilter(user._id, toAdd.length),
        { $addToSet: { channels: { $each: toAdd.map((id) => new mongoose.Types.ObjectId(id)) } } },
        { new: true },
      );
      if (updated) {
        finalCount = updated.channels.length;
        addedCount = toAdd.length;
      } else {
        console.warn(`[user-playlist] channel list limit hit concurrently for ${req.user.id}`);
      }
    }
    if (rejected > 0) {
      console.warn(
        `[user-playlist] channel list limit reached for ${req.user.id}: ${rejected} skipped`,
      );
    }
    audit({
      userId: req.user.id,
      action: 'add_channels',
      resource: 'user_playlist',
      resourceId: `${addedCount} channels`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: `Added ${addedCount} channels`,
      count: finalCount,
      addedCount,
    });
  } catch (error) {
    console.error('Add my channels error:', error);
    res.status(500).json({ success: false, error: 'Failed to add channels' });
  }
});

// Remove channels from current user
router.post('/me/channels/remove', requireAuth, async (req, res) => {
  try {
    const { channelIds } = req.body;
    if (!Array.isArray(channelIds))
      return res.status(400).json({ success: false, error: 'channelIds must be an array' });

    const invalidIds = channelIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ success: false, error: 'Invalid channel ID format' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const before = user.channels.length;
    const removeSet = new Set(channelIds.map((id) => id.toString()));
    user.channels = user.channels.filter((id) => !removeSet.has(id.toString()));
    await user.save();
    const removed = before - user.channels.length;
    audit({
      userId: req.user.id,
      action: 'remove_channels',
      resource: 'user_playlist',
      resourceId: `${removed} channels`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: `Removed ${removed} channels`,
      count: user.channels.length,
      removedCount: removed,
    });
  } catch (error) {
    console.error('Remove my channels error:', error);
    res.status(500).json({ success: false, error: 'Failed to remove channels' });
  }
});

// Get current user's channels with viable fallback streams (for Android app)
router.get('/me/channels-with-fallbacks', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate(
      'channels',
      USER_CHANNEL_POPULATE_FIELDS,
    );
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Same filter + tokenization as GET /me/channels (see
    // `scopedTokenizedChannels`): this endpoint mints a playback token for every
    // channel it returns, so it must apply the freemium scope too — otherwise a
    // stale selection keeps a working stream URL for out-of-scope channels.
    const channels = await scopedTokenizedChannels(user, getPublicBaseUrl(req));
    res.json({ success: true, channels });
  } catch (error) {
    console.error('Get channels with fallbacks error:', error);
    res.status(500).json({ success: false, error: 'Failed to get channels' });
  }
});

// Get current user's channel list as M3U
router.get('/me/playlist.m3u', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).send('#EXTM3U\n#ERROR:User not found');

    const baseUrl = getPublicBaseUrl(req);
    const m3u = await user.generateUserPlaylist(baseUrl);
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    const safeUsername = user.username.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeUsername}-channels.m3u"`);
    return res.send(m3u);
  } catch (error) {
    console.error('Generate user channels M3U error:', error);
    return res.status(500).send('#EXTM3U\n#ERROR:Internal server error');
  }
});

// Import M3U to user's playlist
router.post('/me/import-m3u', requireAuth, async (req, res) => {
  try {
    const { m3uContent } = req.body;

    if (!m3uContent) {
      return res.status(400).json({
        success: false,
        error: 'M3U content is required',
      });
    }

    // Bound the request body the same way admin imports are bounded
    // (security audit: unbounded parse + insert = DB resource exhaustion).
    const USER_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
    if (Buffer.byteLength(String(m3uContent), 'utf8') > USER_IMPORT_MAX_BYTES) {
      return res.status(400).json({
        success: false,
        error: 'M3U content is too large (max 5 MB)',
      });
    }

    // Parse M3U content (same logic as admin import)
    const lines = m3uContent.split('\n');
    const parsedChannels = [];
    let currentChannel = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
        const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
        const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
        const groupTitleMatch = line.match(/group-title="([^"]*)"/);
        // Title = text after the attribute list, NOT after the first comma — attribute
        // values (logo URLs, user-agents) legally contain commas.
        const channelName = extractExtinfTitle(line);

        currentChannel = {
          channelId: tvgIdMatch ? tvgIdMatch[1] : `channel_${Date.now()}_${i}`,
          tvgName: tvgNameMatch ? tvgNameMatch[1] : '',
          channelImg: tvgLogoMatch ? tvgLogoMatch[1] : '',
          tvgLogo: tvgLogoMatch ? tvgLogoMatch[1] : '',
          channelGroup: groupTitleMatch ? groupTitleMatch[1] : 'Uncategorized',
          channelName: channelName || 'Unknown',
          order: parsedChannels.length,
        };
      } else if (line && !line.startsWith('#') && currentChannel) {
        currentChannel.channelUrl = line;
        parsedChannels.push(currentChannel);
        currentChannel = null;
      }
    }

    if (parsedChannels.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid channels found in M3U content',
      });
    }

    // Club same-tvg-id entries into alternateStreams and categorize from the iptv-org cache
    // so an imported list isn't dumped into 'Uncategorized'.
    const importChannels = clubByChannelId(parsedChannels);
    await resolveChannelGroups(importChannels);

    // SSRF gate on user-supplied URLs: these are stored and later fetched by
    // the server (proxies, probes, HLS remux). A user must not point the
    // server at internal/private networks (security audit).
    const { validateUrlForSSRF } = require('../utils/ssrf-guard');
    const candidateUrls = [];
    for (const ch of importChannels) {
      if (ch.channelUrl) candidateUrls.push(ch.channelUrl);
      for (const alt of ch.alternateStreams || []) {
        if (alt.streamUrl) candidateUrls.push(alt.streamUrl);
      }
    }
    const uniqueUrls = [...new Set(candidateUrls)].slice(0, 20000);
    const blockedUrls = new Set();
    const SSRF_CHUNK = 10;
    for (let i = 0; i < uniqueUrls.length; i += SSRF_CHUNK) {
      const chunk = uniqueUrls.slice(i, i + SSRF_CHUNK);
      const results = await Promise.all(
        chunk.map(async (u) => ({ u, check: await validateUrlForSSRF(u) })),
      );
      for (const r of results) {
        if (!r.check.safe) blockedUrls.add(r.u);
      }
    }
    if (blockedUrls.size > 0) {
      const sanitized = [];
      for (const ch of importChannels) {
        if (blockedUrls.has(ch.channelUrl)) continue;
        const safeAlts = (ch.alternateStreams || []).filter(
          (alt) => !blockedUrls.has(alt.streamUrl),
        );
        if (!ch.channelUrl && safeAlts.length === 0) continue;
        sanitized.push({ ...ch, alternateStreams: safeAlts });
      }
      if (sanitized.length === 0) {
        return res.status(400).json({
          success: false,
          error: `Import blocked: ${blockedUrls.size} URL(s) point to private/internal addresses, which are not allowed`,
        });
      }
      importChannels.length = 0;
      importChannels.push(...sanitized);
    }

    // The user must be loaded before we create Channel documents so creation
    // is capped at the playlist budget (orphan Channel docs would otherwise
    // accumulate without bound across imports — security audit).
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const USER_CHANNELS_MAX = Number(process.env.USER_CHANNELS_MAX) || 5000;
    const playlistBudget = Math.max(0, USER_CHANNELS_MAX - (user.channels || []).length);

    // Dedup only against THIS user's own (private) channels — never the shared catalog
    // or other users' imports.
    const urls = importChannels.map((ch) => ch.channelUrl);
    const existingChannels = await Channel.find({
      channelUrl: { $in: urls },
      ownerId: req.user.id,
    }).select('_id channelUrl');
    const existingUrlMap = new Map(existingChannels.map((ch) => [ch.channelUrl, ch._id]));

    // Create the rest as private channels owned by this user.
    const toCreate = importChannels
      .filter((ch) => !existingUrlMap.has(ch.channelUrl))
      .slice(0, playlistBudget)
      .map((ch) => ({ ...ch, ownerId: req.user.id }));
    let createdChannels = [];
    if (toCreate.length > 0) {
      // ordered:false keeps going past any per-owner (ownerId, channelId) duplicate;
      // on a BulkWriteError we still keep the successfully inserted docs.
      createdChannels = await Channel.insertMany(toCreate, { ordered: false }).catch((err) => {
        if (err.insertedDocs) return err.insertedDocs;
        throw err;
      });
    }

    // Collect all channel IDs
    const allChannelIds = [
      ...existingChannels.map((ch) => ch._id),
      ...createdChannels.map((ch) => ch._id),
    ];

    // Add to user's playlist (skip already-added) — user was loaded above so
    // Channel creation stays within the playlist budget.
    const userChannelIds = new Set(user.channels.map((id) => id.toString()));
    const wanted = allChannelIds.filter((id) => !userChannelIds.has(id.toString()));
    const { allowed: toAdd, rejected } = capChannelAdditions(user.channels.length, wanted);
    let finalCount = user.channels.length;
    let addedCount = 0;
    if (toAdd.length > 0) {
      // Atomic $addToSet with the cap in the filter — a snapshot-then-save would let
      // concurrent imports overshoot USER_CHANNELS_MAX.
      const updated = await User.findOneAndUpdate(
        withChannelCapFilter(user._id, toAdd.length),
        { $addToSet: { channels: { $each: toAdd.map((id) => new mongoose.Types.ObjectId(id)) } } },
        { new: true },
      );
      if (updated) {
        finalCount = updated.channels.length;
        addedCount = toAdd.length;
      } else {
        console.warn(`[user-playlist] channel list limit hit concurrently for ${req.user.id}`);
      }
    }
    if (rejected > 0) {
      console.warn(
        `[user-playlist] channel list limit reached for ${req.user.id}: ${rejected} skipped`,
      );
    }

    audit({
      userId: req.user.id,
      action: 'import_m3u',
      resource: 'user_playlist',
      resourceId: `${addedCount} channels`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: `Added ${addedCount} channels to your list`,
      added: addedCount,
      count: finalCount,
    });
  } catch (error) {
    console.error('User import M3U error:', error);
    res.status(500).json({ success: false, error: 'Failed to import M3U' });
  }
});

module.exports = router;
