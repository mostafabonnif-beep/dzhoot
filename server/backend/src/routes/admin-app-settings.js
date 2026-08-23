const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AppSetting = require('../models/AppSetting');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx } = require('../services/audit-log');

// Admin-only runtime settings (key/value): /api/v1/admin/app-settings
router.use(requireAuth);
router.use(requireAdmin);

const KNOWN_KEYS = new Set([
  'subscription_required',
  'home',
  'app',
]);

function sanitize(key, value) {
  if (key === 'subscription_required') return !!value;
  return value;
}

// GET / — all settings
router.get('/', async (req, res) => {
  try {
    const settings = await AppSetting.find().lean();
    const out = {};
    for (const s of settings) out[s.key] = s.value;
    return res.json({ success: true, data: out });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PUT / — upsert one or more settings
router.put('/', async (req, res) => {
  try {
    const body = req.body || {};
    const keys = Object.keys(body).filter((k) => KNOWN_KEYS.has(k));
    if (keys.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid settings provided' });
    }

    const saved = {};
    for (const key of keys) {
      const value = sanitize(key, body[key]);
      const doc = await AppSetting.findOneAndUpdate(
        { key },
        { $set: { value, updatedBy: req.user.id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).exec();
      saved[key] = doc.value;
    }

    audit({ ...reqCtx(req), action: 'APP_SETTINGS_UPDATE', resource: 'AppSetting', changes: { after: saved } });
    return res.json({ success: true, data: saved });
  } catch (err) {
    console.error('[app-settings] update error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Internal/App keys that hold operational state (scheduler pauses, caches,
// flags) rather than configuration. Export/import covers everything EXCEPT
// these so a backup snapshot doesn't silently resurrect paused tasks or
// overwrite live state on restore.
const EXCLUDED_PREFIX = 'scheduler_enabled_';
const EXCLUDED_KEYS = new Set(['app']);

// GET /export — download all operator-configurable settings as a JSON backup.
router.get('/export', async (req, res) => {
  try {
    const settings = await AppSetting.find().lean();
    const out = {};
    for (const s of settings) {
      if (s.key.startsWith(EXCLUDED_PREFIX) || EXCLUDED_KEYS.has(s.key)) continue;
      out[s.key] = s.value;
    }
    audit({ ...reqCtx(req), action: 'APP_SETTINGS_EXPORT', resource: 'AppSetting', changes: { after: { keys: Object.keys(out) } } });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dzhoot-settings-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.send(JSON.stringify({ exportedAt: new Date().toISOString(), settings: out }, null, 2));
  } catch (err) {
    console.error('[app-settings] export error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /import — restore settings from a JSON backup.
// Accepts either the raw settings object or the full export payload
// ({ settings: {...} }). Unknown keys are skipped, never written.
router.post('/import', async (req, res) => {
  try {
    const payload = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ success: false, error: 'Invalid settings payload' });
    }

    const keys = Object.keys(payload).filter(
      (k) => KNOWN_KEYS.has(k) && !EXCLUDED_KEYS.has(k) && !k.startsWith(EXCLUDED_PREFIX),
    );
    if (keys.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid settings found in payload' });
    }

    const saved = {};
    for (const key of keys) {
      const value = sanitize(key, payload[key]);
      const doc = await AppSetting.findOneAndUpdate(
        { key },
        { $set: { value, updatedBy: req.user.id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).exec();
      saved[key] = doc.value;
    }

    audit({ ...reqCtx(req), action: 'APP_SETTINGS_IMPORT', resource: 'AppSetting', changes: { after: saved } });
    return res.json({ success: true, data: saved, importedKeys: keys });
  } catch (err) {
    console.error('[app-settings] import error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
