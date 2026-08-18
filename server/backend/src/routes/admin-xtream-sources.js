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

// Admin-only Xtream source management: /api/v1/admin/xtream-sources
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

function publicShape(src) {
  return {
    _id: src._id,
    name: src.name,
    serverUrl: src.serverUrl,
    hasCredentials: !!(src.usernameEncrypted && src.passwordEncrypted),
    status: src.status,
    verificationStatus: src.verificationStatus || 'pending',
    playbackFormat: src.playbackFormat || null,
    syncStatus: src.syncStatus,
    lastSyncAt: src.lastSyncAt,
    catalogOnlyImportedAt: src.catalogOnlyImportedAt || null,
    customerVisible: src.customerVisible === true,
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
    const { name, serverUrl, username, password } = req.body || {};
    if (!name || !serverUrl || !username || !password) {
      return res.status(400).json({ success: false, error: 'name, serverUrl, username and password are required' });
    }
    let url;
    try {
      url = new URL(serverUrl);
    } catch {
      return res.status(400).json({ success: false, error: 'serverUrl must be a valid URL' });
    }

    const source = await XtreamSource.create({
      name: String(name).trim(),
      serverUrl: url.origin,
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

    const result = await verifyXtreamSource(String(id), Number(req.body?.sampleLimit) || 3);

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

    const { name, status, username, password, customerVisible } = req.body || {};
    if (name !== undefined) source.name = String(name).trim();
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

module.exports = router;
