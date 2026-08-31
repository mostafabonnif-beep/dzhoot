const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const XtreamSource = require('../models/XtreamSource');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx, redactSensitiveText } = require('../services/audit-log');
const {
  testXtreamConnection,
  verifyXtreamSource,
  syncXtreamSource,
  previewXtreamSource,
  encryptSecret,
  decryptSecret,
} = require('../services/xtream-service');
const {
  rollbackSyncSnapshot,
  listSyncSnapshots,
} = require('../services/sync-snapshot-service');
const ChannelFailoverMap = require('../models/ChannelFailoverMap');
const Channel = require('../models/Channel');
const { autoMatchFailoverMaps, getSourceHealth, runSourceWatchdog } = require('../services/source-failover-service');

// Admin-only Xtream source management: /api/v1/admin/xtream-sources
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

/** Validate and normalize mirrorServerUrls → array of clean http(s) URLs, or null if invalid. */
function normalizeMirrorUrls(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let url;
    try {
      url = new URL(raw.trim());
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol)) return null;
    out.push(url.toString().replace(/\/+$/, ''));
  }
  return out;
}

function publicShape(src) {
  return {
    _id: src._id,
    name: src.name,
    serverUrl: src.serverUrl,
    mirrorServerUrls: src.mirrorServerUrls || [],
    hasCredentials: !!(src.usernameEncrypted && src.passwordEncrypted),
    status: src.status,
    verificationStatus: src.verificationStatus || 'pending',
    playbackFormat: src.playbackFormat || null,
    syncStatus: src.syncStatus,
    lastSyncAt: src.lastSyncAt,
    catalogOnlyImportedAt: src.catalogOnlyImportedAt || null,
    customerVisible: src.customerVisible === true,
    directPlayback: src.directPlayback === true,
    mergeCatalog: src.mergeCatalog === true,
    failoverPriority: Number(src.failoverPriority) || 20,
    lastError: src.lastError,
    lastDiagnosticsAt: src.lastDiagnosticsAt,
    verifiedAt: src.verifiedAt,
    stats: src.stats,
    createdAt: src.createdAt,
  };
}

// GET / — list sources
router.get('/', async (req, res) => {
  try {
    const sources = await XtreamSource.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: sources.map(publicShape) });
  } catch (err) {
    console.error('[xtream] list error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST / — create a source (credentials are encrypted at rest)
router.post('/', async (req, res) => {
  try {
    const { name, serverUrl, mirrorServerUrls, username, password } = req.body || {};
    if (!name || !serverUrl || !username || !password) {
      return res.status(400).json({ success: false, error: 'name, serverUrl, username and password are required' });
    }
    let url;
    try {
      url = new URL(serverUrl);
    } catch {
      return res.status(400).json({ success: false, error: 'serverUrl must be a valid URL' });
    }
    if (!/^https?:$/.test(url.protocol)) {
      return res.status(400).json({ success: false, error: 'serverUrl must use http or https' });
    }
    const mirrors = normalizeMirrorUrls(mirrorServerUrls);
    if (mirrors === null) {
      return res.status(400).json({ success: false, error: 'mirrorServerUrls must be an array of valid http(s) URLs' });
    }

    const source = await XtreamSource.create({
      name: String(name).trim(),
      // Keep the full normalized URL — some panels are served under a subpath
      // (http://host:8080/iptv/) and url.origin would silently break player_api.
      serverUrl: url.toString().replace(/\/+$/, ''),
      mirrorServerUrls: mirrors,
      usernameEncrypted: encryptSecret(String(username)),
      passwordEncrypted: encryptSecret(String(password)),
      status: 'Inactive',
      verificationStatus: 'pending',
    });

    audit({ ...reqCtx(req), action: 'XTREAM_SOURCE_CREATE', resource: 'XtreamSource', resourceId: String(source._id) });
    verifyXtreamSource(String(source._id)).catch(async (err) => {
      console.error('[xtream] automatic verification failed:', redactSensitiveText(err));
      await XtreamSource.findByIdAndUpdate(source._id, {
        $set: {
          status: 'Inactive',
          verificationStatus: 'blocked',
          lastError: 'Automatic verification failed',
        },
      }).catch(() => undefined);
    });
    return res.status(201).json({ success: true, data: publicShape(source.toObject()) });
  } catch (err) {
    console.error('[xtream] create error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/test — verify credentials
router.post('/:id/test', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    const { testXtreamConnection: test } = require('../services/xtream-service');
    const { decryptSecret } = require('../services/xtream-service');
    const result = await test({
      serverUrl: source.serverUrl,
      username: decryptSecret(source.usernameEncrypted),
      password: decryptSecret(source.passwordEncrypted),
    });
    audit({
      ...reqCtx(req),
      action: 'XTREAM_SOURCE_TEST',
      resource: 'XtreamSource',
      resourceId: String(id),
      status: result.ok ? 'success' : 'failure',
      changes: { after: { ok: result.ok } },
      errorMessage: result.error || undefined,
    });
    return res.json({ success: result.ok, data: result.ok ? { userInfo: result.userInfo } : null, error: result.error });
  } catch (err) {
    const safeError = redactSensitiveText(err);
    console.error('[xtream] test error:', safeError);
    return res.status(500).json({ success: false, error: safeError || 'Test failed' });
  }
});

// POST /:id/diagnostics — verify API metadata, M3U access and actual live playback
router.post('/:id/diagnostics', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    const sample = Math.min(Math.max(Number(req.body?.sampleLimit) || 3, 1), 20);
    const result = await verifyXtreamSource(String(id), sample);

    audit({
      ...reqCtx(req),
      action: 'XTREAM_SOURCE_DIAGNOSTICS',
      resource: 'XtreamSource',
      resourceId: String(id),
      status: result.api.ok && result.live.alive > 0 ? 'success' : 'failure',
      changes: { after: { apiOk: result.api.ok, m3u: result.m3u.status, live: result.live } },
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[xtream] diagnostics error:', redactSensitiveText(err));
    return res.status(500).json({ success: false, error: 'Xtream diagnostics failed' });
  }
});

// POST /:id/preview — preview live-channel changes without applying them
router.post('/:id/preview', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).lean();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });
    const result = await previewXtreamSource(String(id), String(req.user?.id || ''));
    audit({
      ...reqCtx(req),
      action: 'XTREAM_SOURCE_PREVIEW',
      resource: 'XtreamSource',
      resourceId: String(id),
      changes: { after: result.diff },
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[xtream] preview error:', redactSensitiveText(err));
    return res.status(500).json({ success: false, error: 'Xtream preview failed' });
  }
});

router.get('/:id/snapshots', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const snapshots = await listSyncSnapshots('xtream', String(id), Number(req.query.limit) || 10);
    return res.json({ success: true, data: snapshots });
  } catch (err) {
    console.error('[xtream] snapshots error:', redactSensitiveText(err));
    return res.status(500).json({ success: false, error: 'Failed to fetch sync snapshots' });
  }
});

router.post('/:id/rollback/:snapshotId', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id || !mongoose.Types.ObjectId.isValid(req.params.snapshotId)) {
      return res.status(400).json({ success: false, error: 'Invalid source or snapshot id' });
    }
    const result = await rollbackSyncSnapshot(req.params.snapshotId);
    if (result.sourceType !== 'xtream' || result.sourceId !== String(id)) {
      return res.status(409).json({ success: false, error: 'Snapshot does not belong to this source' });
    }
    audit({
      ...reqCtx(req),
      action: 'XTREAM_SOURCE_ROLLBACK',
      resource: 'XtreamSource',
      resourceId: String(id),
      changes: { after: { snapshotId: req.params.snapshotId, restoredChannels: result.restoredChannels } },
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[xtream] rollback error:', redactSensitiveText(err));
    return res.status(500).json({ success: false, error: 'Xtream rollback failed' });
  }
});

// POST /:id/sync — run a full sync (live → channels, vod → movies, series → series)
router.post('/:id/sync', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });
    if (source.status !== 'Active' || source.verificationStatus !== 'verified') {
      return res.status(409).json({
        success: false,
        error: 'Source must pass live playback verification before synchronization',
        code: 'SOURCE_NOT_VERIFIED',
      });
    }

    // Run in background so the request returns immediately (long operation).
    syncXtreamSource(String(id))
      .then((result) => {
        audit({
          ...reqCtx(req),
          action: 'XTREAM_SOURCE_SYNC',
          resource: 'XtreamSource',
          resourceId: String(id),
          changes: { after: result.stats },
        });
      })
      .catch((err) => {
        audit({
          ...reqCtx(req),
          action: 'XTREAM_SOURCE_SYNC',
          resource: 'XtreamSource',
          resourceId: String(id),
          status: 'failure',
          errorMessage: err.message,
        });
        console.error(`[xtream] sync failed for ${id}:`, redactSensitiveText(err));
      });

    return res.json({ success: true, data: { syncing: true, message: 'Sync started' } });
  } catch (err) {
    console.error('[xtream] sync error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/import-catalog — import catalog metadata (channels/movies/series) even when
// live playback verification could not pass (e.g. panel blocks the server IP with 456/401).
// The catalog is imported so the admin can manage/preview it, but the source is NOT
// activated: playback stays unverified and the normal sync gate still applies.
router.post('/:id/import-catalog', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });
    if (source.verificationStatus === 'blocked') {
      return res.status(409).json({
        success: false,
        error: 'Source API is blocked; catalog import cannot proceed',
        code: 'SOURCE_BLOCKED',
      });
    }
    if (source.syncStatus === 'syncing') {
      return res.status(409).json({ success: false, error: 'Sync already in progress' });
    }

    // Runs in background; the request returns immediately (long operation).
    syncXtreamSource(String(id), { allowCatalogOnly: true })
      .then((result) => {
        audit({
          ...reqCtx(req),
          action: 'XTREAM_SOURCE_CATALOG_IMPORT',
          resource: 'XtreamSource',
          resourceId: String(id),
          changes: { after: result.stats, note: 'catalog-only import; playback not verified' },
        });
      })
      .catch((err) => {
        audit({
          ...reqCtx(req),
          action: 'XTREAM_SOURCE_CATALOG_IMPORT',
          resource: 'XtreamSource',
          resourceId: String(id),
          status: 'failure',
          errorMessage: err.message,
        });
        console.error(`[xtream] catalog-only import failed for ${id}:`, redactSensitiveText(err));
      });

    return res.json({
      success: true,
      data: { syncing: true, message: 'Catalog-only import started (playback not verified)' },
    });
  } catch (err) {
    console.error('[xtream] catalog import error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PATCH /:id — update name/status (credentials optional)
router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    const { name, status, serverUrl, mirrorServerUrls, username, password, customerVisible, directPlayback, mergeCatalog, failoverPriority } = req.body || {};
    if (name !== undefined) source.name = String(name).trim();
    if (serverUrl !== undefined) {
      if (!serverUrl) return res.status(400).json({ success: false, error: 'serverUrl cannot be empty' });
      let url;
      try {
        url = new URL(serverUrl);
      } catch {
        return res.status(400).json({ success: false, error: 'serverUrl must be a valid URL' });
      }
      if (!/^https?:$/.test(url.protocol)) {
        return res.status(400).json({ success: false, error: 'serverUrl must use http or https' });
      }
      // Keep the full normalized URL — panels served under a subpath (e.g.
      // http://host:8080/iptv/) would break if we stored only url.origin.
      source.serverUrl = url.toString().replace(/\/+$/, '');
    }
    if (mirrorServerUrls !== undefined) {
      const mirrors = normalizeMirrorUrls(mirrorServerUrls);
      if (mirrors === null) {
        return res.status(400).json({ success: false, error: 'mirrorServerUrls must be an array of valid http(s) URLs' });
      }
      source.mirrorServerUrls = mirrors;
    }
    if (customerVisible !== undefined) {
      source.customerVisible = customerVisible === true;
      // Explicit operator decision — audit it so the choice is traceable.
      audit({
        ...reqCtx(req),
        action: 'XTREAM_SOURCE_VISIBILITY',
        resource: 'XtreamSource',
        resourceId: String(id),
        changes: { after: { customerVisible: source.customerVisible } },
      });
    }
    if (directPlayback !== undefined) {
      source.directPlayback = directPlayback === true;
      audit({
        ...reqCtx(req),
        action: 'XTREAM_SOURCE_DIRECT_PLAYBACK',
        resource: 'XtreamSource',
        resourceId: String(id),
        changes: { after: { directPlayback: source.directPlayback } },
      });
    }
    if (mergeCatalog !== undefined) {
      source.mergeCatalog = mergeCatalog === true;
      audit({
        ...reqCtx(req),
        action: 'XTREAM_SOURCE_MERGE_CATALOG',
        resource: 'XtreamSource',
        resourceId: String(id),
        changes: { after: { mergeCatalog: source.mergeCatalog } },
      });
    }
    if (failoverPriority !== undefined) {
      const p = Number(failoverPriority);
      if (!Number.isFinite(p) || p < 1) {
        return res.status(400).json({ success: false, error: 'failoverPriority must be a positive number' });
      }
      source.failoverPriority = p;
    }
    const credentialsChanged = username !== undefined || password !== undefined;
    if (credentialsChanged) {
      source.usernameEncrypted = encryptSecret(String(username ?? decryptSecret(source.usernameEncrypted)));
      source.passwordEncrypted = encryptSecret(String(password ?? decryptSecret(source.passwordEncrypted)));
      source.status = 'Inactive';
      source.verificationStatus = 'pending';
      source.lastError = null;
    } else if (status !== undefined) {
      if (status === 'Active' && source.verificationStatus !== 'verified') {
        return res.status(409).json({ success: false, error: 'Run diagnostics successfully before activating this source', code: 'SOURCE_NOT_VERIFIED' });
      }
      source.status = status === 'Inactive' ? 'Inactive' : 'Active';
    }
    await source.save();
    if (credentialsChanged) verifyXtreamSource(String(id)).catch((err) => console.error('[xtream] re-verification failed:', redactSensitiveText(err)));

    audit({ ...reqCtx(req), action: 'XTREAM_SOURCE_UPDATE', resource: 'XtreamSource', resourceId: String(id) });
    return res.json({ success: true, data: publicShape(source.toObject()) });
  } catch (err) {
    console.error('[xtream] update error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findByIdAndDelete(id).exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });
    audit({ ...reqCtx(req), action: 'XTREAM_SOURCE_DELETE', resource: 'XtreamSource', resourceId: String(id) });
    return res.json({ success: true });
  } catch (err) {
    console.error('[xtream] delete error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ── Backup-source failover maps ──────────────────────────────────────────────
// The backup source (e.g. ottstreambox) is added as an XtreamSource with
// status Inactive + directPlayback true. These routes manage the side map that
// lets the playback-token flow serve a catalog channel from the backup when the
// primary source is down.

// GET /:id/failover-maps — list this source's failover mappings
router.get('/:id/failover-maps', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const maps = await ChannelFailoverMap.find({ backupSourceId: id })
      .sort({ updatedAt: -1 })
      .limit(500)
      .populate('channelId', 'channelName channelGroup')
      .lean()
      .exec();
    return res.json({ success: true, data: maps, totalCount: maps.length });
  } catch (err) {
    console.error('[xtream] failover maps list error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/failover-maps — create one mapping { channelRef | channelId, backupStreamId, backupChannelName }
router.post('/:id/failover-maps', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).lean().exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    const { channelRef, channelId, backupStreamId, backupChannelName, enabled } = req.body || {};
    const streamId = String(backupStreamId || '').trim();
    const name = String(backupChannelName || '').trim();
    if (!streamId || !name) {
      return res.status(400).json({ success: false, error: 'backupStreamId and backupChannelName are required' });
    }

    let channelDoc = null;
    let ref = String(channelRef || '').trim();
    if (channelId && mongoose.isValidObjectId(channelId)) {
      channelDoc = await Channel.findById(channelId).select('channelId channelName').lean().exec();
      if (channelDoc) ref = String(channelDoc.channelId);
    }
    if (!ref) return res.status(400).json({ success: false, error: 'channelRef or channelId is required' });
    if (!channelDoc) channelDoc = await Channel.findOne({ channelId: ref }).select('channelId channelName').lean().exec();
    if (!channelDoc) return res.status(404).json({ success: false, error: 'Catalog channel not found' });

    const map = await ChannelFailoverMap.findOneAndUpdate(
      { channelRef: ref, backupSourceId: id },
      {
        $set: {
          channelId: channelDoc._id,
          backupChannelName: name,
          backupStreamId: streamId,
          enabled: enabled !== false,
          matchedBy: 'manual',
        },
      },
      { upsert: true, new: true },
    ).exec();

    audit({
      ...reqCtx(req),
      action: 'FAILOVER_MAP_CREATE',
      resource: 'ChannelFailoverMap',
      resourceId: String(map._id),
      changes: { after: { channelRef: ref, backupStreamId: streamId, backupSourceId: String(id) } },
    });
    return res.status(201).json({ success: true, data: map });
  } catch (err) {
    console.error('[xtream] failover map create error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// DELETE /:id/failover-maps/:mapId — remove one mapping
router.delete('/:id/failover-maps/:mapId', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const mapId = parseId(req.params.mapId);
    if (!id || !mapId) return res.status(400).json({ success: false, error: 'Invalid id' });
    const map = await ChannelFailoverMap.findOneAndDelete({ _id: mapId, backupSourceId: id }).exec();
    if (!map) return res.status(404).json({ success: false, error: 'Failover map not found' });
    audit({ ...reqCtx(req), action: 'FAILOVER_MAP_DELETE', resource: 'ChannelFailoverMap', resourceId: String(mapId) });
    return res.json({ success: true });
  } catch (err) {
    console.error('[xtream] failover map delete error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/failover-maps/auto-match — match backup live streams to catalog
// channels by normalized name and bulk-create maps (never imports 115k raw).
router.post('/:id/failover-maps/auto-match', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).lean().exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    const { limit, nameContains, categories } = req.body || {};
    const result = await autoMatchFailoverMaps(String(id), {
      limit: limit ? Number(limit) : undefined,
      nameContains: nameContains ? String(nameContains) : undefined,
      categories: Array.isArray(categories) ? categories.map((c) => String(c)) : undefined,
    });
    audit({
      ...reqCtx(req),
      action: 'FAILOVER_MAP_AUTO_MATCH',
      resource: 'ChannelFailoverMap',
      changes: { after: result },
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[xtream] failover auto-match error:', err);
    return res.status(500).json({ success: false, error: `Auto-match failed: ${err?.message || 'Internal Error'}` });
  }
});

// GET /:id/health — cached watchdog health of one source
router.get('/:id/health', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).lean().exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });
    const health = await getSourceHealth(String(id));
    return res.json({
      success: true,
      data: {
        sourceId: String(id),
        health,
        verificationStatus: source.verificationStatus,
        status: source.status,
        lastError: source.lastError,
        lastDiagnosticsAt: source.lastDiagnosticsAt,
        mappedChannels: await ChannelFailoverMap.countDocuments({ backupSourceId: id, enabled: true }),
      },
    });
  } catch (err) {
    console.error('[xtream] health error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /watchdog/run — manually trigger the source watchdog (admin)
router.post('/watchdog/run', async (req, res) => {
  try {
    const result = await runSourceWatchdog();
    audit({ ...reqCtx(req), action: 'SOURCE_WATCHDOG_RUN', resource: 'XtreamSource', changes: { after: result } });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[xtream] watchdog run error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
