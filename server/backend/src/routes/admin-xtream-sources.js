const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const XtreamSource = require('../models/XtreamSource');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx, redactSensitiveText } = require('../services/audit-log');
const { testXtreamConnection, syncXtreamSource, encryptSecret } = require('../services/xtream-service');

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
    syncStatus: src.syncStatus,
    lastSyncAt: src.lastSyncAt,
    lastError: src.lastError,
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
      status: 'Active',
    });

    audit({ ...reqCtx(req), action: 'XTREAM_SOURCE_CREATE', resource: 'XtreamSource', resourceId: String(source._id) });
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

// POST /:id/sync — run a full sync (live → channels, vod → movies, series → series)
router.post('/:id/sync', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

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

// PATCH /:id — update name/status (credentials optional)
router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid source id' });
    const source = await XtreamSource.findById(id).exec();
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });

    const { name, status, username, password } = req.body || {};
    if (name !== undefined) source.name = String(name).trim();
    if (status !== undefined) source.status = status === 'Inactive' ? 'Inactive' : 'Active';
    if (username !== undefined) source.usernameEncrypted = encryptSecret(String(username));
    if (password !== undefined) source.passwordEncrypted = encryptSecret(String(password));
    await source.save();

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
