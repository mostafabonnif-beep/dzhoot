const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Channel = require('../models/Channel');
const AppVersion = require('../models/AppVersion');
const User = require('../models/User');
const Session = require('../models/Session');
const PairingRequest = require('../models/PairingRequest');
const Device = require('../models/Device');
const { requireAuth, requireAdmin } = require('./auth');
const { escapeRegex } = require('../utils/escapeRegex');
const { audit } = require('../services/audit-log');
const { validateUrlForSSRF } = require('../utils/ssrf-guard');
const AuditLog = require('../models/AuditLog');
const { ExternalSourceChannel } = require('../models/ExternalSourceCache');
const { ScheduledTaskRun } = require('../models/ScheduledTaskRun');
const M3USource = require('../models/M3USource');
const XtreamSource = require('../models/XtreamSource');
const Plan = require('../models/Plan');
const ActivationCode = require('../models/ActivationCode');
const Subscription = require('../models/Subscription');
const Reseller = require('../models/Reseller');
const CreditTransaction = require('../models/CreditTransaction');
const CodeBatch = require('../models/CodeBatch');
const { epgService } = require('../services/epg-service');
const { getPlaybackQualityStats } = require('../services/playback-event-service');
const {
  getChannelIdentityStats,
  reconcileChannelIdentities,
} = require('../services/channel-identity-service');
const { channelCache, statsCache } = require('../services/cache');
const {
  resolveChannelGroups,
  clubByChannelId,
  dedupAgainstCatalog,
  extractExtinfTitle,
} = require('../services/import-helpers');

// Bust the cached admin/demo catalog (served by GET /channels + /grouped) on any catalog
// mutation, and drop cached channel-list counts. Keeps the TV/demo view consistent after edits.
function invalidateCatalogCache() {
  return Promise.all([
    channelCache.deletePattern('catalog:*'),
    statsCache.deletePattern('chcount:*'),
  ]);
}

// Apply session authentication and admin role check to all admin routes
router.use(requireAuth);
router.use(requireAdmin);

// ============ CHANNEL MANAGEMENT ============

// Create new channel (with field whitelist to prevent mass assignment)
router.post('/channels', async (req, res) => {
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
    } = req.body;
    // Same SSRF guard used by the M3U import path: only http(s) URLs may be
    // stored as stream sources (admin-only endpoint, but defense in depth).
    if (channelUrl) {
      const check = await validateUrlForSSRF(channelUrl);
      if (!check.safe) {
        return res.status(400).json({ success: false, error: `channelUrl: ${check.reason}` });
      }
    }
    if (channelImg) {
      const check = await validateUrlForSSRF(channelImg);
      if (!check.safe) {
        return res.status(400).json({ success: false, error: `channelImg: ${check.reason}` });
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
    });
    await channel.save();
    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'create_channel',
      resource: 'channel',
      resourceId: channel.channelId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({
      success: true,
      data: channel,
    });
  } catch (error) {
    console.error('Error creating channel:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to create channel',
    });
  }
});

// Update channel
router.put('/channels/:id', async (req, res) => {
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
    if (channelUrl !== undefined) {
      const check = await validateUrlForSSRF(channelUrl);
      if (!check.safe) {
        return res.status(400).json({ success: false, error: `channelUrl: ${check.reason}` });
      }
      allowedUpdates.channelUrl = channelUrl;
    }
    if (channelImg !== undefined) {
      const check = await validateUrlForSSRF(channelImg);
      if (!check.safe) {
        return res.status(400).json({ success: false, error: `channelImg: ${check.reason}` });
      }
      allowedUpdates.channelImg = channelImg;
    }
    if (tvgLogo !== undefined) allowedUpdates.tvgLogo = tvgLogo;
    if (tvgName !== undefined) allowedUpdates.tvgName = tvgName;
    if (tvgId !== undefined) allowedUpdates.tvgId = tvgId;
    if (channelGroup !== undefined) allowedUpdates.channelGroup = channelGroup;
    if (channelDrmKey !== undefined) allowedUpdates.channelDrmKey = channelDrmKey;
    if (order !== undefined) allowedUpdates.order = order;
    if (isActive !== undefined) allowedUpdates.isActive = isActive;
    if (alternateStreams !== undefined) allowedUpdates.alternateStreams = alternateStreams;
    if (flaggedBad !== undefined) allowedUpdates.flaggedBad = flaggedBad;
    if (metadata !== undefined) {
      // Whitelist of metadata keys that admins can set (prevents injection of arbitrary DB paths)
      const ALLOWED_METADATA_KEYS = [
        'country',
        'language',
        'resolution',
        'network',
        'website',
        'quality',
        'tags',
        'notes',
      ];
      for (const [key, value] of Object.entries(metadata)) {
        if (ALLOWED_METADATA_KEYS.includes(key)) {
          allowedUpdates[`metadata.${key}`] = value;
        }
      }
    }

    // Admins manage the shared catalog only — never a user's private channel.
    const channel = await Channel.findOneAndUpdate(
      { _id: req.params.id, ownerId: null },
      { $set: allowedUpdates },
      { new: true, runValidators: true },
    );

    if (!channel) {
      return res.status(404).json({
        success: false,
        error: 'Channel not found',
      });
    }

    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'update_channel',
      resource: 'channel',
      resourceId: channel.channelId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      data: channel,
    });
  } catch (error) {
    console.error('Error updating channel:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to update channel',
    });
  }
});

// Bulk-delete catalog channels by health status (requires { confirmed: true }).
// status: 'dead' (isWorking===false) | 'untested' (isWorking never set) | 'notworking' (dead+untested).
// Lets an admin purge the thousands of dead/unverified streams a raw M3U import
// leaves behind, instead of wiping the entire catalog or deleting one-by-one.
router.delete('/channels/bulk-by-status', async (req, res) => {
  try {
    if (!req.body?.confirmed) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }
    const status = String(req.body?.status || '').toLowerCase();
    let filter;
    if (status === 'dead') {
      filter = { ownerId: null, 'metadata.isWorking': false };
    } else if (status === 'untested') {
      filter = { ownerId: null, 'metadata.isWorking': { $exists: false } };
    } else if (status === 'notworking') {
      filter = { ownerId: null, 'metadata.isWorking': { $ne: true } };
    } else {
      return res.status(400).json({
        success: false,
        error: 'status must be one of: dead, untested, notworking',
      });
    }

    const catalogIds = await Channel.find(filter).distinct('_id');
    const deleteResult = await Channel.deleteMany(filter);

    if (catalogIds.length) {
      await User.updateMany(
        { channels: { $in: catalogIds } },
        { $pull: { channels: { $in: catalogIds } } },
      );
    }

    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: `bulk_delete_${status}_channels`,
      resource: 'channel',
      resourceId: `${deleteResult.deletedCount} channels`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      status,
      message: `Deleted ${deleteResult.deletedCount} ${status} channels`,
      deletedCount: deleteResult.deletedCount,
    });
  } catch (error) {
    console.error('Error bulk-deleting channels by status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk-delete channels',
    });
  }
});

// Bulk enable/disable catalog channels by explicit ID list.
// NOTE: must be registered before DELETE /channels/:id so 'bulk' never
// shadow-matches the :id parameter.
router.patch('/channels/bulk', async (req, res) => {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
    const ids = rawIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids[] is required (valid ObjectIds)' });
    }
    if (rawIds.length > 2000) {
      return res.status(400).json({ success: false, error: 'Too many ids (max 2000)' });
    }
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive (boolean) is required' });
    }
    const isActive = req.body.isActive;
    // Disabling channels is reversible but broad — require explicit confirmation.
    if (!isActive && req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Disabling channels requires { "confirmed": true } in request body',
      });
    }

    const updateResult = await Channel.updateMany(
      { _id: { $in: ids }, ownerId: null },
      { $set: { isActive } },
    );

    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: isActive ? 'bulk_enable_channels' : 'bulk_disable_channels',
      resource: 'channel',
      resourceId: `${updateResult.modifiedCount} channels`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      isActive,
      updatedCount: updateResult.modifiedCount,
      matchedCount: updateResult.matchedCount,
    });
  } catch (error) {
    console.error('Error bulk-updating channels:', error);
    res.status(500).json({ success: false, error: 'Failed to bulk-update channels' });
  }
});

// Bulk delete catalog channels by explicit ID list (requires { confirmed: true }).
// NOTE: must be registered before DELETE /channels/:id so 'bulk' never
// shadow-matches the :id parameter.
router.delete('/channels/bulk', async (req, res) => {
  try {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
    const ids = rawIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids[] is required (valid ObjectIds)' });
    }
    if (rawIds.length > 2000) {
      return res.status(400).json({ success: false, error: 'Too many ids (max 2000)' });
    }

    // Catalog-only: users' private (owned) channels are never touched.
    const catalogIds = await Channel.find({ _id: { $in: ids }, ownerId: null }).distinct('_id');
    const deleteResult = await Channel.deleteMany({ _id: { $in: catalogIds } });

    if (catalogIds.length) {
      await User.updateMany(
        { channels: { $in: catalogIds } },
        { $pull: { channels: { $in: catalogIds } } },
      );
    }

    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'bulk_delete_channels',
      resource: 'channel',
      resourceId: `${deleteResult.deletedCount} channels`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: `Deleted ${deleteResult.deletedCount} channels`,
      deletedCount: deleteResult.deletedCount,
    });
  } catch (error) {
    console.error('Error bulk-deleting channels:', error);
    res.status(500).json({ success: false, error: 'Failed to bulk-delete channels' });
  }
});

// Delete channel
router.delete('/channels/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid channel id' });
    }
    // Admins can delete catalog channels only — never a user's private channel.
    const channel = await Channel.findOneAndDelete({ _id: req.params.id, ownerId: null });

    if (!channel) {
      return res.status(404).json({
        success: false,
        error: 'Channel not found',
      });
    }

    // Remove the deleted channel id from every user's channels array to avoid orphan refs
    await User.updateMany({ channels: req.params.id }, { $pull: { channels: req.params.id } });

    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'delete_channel',
      resource: 'channel',
      resourceId: channel.channelId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: 'Channel deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting channel:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete channel',
    });
  }
});

// Delete all channels (requires { confirmed: true } in body)
router.delete('/channels', async (req, res) => {
  try {
    if (!req.body?.confirmed) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }

    // Only the shared catalog (ownerId:null) is wiped — users' private (owned) channels survive.
    const catalogIds = await Channel.find({ ownerId: null }).distinct('_id');
    const deleteResult = await Channel.deleteMany({ ownerId: null });

    // Remove the deleted catalog refs from users; their private channels stay in the array.
    if (catalogIds.length) {
      await User.updateMany(
        { channels: { $in: catalogIds } },
        { $pull: { channels: { $in: catalogIds } } },
      );
    }

    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'delete_all_channels',
      resource: 'channel',
      resourceId: `${deleteResult.deletedCount} channels`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: `Successfully deleted ${deleteResult.deletedCount} channels`,
      deletedCount: deleteResult.deletedCount,
    });
  } catch (error) {
    console.error('Error deleting all channels:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete all channels',
    });
  }
});


// Bulk import channels from M3U
router.post('/channels/import-m3u', async (req, res) => {
  try {
    const { m3uContent, clearExisting } = req.body;

    if (!m3uContent) {
      return res.status(400).json({
        success: false,
        error: 'M3U content is required',
      });
    }

    // Enforce size and line limits
    if (Buffer.byteLength(m3uContent, 'utf8') > 50 * 1024 * 1024) {
      return res.status(413).json({
        success: false,
        error: 'M3U content too large (max 50MB)',
      });
    }
    const lineCount = m3uContent.split('\n').length;
    if (lineCount > 100000) {
      return res.status(413).json({
        success: false,
        error: 'M3U content has too many lines (max 100,000)',
      });
    }

    // Clear existing catalog if requested — only the shared catalog (ownerId:null);
    // users' private (owned) channels are never touched by an admin catalog refresh.
    if (clearExisting) {
      const catalogIds = await Channel.find({ ownerId: null }).distinct('_id');
      await Channel.deleteMany({ ownerId: null });
      if (catalogIds.length) {
        await User.updateMany(
          { channels: { $in: catalogIds } },
          { $pull: { channels: { $in: catalogIds } } },
        );
      }
    }

    // Parse M3U content
    const lines = m3uContent.split('\n');
    const channels = [];
    let currentChannel = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        // Parse channel metadata
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
          order: channels.length,
        };
      } else if (line && !line.startsWith('#') && currentChannel) {
        // This is the stream URL
        currentChannel.channelUrl = line;
        channels.push(currentChannel);
        currentChannel = null;
      }
    }

    // Validate channel URLs against SSRF before inserting — bounded concurrency:
    // an unbounded Promise.all over thousands of URLs serializes on DNS and hangs.
    const SSRF_VALIDATION_CONCURRENCY = 20;
    const ssrfResults = new Array(channels.length);
    let ssrfCursor = 0;
    const ssrfWorker = async () => {
      while (ssrfCursor < channels.length) {
        const index = ssrfCursor;
        ssrfCursor += 1;
        ssrfResults[index] = await validateUrlForSSRF(channels[index].channelUrl);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SSRF_VALIDATION_CONCURRENCY, Math.max(channels.length, 1)) }, () => ssrfWorker()),
    );
    const blockedCount = ssrfResults.filter((r) => !r.safe).length;
    const safeChannels = channels.filter((_, i) => ssrfResults[i].safe);

    if (safeChannels.length === 0) {
      return res.status(400).json({
        success: false,
        error: `All ${channels.length} channel URLs were blocked by security policy`,
      });
    }

    // Club same-tvg-id entries into alternateStreams, categorize from the iptv-org cache so the
    // catalog isn't dumped into 'Uncategorized', then drop URLs already in the catalog so a
    // re-import doesn't create duplicate rows.
    const clubbed = clubByChannelId(safeChannels);
    await resolveChannelGroups(clubbed);
    const toInsert = await dedupAgainstCatalog(clubbed);

    // Insert only SSRF-safe, non-duplicate channels into database
    const insertedChannels = toInsert.length
      ? await Channel.insertMany(toInsert, { ordered: false })
      : [];

    await invalidateCatalogCache();
    audit({
      userId: req.user.id,
      action: 'import_m3u',
      resource: 'channel',
      resourceId: `${insertedChannels.length} channels`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const duplicateCount = clubbed.length - toInsert.length;
    const notes = [];
    if (blockedCount > 0) notes.push(`${blockedCount} blocked by security policy`);
    if (duplicateCount > 0) notes.push(`${duplicateCount} already in catalog`);
    const message =
      notes.length > 0
        ? `Imported ${insertedChannels.length} channels (${notes.join(', ')})`
        : `Successfully imported ${insertedChannels.length} channels`;

    res.json({
      success: true,
      message,
      count: insertedChannels.length,
      blockedCount,
      duplicateCount,
    });
  } catch (error) {
    console.error('Error importing M3U:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import M3U',
    });
  }
});

// Diagnostic: alternate streams stats
router.get('/channels/alternates-stats', async (req, res) => {
  try {
    const [stats] = await Channel.aggregate([
      { $match: { ownerId: null } }, // catalog only
      {
        $project: {
          hasAlternates: {
            $gt: [{ $size: { $ifNull: ['$alternateStreams', []] } }, 0],
          },
          alternateCount: { $size: { $ifNull: ['$alternateStreams', []] } },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          withAlternates: { $sum: { $cond: ['$hasAlternates', 1, 0] } },
          totalAlternateStreams: { $sum: '$alternateCount' },
        },
      },
    ]);
    res.json({
      success: true,
      data: stats
        ? {
            totalChannels: stats.total,
            channelsWithAlternates: stats.withAlternates,
            channelsWithoutAlternates: stats.total - stats.withAlternates,
            totalAlternateStreams: stats.totalAlternateStreams,
          }
        : {
            totalChannels: 0,
            channelsWithAlternates: 0,
            channelsWithoutAlternates: 0,
            totalAlternateStreams: 0,
          },
    });
  } catch (error) {
    console.error('Error fetching alternates stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch alternates stats' });
  }
});

// Get distinct filter options for channels
router.get('/channels/filter-options', async (req, res) => {
  try {
    const [groups, languages, countries] = await Promise.all([
      Channel.distinct('channelGroup', { ownerId: null }),
      Channel.distinct('metadata.language', { ownerId: null }),
      Channel.distinct('metadata.country', { ownerId: null }),
    ]);
    const statuses = ['Live', 'Dead', 'Untested'];

    res.json({
      success: true,
      data: {
        group: groups.filter(Boolean).sort((a, b) => a.localeCompare(b)),
        status: statuses,
        language: languages.filter(Boolean).sort((a, b) => a.localeCompare(b)),
        country: countries.filter(Boolean).sort((a, b) => a.localeCompare(b)),
      },
    });
  } catch (error) {
    console.error('Error fetching channel filter options:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch filter options' });
  }
});

// Get all channels (for admin) with server-side filtering & pagination
router.get('/channels', async (req, res) => {
  try {
    const { group, status, language, country, search, page, pageSize } = req.query;
    // Admins manage the shared catalog only — never users' private (owned) channels.
    const filter = { ownerId: null };

    // Multi-value group filter (comma-separated)
    if (group) {
      const groups = group
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);
      if (groups.length > 0) filter.channelGroup = { $in: groups };
    }

    // Language filter
    if (language) {
      const langs = language
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      if (langs.length > 0) filter['metadata.language'] = { $in: langs };
    }

    // Country filter
    if (country) {
      const countries = country
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (countries.length > 0) filter['metadata.country'] = { $in: countries };
    }

    // Text search across name and group
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ channelName: regex }, { channelGroup: regex }];
    }

    // Health breakdown snapshot: reflects the current context (group/language/
    // country/search) but deliberately ignores the status filter, so the
    // quick-filter counts stay meaningful when a status is selected.
    const healthFilter = { ...filter };

    // Status filter: Live = isWorking !== false, Dead = isWorking === false,
    // Untested = isWorking never set (matches missing/null). Multi-select → OR.
    if (status) {
      const statuses = status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const clauses = [];
      if (statuses.includes('Dead')) clauses.push({ 'metadata.isWorking': false });
      if (statuses.includes('Live')) clauses.push({ 'metadata.isWorking': { $ne: false } });
      if (statuses.includes('Untested')) clauses.push({ 'metadata.isWorking': { $nin: [true, false] } });
      if (clauses.length === 1) {
        Object.assign(filter, clauses[0]);
      } else if (clauses.length > 1 && clauses.length < 3) {
        // $and wrapper so we never clash with the search $or above.
        filter.$and = [{ $or: clauses }];
      }
      // Selecting all three statuses = show everything (no filter).
    }

    const p = Math.max(parseInt(page, 10) || 1, 1);
    const ps = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);

    // countDocuments on the catalog is expensive and identical across pages of the same
    // filter — cache it (short TTL, busted on catalog mutations) and run it alongside the find.
    const filterKey = JSON.stringify({ group, status, language, country, search });
    const countKey = `chcount:${filterKey}`;
    // Health ignores the status filter (see healthFilter above) — cache by context only.
    const healthKey = `chcount:health:${JSON.stringify({ group, language, country, search })}`;

    const [channels, totalCount, health] = await Promise.all([
      Channel.find(filter)
        .sort({ channelGroup: 1, order: 1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      (async () => {
        const cached = await statsCache.get(countKey);
        if (typeof cached === 'number') return cached;
        const fresh = await Channel.countDocuments(filter);
        await statsCache.set(countKey, fresh);
        return fresh;
      })(),
      (async () => {
        const cached = await statsCache.get(healthKey);
        if (cached) return cached;
        const agg = await Channel.aggregate([
          { $match: healthFilter },
          { $group: { _id: '$metadata.isWorking', n: { $sum: 1 } } },
        ]);
        const fresh = { working: 0, notWorking: 0, untested: 0 };
        for (const row of agg) {
          if (row._id === true) fresh.working += row.n;
          else if (row._id === false) fresh.notWorking += row.n;
          else fresh.untested += row.n;
        }
        await statsCache.set(healthKey, fresh);
        return fresh;
      })(),
    ]);

    res.json({
      success: true,
      count: channels.length,
      totalCount,
      health,
      page: p,
      pageSize: ps,
      data: channels,
    });
  } catch (error) {
    console.error('Error fetching channels:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch channels',
    });
  }
});

// ============ STATISTICS ============

// Detailed statistics endpoint
// ─── Device management (admin) ─────────────────────────────

// List registered devices with their owner, paginated + searchable.
router.get('/devices', async (req, res) => {
  try {
    const { search, page, pageSize, status } = req.query;
    const p = Math.max(parseInt(page, 10) || 1, 1);
    const ps = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
    const filter = {};
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: regex }, { deviceId: regex }, { platform: regex }];
    }
    if (status === 'active') filter.lastSeenAt = { $gte: new Date(Date.now() - 7 * 86400000) };
    if (status === 'stale') {
      filter.$or = [
        { lastSeenAt: { $lt: new Date(Date.now() - 7 * 86400000) } },
        { lastSeenAt: { $exists: false } },
        { lastSeenAt: null },
      ];
    }

    const [devices, totalCount, active7d, platforms, pendingPairings] = await Promise.all([
      Device.find(filter)
        .sort({ lastSeenAt: -1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      Device.countDocuments(filter),
      Device.countDocuments({ lastSeenAt: { $gte: new Date(Date.now() - 7 * 86400000) } }),
      Device.distinct('platform').then(
        (list) => list.filter((p) => typeof p === 'string' && p.trim() !== '').length,
      ),
      PairingRequest.countDocuments({ status: 'pending' }),
    ]);

    const stats = { active7d, platforms, pendingPairings };

    const userIds = devices.map((d) => d.userId).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } })
      .select('username email isActive')
      .lean();
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const data = devices.map((d) => ({
      _id: String(d._id),
      deviceId: d.deviceId,
      name: d.name || '',
      platform: d.platform || '',
      appVersion: d.appVersion || '',
      lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : null,
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      user: d.userId
        ? {
            _id: String(d.userId),
            username: userById.get(String(d.userId))?.username || '',
            email: userById.get(String(d.userId))?.email || '',
            isActive: userById.get(String(d.userId))?.isActive ?? true,
          }
        : null,
    }));

    res.json({ success: true, count: data.length, totalCount, page: p, pageSize: ps, data, stats });
  } catch (error) {
    console.error('Error listing devices:', error);
    res.status(500).json({ success: false, error: 'Failed to list devices' });
  }
});

// Unpair/remove a registered device (frees a device slot for the owner).
router.delete('/devices/:id', async (req, res) => {
  try {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }
    const id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid device id' });
    }
    const device = await Device.findByIdAndDelete(id);
    if (!device) return res.status(404).json({ success: false, error: 'Device not found' });

    audit({
      userId: req.user.id,
      action: 'device_unpair',
      resource: 'Device',
      resourceId: String(device._id),
      changes: { after: { deviceId: device.deviceId, userId: String(device.userId || '') } },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, message: 'Device unpaired', deviceId: device.deviceId });
  } catch (error) {
    console.error('Error unpairing device:', error);
    res.status(500).json({ success: false, error: 'Failed to unpair device' });
  }
});

// List pairing requests (admin visibility for pending flows).
router.get('/pairing-requests', async (req, res) => {
  try {
    const { page, pageSize, status } = req.query;
    const p = Math.max(parseInt(page, 10) || 1, 1);
    const ps = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
    const filter = {};
    if (status && status !== 'ALL') filter.status = status;

    const [requests, totalCount] = await Promise.all([
      PairingRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .populate('userId', 'username email')
        .lean(),
      PairingRequest.countDocuments(filter),
    ]);

    res.json({
      success: true,
      count: requests.length,
      totalCount,
      page: p,
      pageSize: ps,
      data: requests.map((r) => ({
        _id: String(r._id),
        pin: r.pin || '',
        deviceName: r.deviceName || '',
        deviceModel: r.deviceModel || '',
        status: r.status,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
        expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
        user: r.userId
          ? { _id: String(r.userId._id), username: r.userId.username || '', email: r.userId.email || '' }
          : null,
      })),
    });
  } catch (error) {
    console.error('Error listing pairing requests:', error);
    res.status(500).json({ success: false, error: 'Failed to list pairing requests' });
  }
});

// Revoke a pending pairing request (deleted immediately; audit trail kept).
// Marking it 'expired' would misreport to the TV during the TTL-delete window,
// so we remove the doc outright — the TV then sees "PIN not found" right away.
router.delete('/pairing-requests/:id', async (req, res) => {
  try {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }
    const id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid pairing request id' });
    }
    const reqDoc = await PairingRequest.findById(id);
    if (!reqDoc) return res.status(404).json({ success: false, error: 'Pairing request not found' });

    await PairingRequest.deleteOne({ _id: id });

    audit({
      userId: req.user.id,
      action: 'pairing_revoke',
      resource: 'PairingRequest',
      resourceId: String(reqDoc._id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, message: 'Pairing request revoked' });
  } catch (error) {
    console.error('Error revoking pairing request:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke pairing request' });
  }
});

// ─── Stats ────────────────────────────────────────────────

router.get('/stats/detailed', async (req, res) => {
  try {
    // Channel statistics
    const totalChannels = await Channel.countDocuments({ ownerId: null });
    const activeChannels = await Channel.countDocuments({ isActive: true, ownerId: null });
    const inactiveChannels = await Channel.countDocuments({ isActive: false, ownerId: null });
    const channelsByGroup = await Channel.aggregate([
      { $match: { ownerId: null } }, // catalog only
      { $group: { _id: '$channelGroup', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // App version statistics
    const totalVersions = await AppVersion.countDocuments();
    const latestVersion = await AppVersion.getLatestVersion();

    // User statistics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    const recentUsers = await User.find()
      .select('username email role profilePicture createdAt lastLogin')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Session statistics
    const now = new Date();
    const activeSessions = await Session.find({ expiresAt: { $gt: now } })
      .populate('userId', 'username email profilePicture')
      .sort({ lastActivity: -1 })
      .limit(20)
      .lean();

    const totalSessions = await Session.countDocuments();
    const activeSessionCount = await Session.countDocuments({ expiresAt: { $gt: now } });

    // Sessions by location (based on IP)
    const sessionsByLocation = await Session.aggregate([
      { $match: { expiresAt: { $gt: now } } },
      { $group: { _id: { $ifNull: ['$location', 'Unknown'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Pairing statistics
    const totalPairings = await PairingRequest.countDocuments();
    const pendingPairings = await PairingRequest.countDocuments({
      status: 'pending',
      expiresAt: { $gt: now },
    });
    const completedPairings = await PairingRequest.countDocuments({ status: 'completed' });

    // Today's pairings count
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayPairingsCount = await PairingRequest.countDocuments({
      createdAt: { $gte: startOfToday },
    });

    // Recent pairings
    const recentPairings = await PairingRequest.find()
      .populate('userId', 'username email')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Recent activity from audit log
    const auditLogs = await AuditLog.find()
      .populate('userId', 'username')
      .sort({ timestamp: -1 })
      .limit(15)
      .lean();

    const activities = auditLogs.map((log) => ({
      type: log.action,
      title: log.action,
      description: `${log.userId?.username || 'System'} — ${log.action.replace(/_/g, ' ')} (${log.resource}${log.resourceId ? ': ' + log.resourceId : ''})`,
      timestamp: log.timestamp,
    }));

    // Format active sessions with user info
    // Mask last octet of IPs and truncate User-Agent strings for privacy
    const maskIp = (ip) => {
      if (!ip) return 'Unknown';
      // Handle IPv4 (possibly embedded in IPv6 like ::ffff:1.2.3.4)
      const v4Match = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}/);
      if (v4Match) return ip.replace(/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}/, '$1.xxx');
      // For pure IPv6, mask the last segment
      const parts = ip.split(':');
      if (parts.length > 1) {
        parts[parts.length - 1] = 'xxxx';
        return parts.join(':');
      }
      return ip;
    };
    const truncateUa = (ua) => {
      if (!ua) return 'Unknown';
      return ua.length > 100 ? ua.substring(0, 100) + '...' : ua;
    };

    const formattedSessions = activeSessions.map((session) => ({
      username: session.userId?.username || session.username,
      email: session.userId?.email || session.email,
      profilePicture: session.userId?.profilePicture,
      lastActivity: session.lastActivity,
      ipAddress: maskIp(session.ipAddress),
      userAgent: truncateUa(session.userAgent),
      location: session.location || 'Unknown',
    }));

    // Format recent pairings with user info
    const formattedPairings = recentPairings.map((pairing) => ({
      deviceName: pairing.deviceName,
      deviceModel: pairing.deviceModel,
      status: pairing.status,
      username: pairing.userId?.username,
      createdAt: pairing.createdAt,
      pairedAt: pairing.updatedAt,
    }));

    res.json({
      success: true,
      data: {
        channels: {
          total: totalChannels,
          active: activeChannels,
          inactive: inactiveChannels,
          byGroup: channelsByGroup,
        },
        app: {
          totalVersions,
          latestVersion,
        },
        users: {
          total: totalUsers,
          active: activeUsers,
          recent: recentUsers,
        },
        sessions: {
          total: totalSessions,
          active: activeSessionCount,
          activeSessions: formattedSessions,
          byLocation: sessionsByLocation,
        },
        pairings: {
          total: totalPairings,
          pending: pendingPairings,
          completed: completedPairings,
          todayCount: todayPairingsCount,
          recent: formattedPairings,
        },
        activity: activities.slice(0, 15),
      },
    });
  } catch (error) {
    console.error('Error fetching detailed stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch detailed statistics',
    });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const totalChannels = await Channel.countDocuments({ ownerId: null });
    const activeChannels = await Channel.countDocuments({ isActive: true, ownerId: null });
    const inactiveChannels = await Channel.countDocuments({ isActive: false, ownerId: null });
    const channelsByGroup = await Channel.aggregate([
      { $match: { ownerId: null } }, // catalog only
      {
        $group: {
          _id: '$channelGroup',
          count: { $sum: 1 },
        },
      },
      {
        $sort: { count: -1 },
      },
    ]);

    const totalVersions = await AppVersion.countDocuments();
    const latestVersion = await AppVersion.getLatestVersion();

    res.json({
      success: true,
      data: {
        channels: {
          total: totalChannels,
          active: activeChannels,
          inactive: inactiveChannels,
          byGroup: channelsByGroup,
        },
        app: {
          totalVersions,
          latestVersion,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
    });
  }
});

// ============ STATS TRENDS ============

router.get('/stats/trends/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const range = req.query.range || '30d';

    const rangeMap = { '7d': 7, '30d': 30, '90d': 90 };
    const days = rangeMap[range] || 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    let model;
    let dateField;

    switch (type) {
      case 'users':
        model = User;
        dateField = 'createdAt';
        break;
      case 'sessions':
        model = Session;
        dateField = 'createdAt';
        break;
      case 'pairings':
        model = PairingRequest;
        dateField = 'createdAt';
        break;
      default:
        return res
          .status(400)
          .json({ success: false, error: 'Invalid trend type. Use: users, sessions, pairings' });
    }

    const pipeline = [
      { $match: { [dateField]: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: `$${dateField}` },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const results = await model.aggregate(pipeline);

    const dataMap = {};
    results.forEach((r) => {
      dataMap[r._id] = r.count;
    });

    const data = [];
    const cursor = new Date(startDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    while (cursor <= today) {
      const key = cursor.toISOString().slice(0, 10);
      data.push({ date: key, count: dataMap[key] || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching trend stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch trend statistics' });
  }
});

// ============ CHANNEL OPERATIONS ============

// Reconcile active catalog entries into logical channel identities. This is an
// admin-only operation and never returns stream URLs or source credentials.
router.post('/channel-identities/reconcile', async (req, res) => {
  try {
    const result = await reconcileChannelIdentities();
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error reconciling channel identities:', error);
    res.status(500).json({ success: false, error: 'Failed to reconcile channel identities' });
  }
});

// One compact control-plane payload for the admin dashboard. It combines the
// channel fleet, source synchronization, and EPG freshness without exposing
// encrypted credentials or stream URLs.
router.get('/stats/channel-operations', async (req, res) => {
  try {
    const [channelSummary, m3uSources, xtreamSources, epg, identities] = await Promise.all([
      Channel.aggregate([
        { $match: { ownerId: null } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $ne: ['$isActive', false] }, 1, 0] } },
            healthy: { $sum: { $cond: [{ $eq: ['$metadata.isWorking', true] }, 1, 0] } },
            failing: { $sum: { $cond: [{ $eq: ['$metadata.isWorking', false] }, 1, 0] } },
            unknown: { $sum: { $cond: [{ $eq: ['$metadata.isWorking', null] }, 1, 0] } },
            withFallback: {
              $sum: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ['$alternateStreams', []] } }, 0] },
                  1,
                  0,
                ],
              },
            },
            avgResponseTime: { $avg: '$metadata.responseTime' },
          },
        },
      ]).then((rows) => rows[0] || {
        total: 0,
        active: 0,
        healthy: 0,
        failing: 0,
        unknown: 0,
        withFallback: 0,
        avgResponseTime: null,
      }),
      M3USource.find({})
        .sort({ updatedAt: -1 })
        .select('name status syncStatus lastSyncAt lastError stats updatedAt')
        .lean(),
      XtreamSource.find({})
        .sort({ updatedAt: -1 })
        .select('name status syncStatus lastSyncAt lastError stats updatedAt')
        .lean(),
      epgService.getStats(),
      getChannelIdentityStats(),
    ]);

    res.json({
      success: true,
      data: {
        channels: channelSummary,
        sources: { m3u: m3uSources, xtream: xtreamSources },
        epg,
        identities,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching channel operations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch channel operations' });
  }
});

// EPG mapping diagnostics: coverage and unmatched channels per discovered source.
router.get('/stats/epg-coverage', async (_req, res) => {
  try {
    const coverage = await epgService.getCoverage();
    res.json({ success: true, data: coverage, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching EPG coverage:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch EPG coverage' });
  }
});

// Anonymous playback quality telemetry, aggregated by day for operations review.
router.get('/stats/playback-quality', async (req, res) => {
  try {
    const days = Number.parseInt(String(req.query.days || '7'), 10);
    const quality = await getPlaybackQualityStats(Number.isFinite(days) ? days : 7);
    res.json({ success: true, data: quality, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching playback quality stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch playback quality stats' });
  }
});

// ============ STREAM HEALTH ============

router.get('/stats/stream-health', async (req, res) => {
  try {
    // Channel health (local channels)
    const [channelHealth] = await Channel.aggregate([
      { $match: { ownerId: null } }, // catalog only
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          working: { $sum: { $cond: [{ $eq: ['$metadata.isWorking', true] }, 1, 0] } },
          failing: { $sum: { $cond: [{ $eq: ['$metadata.isWorking', false] }, 1, 0] } },
          untested: {
            $sum: { $cond: [{ $eq: ['$metadata.isWorking', null] }, 1, 0] },
          },
          avgResponseTime: { $avg: '$metadata.responseTime' },
          totalDeadCount: { $sum: { $ifNull: ['$metrics.deadCount', 0] } },
          totalAliveCount: { $sum: { $ifNull: ['$metrics.aliveCount', 0] } },
          totalUnresponsiveCount: { $sum: { $ifNull: ['$metrics.unresponsiveCount', 0] } },
          totalPlayCount: { $sum: { $ifNull: ['$metrics.playCount', 0] } },
          totalProxyPlayCount: { $sum: { $ifNull: ['$metrics.proxyPlayCount', 0] } },
        },
      },
    ]);

    // Streams ranked by failure frequency (top 10 most failing)
    const mostFailing = await Channel.find({ 'metrics.deadCount': { $gt: 0 }, ownerId: null })
      .sort({ 'metrics.deadCount': -1 })
      .limit(10)
      .select('channelId channelName channelGroup metrics')
      .lean();

    // Streams ranked by popularity (top 10 most played)
    const mostPopular = await Channel.find({ 'metrics.playCount': { $gt: 0 }, ownerId: null })
      .sort({ 'metrics.playCount': -1 })
      .limit(10)
      .select('channelId channelName channelGroup metrics')
      .lean();

    // Streams with high failures but zero plays (removal candidates)
    const removalCandidates = await Channel.find({
      'metrics.deadCount': { $gt: 0 },
      ownerId: null,
      $or: [{ 'metrics.playCount': { $exists: false } }, { 'metrics.playCount': 0 }],
    })
      .sort({ 'metrics.deadCount': -1 })
      .limit(10)
      .select('channelId channelName channelGroup metrics')
      .lean();

    // Streams with unresponsive issues
    const unresponsiveStreams = await Channel.find({
      'metrics.unresponsiveCount': { $gt: 0 },
      ownerId: null,
    })
      .sort({ 'metrics.unresponsiveCount': -1 })
      .limit(10)
      .select('channelId channelName channelGroup metrics')
      .lean();

    // External source health (aggregated per source)
    const externalHealth = await ExternalSourceChannel.aggregate([
      {
        $group: {
          _id: '$source',
          total: { $sum: 1 },
          alive: { $sum: { $cond: [{ $eq: ['$liveness.status', 'alive'] }, 1, 0] } },
          dead: { $sum: { $cond: [{ $eq: ['$liveness.status', 'dead'] }, 1, 0] } },
          unknown: { $sum: { $cond: [{ $eq: ['$liveness.status', 'unknown'] }, 1, 0] } },
          avgResponseTime: { $avg: '$liveness.responseTimeMs' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      data: {
        channels: channelHealth || {
          total: 0,
          working: 0,
          failing: 0,
          untested: 0,
          avgResponseTime: null,
          totalDeadCount: 0,
          totalAliveCount: 0,
          totalUnresponsiveCount: 0,
          totalPlayCount: 0,
          totalProxyPlayCount: 0,
        },
        metrics: {
          mostFailing,
          mostPopular,
          removalCandidates,
          unresponsiveStreams,
        },
        external: externalHealth,
      },
    });
  } catch (error) {
    console.error('Error fetching stream health:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stream health' });
  }
});

// ============ SCHEDULER HISTORY ============

router.get('/stats/scheduler', async (req, res) => {
  try {
    // Get the most recent run for each task
    const latestRuns = await ScheduledTaskRun.aggregate([
      { $sort: { startedAt: -1 } },
      {
        $group: {
          _id: '$taskName',
          lastRun: { $first: '$$ROOT' },
        },
      },
      { $replaceRoot: { newRoot: '$lastRun' } },
      { $sort: { startedAt: -1 } },
    ]);

    // Get success/fail counts per task (last 50 runs each)
    const taskStats = await ScheduledTaskRun.aggregate([
      { $sort: { startedAt: -1 } },
      {
        $group: {
          _id: '$taskName',
          totalRuns: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          avgDuration: { $avg: '$durationMs' },
        },
      },
    ]);

    const statsMap = {};
    taskStats.forEach((s) => {
      statsMap[s._id] = {
        totalRuns: s.totalRuns,
        completed: s.completed,
        failed: s.failed,
        avgDuration: s.avgDuration,
      };
    });

    const tasks = latestRuns.map((run) => ({
      taskName: run.taskName,
      lastStatus: run.status,
      lastStartedAt: run.startedAt,
      lastDurationMs: run.durationMs,
      lastError: run.error,
      ...(statsMap[run.taskName] || {}),
    }));

    res.json({ success: true, data: tasks });
  } catch (error) {
    console.error('Error fetching scheduler stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch scheduler stats' });
  }
});

// Business summary: activation codes, subscriptions, revenue, reseller credit.
// Gives the operator a quick read on sales without leaving the dashboard.
router.get('/business/summary', async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const plans = await Plan.find().select('name durationDays price currency status').lean();
    const planMap = new Map(plans.map((p) => [String(p._id), p]));

    // Codes activated this month / ever, grouped by plan. Revenue is counted
    // ONLY for operator-issued codes (resellerId null): reseller-issued codes
    // are paid via credit purchases / batch deliveries, so counting their
    // activations again would double-count operator income.
    const [activatedMonth, activatedTotal, generatedMonth, activeSubscriptions, resellers, purchasesMonth, purchasesTotal, adminActivatedMonth, adminActivatedTotal] =
      await Promise.all([
        ActivationCode.aggregate([
          { $match: { status: 'ACTIVATED', activatedAt: { $gte: monthStart } } },
          { $group: { _id: '$planId', count: { $sum: 1 } } },
        ]),
        ActivationCode.aggregate([
          { $match: { status: 'ACTIVATED' } },
          { $group: { _id: '$planId', count: { $sum: 1 } } },
        ]),
        ActivationCode.countDocuments({ createdAt: { $gte: monthStart } }),
        Subscription.countDocuments({ status: 'ACTIVE', expiresAt: { $gt: now } }),
        Reseller.find().select('credit status').lean(),
        // Credit top-ups actually paid by resellers (GRANT rows with positive
        // quantity — clawbacks/adjustments are negative and must NOT add money).
        CreditTransaction.aggregate([
          { $match: { type: 'GRANT', quantity: { $gt: 0 }, createdAt: { $gte: monthStart } } },
          { $group: { _id: null, value: { $sum: '$amount' } } },
        ]),
        CreditTransaction.aggregate([
          { $match: { type: 'GRANT', quantity: { $gt: 0 } } },
          { $group: { _id: null, value: { $sum: '$amount' } } },
        ]),
        ActivationCode.aggregate([
          { $match: { status: 'ACTIVATED', activatedAt: { $gte: monthStart }, resellerId: null } },
          { $group: { _id: '$planId', count: { $sum: 1 } } },
        ]),
        ActivationCode.aggregate([
          { $match: { status: 'ACTIVATED', resellerId: null } },
          { $group: { _id: '$planId', count: { $sum: 1 } } },
        ]),
      ]);

    // Remaining code credit per plan across active resellers.
    const creditByPlan = new Map();
    for (const r of resellers) {
      if (r.status !== 'Active') continue;
      for (const c of r.credit || []) {
        if (!c || !c.planId) continue;
        const key = String(c.planId);
        creditByPlan.set(key, (creditByPlan.get(key) || 0) + (Number(c.quantity) || 0));
      }
    }
    const activeResellers = resellers.filter((r) => r.status === 'Active').length;

    const buildRows = (agg) =>
      agg
        .map((a) => {
          const plan = planMap.get(String(a._id));
          if (!plan) return null;
          return {
            planId: String(a._id),
            planName: plan.name,
            count: a.count,
            price: plan.price || 0,
            currency: plan.currency || 'DZD',
            revenue: (plan.price || 0) * a.count,
          };
        })
        .filter(Boolean)
        .sort((x, y) => y.count - x.count);

    // byPlan rows cover the same revenue-generating activations as the
    // headline number: operator-issued codes only (reseller activations are
    // the reseller's retail income, not the operator's). The activations
    // cards keep the raw count of ALL activations.
    const byPlanThisMonth = buildRows(adminActivatedMonth);
    const byPlanTotal = buildRows(adminActivatedTotal);
    const activatedThisMonth = activatedMonth.reduce((s, a) => s + a.count, 0);
    const activatedTotalCount = activatedTotal.reduce((s, a) => s + a.count, 0);

    // Operator revenue = credit top-ups + batch deliveries + activations of
    // operator-issued codes (reseller-issued activations are the reseller's
    // retail income, not the operator's).
    const creditPurchasesThisMonth = purchasesMonth[0]?.value || 0;
    const creditPurchasesTotal = purchasesTotal[0]?.value || 0;

    // Batch deliveries (wholesale). Old batches may lack wholesaleTotal — fall
    // back to the reseller's current wholesale price for the plan.
    // Self-generated batches (reseller portal, createdBy unset) are EXCLUDED:
    // their cost is credit already counted as a GRANT purchase — counting them
    // again as a "delivery" would double-count the revenue.
    const [batches, deliveryResellers] = await Promise.all([
      CodeBatch.find({ status: 'delivered', createdBy: { $ne: null } })
        .select('resellerId planId quantity receiptDate wholesalePrice wholesaleTotal')
        .lean()
        .exec(),
      Reseller.find().select('prices').lean().exec(),
    ]);
    const priceByResellerPlan = new Map(
      deliveryResellers.map((r) => [
        String(r._id),
        new Map((r.prices || []).map((p) => [String(p.planId), Number(p.price) || 0])),
      ]),
    );
    const batchValue = (b) => {
      if (b.wholesaleTotal !== null && b.wholesaleTotal !== undefined && Number.isFinite(Number(b.wholesaleTotal))) {
        return Number(b.wholesaleTotal) || 0;
      }
      const price = priceByResellerPlan.get(String(b.resellerId))?.get(String(b.planId)) || 0;
      return price * (Number(b.quantity) || 0);
    };
    let deliveriesThisMonth = 0;
    let deliveriesTotal = 0;
    const deliveryValueByReseller = new Map();
    for (const b of batches) {
      const value = batchValue(b);
      deliveriesTotal += value;
      const key = String(b.resellerId);
      deliveryValueByReseller.set(key, (deliveryValueByReseller.get(key) || 0) + value);
      const receipt = b.receiptDate ? new Date(b.receiptDate) : null;
      if (receipt && receipt >= monthStart) deliveriesThisMonth += value;
    }

    const adminActivationRevenue = (agg) =>
      agg.reduce((s, a) => {
        const plan = planMap.get(String(a._id));
        return s + (plan ? (plan.price || 0) * a.count : 0);
      }, 0);
    const adminActivationRevenueThisMonth = adminActivationRevenue(adminActivatedMonth);
    const adminActivationRevenueTotal = adminActivationRevenue(adminActivatedTotal);

    const revenueThisMonthTotal = creditPurchasesThisMonth + deliveriesThisMonth + adminActivationRevenueThisMonth;
    const revenueTotalAll = creditPurchasesTotal + deliveriesTotal + adminActivationRevenueTotal;

    const creditByPlanRows = [...creditByPlan.entries()]
      .map(([planId, quantity]) => {
        const plan = planMap.get(planId);
        return plan ? { planId, planName: plan.name, quantity } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.quantity - a.quantity);
    const creditRemaining = creditByPlanRows.reduce((s, r) => s + r.quantity, 0);

    // Recent activations (last 10) — masked codes only, never plaintext.
    const recentActivations = await ActivationCode.find({ status: 'ACTIVATED', activatedAt: { $ne: null } })
      .sort({ activatedAt: -1 })
      .limit(10)
      .select('prefix codeLast4 planId resellerId activatedAt')
      .lean();
    const resellerNames = await Reseller.find({
      _id: { $in: [...new Set(recentActivations.map((c) => c.resellerId).filter(Boolean))] },
    })
      .select('name')
      .lean()
      .then((rows) => new Map(rows.map((r) => [String(r._id), r.name])));

    const recentData = recentActivations.map((c) => {
      const plan = planMap.get(String(c.planId));
      return {
        code: `${c.prefix}-••••-${c.codeLast4}`,
        planName: plan?.name || '—',
        price: plan?.price || 0,
        currency: plan?.currency || 'DZD',
        resellerName: c.resellerId ? resellerNames.get(String(c.resellerId)) || null : null,
        activatedAt: c.activatedAt,
      };
    });

    // Sales per reseller: activations (this month + total) + purchase value from ledger
    // (positive GRANT top-ups only) + wholesale batch deliveries.
    const [activByResellerMonth, activByResellerTotal, purchaseByReseller] = await Promise.all([
      ActivationCode.aggregate([
        { $match: { status: 'ACTIVATED', activatedAt: { $gte: monthStart }, resellerId: { $ne: null } } },
        { $group: { _id: '$resellerId', count: { $sum: 1 } } },
      ]),
      ActivationCode.aggregate([
        { $match: { status: 'ACTIVATED', resellerId: { $ne: null } } },
        { $group: { _id: '$resellerId', count: { $sum: 1 } } },
      ]),
      CreditTransaction.aggregate([
        { $match: { type: 'GRANT', quantity: { $gt: 0 } } },
        { $group: { _id: '$resellerId', value: { $sum: '$amount' } } },
      ]),
    ]);
    const resellerAgg = new Map();
    for (const a of activByResellerMonth) {
      const e = resellerAgg.get(String(a._id)) || { month: 0, total: 0, purchases: 0 };
      e.month = a.count;
      resellerAgg.set(String(a._id), e);
    }
    for (const a of activByResellerTotal) {
      const e = resellerAgg.get(String(a._id)) || { month: 0, total: 0, purchases: 0 };
      e.total = a.count;
      resellerAgg.set(String(a._id), e);
    }
    for (const p of purchaseByReseller) {
      const e = resellerAgg.get(String(p._id)) || { month: 0, total: 0, purchases: 0 };
      e.purchases += p.value;
      resellerAgg.set(String(p._id), e);
    }
    for (const [resellerId, value] of deliveryValueByReseller) {
      const e = resellerAgg.get(resellerId) || { month: 0, total: 0, purchases: 0 };
      e.purchases += value;
      resellerAgg.set(resellerId, e);
    }
    const resellerDocs = await Reseller.find({ _id: { $in: [...resellerAgg.keys()] } }).select('name city').lean();
    const resellerNameMap = new Map(resellerDocs.map((r) => [String(r._id), r]));
    const byReseller = [...resellerAgg.entries()]
      .map(([id, s]) => ({
        resellerId: id,
        name: resellerNameMap.get(id)?.name || '—',
        city: resellerNameMap.get(id)?.city || '',
        monthActivations: s.month,
        totalActivations: s.total,
        purchases: s.purchases,
      }))
      .sort((a, b) => b.totalActivations - a.totalActivations)
      .slice(0, 10);

    res.json({
      success: true,
      data: {
        asOf: now.toISOString(),
        summary: {
          activatedThisMonth,
          activatedTotal: activatedTotalCount,
          revenueThisMonth: revenueThisMonthTotal,
          revenueTotal: revenueTotalAll,
          revenueBreakdown: {
            creditPurchasesThisMonth,
            creditPurchasesTotal,
            batchDeliveriesThisMonth: deliveriesThisMonth,
            batchDeliveriesTotal: deliveriesTotal,
            activationsThisMonth: adminActivationRevenueThisMonth,
            activationsTotal: adminActivationRevenueTotal,
          },
          activeSubscriptions,
          activeResellers,
          creditRemaining,
          codesGeneratedThisMonth: generatedMonth,
          pricesSet: plans.some((p) => (p.price || 0) > 0),
        },
        byPlanThisMonth,
        byPlanTotal,
        creditByPlan: creditByPlanRows,
        recentActivations: recentData,
        byReseller,
      },
    });
  } catch (error) {
    console.error('Error fetching business summary:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch business summary' });
  }
});

module.exports = router;
