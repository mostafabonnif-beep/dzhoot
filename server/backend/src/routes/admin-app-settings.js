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

module.exports = router;
