const express = require('express');
const mongoose = require('mongoose');
const M3USource = require('../models/M3USource');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx, redactSensitiveText } = require('../services/audit-log');
const {
  testM3UConnection,
  syncM3USource,
  previewM3USource,
  createM3USourceSecrets,
  decryptSecret,
} = require('../services/m3u-service');
const {
  rollbackSyncSnapshot,
  listSyncSnapshots,
} = require('../services/sync-snapshot-service');
const { encryptSecret } = require('../utils/crypto');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

function validateHttpUrl(value, fieldName) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${fieldName} must use http or https`);
  }
  return url.toString();
}

function publicShape(src) {
  return {
    _id: src._id,
    name: src.name,
    hasEpgUrl: Boolean(src.epgUrlEncrypted),
    status: src.status,
    directPlayback: src.directPlayback === true,
    healthStatus: src.healthStatus || 'OFFLINE',
    lastHttpStatus: src.lastHttpStatus ?? null,
    lastLatencyMs: src.lastLatencyMs ?? null,
    lastHealthCheckAt: src.lastHealthCheckAt ?? null,
    syncStatus: src.syncStatus,
    lastSyncAt: src.lastSyncAt,
    lastError: src.lastError,
    lastTestAt: src.lastTestAt,
    lastTestOk: src.lastTestOk,
    lastTestError: src.lastTestError,
    lastTestPlayableSampleCount: src.lastTestPlayableSampleCount,
    stats: src.stats,
    createdAt: src.createdAt,
  };
}

router.get('/', async (_req, res) => {
  try {
    const sources = await M3USource.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: sources.map(publicShape) });
  } catch (err) {
    console.error('[m3u] list error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, playlistUrl, epgUrl, directPlayback } = req.body || {};
    if (!name || !playlistUrl) {
      return res.status(400).json({ success: false, error: 'name and playlistUrl are required' });
    }

    const normalizedPlaylistUrl = validateHttpUrl(playlistUrl, 'playlistUrl');
    const normalizedEpgUrl = epgUrl ? validateHttpUrl(epgUrl, 'epgUrl') : null;
    const secrets = await createM3USourceSecrets(normalizedPlaylistUrl, normalizedEpgUrl);
    const source = await M3USource.create({
      name: String(name).trim(),
      ...secrets,
      status: 'Inactive',
      directPlayback: directPlayback === true,
    });

    audit({
      ...reqCtx(req),
      action: 'M3U_SOURCE_CREATE',
      resource: 'M3USource',
      resourceId: String(source._id),
    });
    return res.status(201).json({ success: true, data: publicShape(source.toObject()) });
  } catch (err) {
    const message = err.message || 'Internal Server Error';
    const status = message.includes('must be') ? 400 : 500;
    console.error('[m3u] create error:', err);
    return res.status(status).json({ success: false, error: status === 400 ? message : 'Internal Server Error' });
  }
});

router.post('/:id/test', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await M3USource.findById(id).lean();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    const result = await testM3UConnection(decryptSecret(source.playlistUrlEncrypted));
    await M3USource.findByIdAndUpdate(id, {
      $set: {
        lastTestAt: new Date(),
        lastTestOk: Boolean(result.ok && result.playableSampleCount > 0),
        lastTestError: result.ok && result.playableSampleCount > 0 ? null : (result.error || 'No playable sample returned by source'),
        lastTestPlayableSampleCount: Number(result.playableSampleCount || 0),
        healthStatus: result.playback?.healthStatus || 'INVALID_STREAM',
        lastHttpStatus: result.playback?.httpStatus ?? null,
        lastLatencyMs: result.playback?.latencyMs ?? null,
        lastHealthCheckAt: new Date(),
        status: result.ok && result.playableSampleCount > 0 ? 'Active' : 'Inactive',
      },
    }).exec();
    result.ok = Boolean(result.ok && result.playableSampleCount > 0);
    if (!result.ok && !result.error) result.error = 'No playable sample returned by source';
    audit({
      ...reqCtx(req),
      action: 'M3U_SOURCE_TEST',
      resource: 'M3USource',
      resourceId: String(id),
      status: result.ok ? 'success' : 'failure',
      changes: { after: { ok: result.ok, channelCount: result.channelCount } },
      errorMessage: result.error || undefined,
    });
    return res.json({ success: result.ok, data: result, error: result.error });
  } catch (err) {
    console.error('[m3u] test error:', redactSensitiveText(err));
    return res.status(500).json({ success: false, error: 'M3U test failed' });
  }
});

router.post('/:id/preview', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await M3USource.findById(id).lean();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    const result = await previewM3USource(String(id), String(req.user?.id || ''));
    audit({
      ...reqCtx(req),
      action: 'M3U_SOURCE_PREVIEW',
      resource: 'M3USource',
      resourceId: String(id),
      changes: { after: result.diff },
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[m3u] preview error:', redactSensitiveText(err));
    return res.status(500).json({ success: false, error: 'M3U preview failed' });
  }
});

router.get('/:id/snapshots', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const snapshots = await listSyncSnapshots('m3u', String(id), Number(req.query.limit) || 10);
    return res.json({ success: true, data: snapshots });
  } catch (err) {
    console.error('[m3u] snapshots error:', redactSensitiveText(err));
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
    if (result.sourceType !== 'm3u' || result.sourceId !== String(id)) {
      return res.status(409).json({ success: false, error: 'Snapshot does not belong to this source' });
    }
    audit({
      ...reqCtx(req),
      action: 'M3U_SOURCE_ROLLBACK',
      resource: 'M3USource',
      resourceId: String(id),
      changes: { after: { snapshotId: req.params.snapshotId, restoredChannels: result.restoredChannels } },
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[m3u] rollback error:', redactSensitiveText(err));
    return res.status(500).json({ success: false, error: 'M3U rollback failed' });
  }
});

router.post('/:id/sync', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await M3USource.findById(id).lean();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    syncM3USource(String(id))
      .then((result) => {
        audit({
          ...reqCtx(req),
          action: 'M3U_SOURCE_SYNC',
          resource: 'M3USource',
          resourceId: String(id),
          changes: { after: result.stats },
        });
      })
      .catch((err) => {
        audit({
          ...reqCtx(req),
          action: 'M3U_SOURCE_SYNC',
          resource: 'M3USource',
          resourceId: String(id),
          status: 'failure',
          errorMessage: err.message,
        });
        console.error(`[m3u] sync failed for ${id}:`, redactSensitiveText(err));
      });

    return res.json({ success: true, data: { syncing: true, message: 'Sync started' } });
  } catch (err) {
    console.error('[m3u] sync error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await M3USource.findById(id).exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    const { name, status, playlistUrl, epgUrl, directPlayback } = req.body || {};
    if (name !== undefined) source.name = String(name).trim();
    if (status !== undefined) source.status = status === 'Inactive' ? 'Inactive' : 'Active';
    if (directPlayback !== undefined) {
      source.directPlayback = directPlayback === true;
      audit({
        ...reqCtx(req),
        action: 'M3U_SOURCE_DIRECT_PLAYBACK',
        resource: 'M3USource',
        resourceId: String(id),
        changes: { after: { directPlayback: source.directPlayback } },
      });
    }
    if (playlistUrl !== undefined) {
      const normalized = validateHttpUrl(playlistUrl, 'playlistUrl');
      source.playlistUrlEncrypted = encryptSecret(normalized);
    }
    if (epgUrl !== undefined) {
      const normalized = epgUrl ? validateHttpUrl(epgUrl, 'epgUrl') : null;
      source.epgUrlEncrypted = normalized ? encryptSecret(normalized) : null;
    }
    await source.save();

    audit({ ...reqCtx(req), action: 'M3U_SOURCE_UPDATE', resource: 'M3USource', resourceId: String(id) });
    return res.json({ success: true, data: publicShape(source.toObject()) });
  } catch (err) {
    const message = err.message || 'Internal Server Error';
    const status = message.includes('must be') ? 400 : 500;
    console.error('[m3u] update error:', err);
    return res.status(status).json({ success: false, error: status === 400 ? message : 'Internal Server Error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await M3USource.findByIdAndDelete(id);
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    await require('../models/Channel').updateMany(
      { ownerId: null, 'metadata.m3uSourceId': String(id) },
      { $set: { isActive: false } },
    );
    audit({ ...reqCtx(req), action: 'M3U_SOURCE_DELETE', resource: 'M3USource', resourceId: String(id) });
    return res.json({ success: true });
  } catch (err) {
    console.error('[m3u] delete error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
