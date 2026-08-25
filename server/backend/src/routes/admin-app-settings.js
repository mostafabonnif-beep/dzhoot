const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AppSetting = require('../models/AppSetting');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx } = require('../services/audit-log');
const { sendOperationalAlert } = require('../services/alert-notifier');
const { sendEmail } = require('../services/email');

// Admin-only runtime settings (key/value): /api/v1/admin/app-settings
router.use(requireAuth);
router.use(requireAdmin);

const KNOWN_KEYS = new Set([
  'subscription_required',
  'home',
  'app',
  'code_expiry_days',
  'alert_webhook_url',
  'brevo_user',
  'brevo_password',
  'mail_from',
]);

function sanitize(key, value) {
  if (key === 'subscription_required') return !!value;
  if (key === 'code_expiry_days') {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : 30;
  }
  if (key === 'alert_webhook_url') return String(value || '').trim().slice(0, 500);
  if (key === 'brevo_user') return String(value || '').trim().slice(0, 200);
  if (key === 'brevo_password') return String(value || '').trim().slice(0, 300);
  if (key === 'mail_from') return String(value || '').trim().slice(0, 200);
  return value;
}

// GET / — all settings (SMTP password never returned; only a configured flag)
router.get('/', async (req, res) => {
  try {
    const settings = await AppSetting.find().lean();
    const out = {};
    for (const s of settings) {
      if (s.key === 'brevo_password') {
        out.brevo_configured = Boolean(String(s.value || '').trim());
        continue;
      }
      out[s.key] = s.value;
    }
    if (out.brevo_configured === undefined) out.brevo_configured = false;
    return res.json({ success: true, data: out });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PUT / — upsert one or more settings
router.put('/', async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    // Empty password means "keep the existing one" — never overwrite with ''.
    if (body.brevo_password === '' || body.brevo_password === undefined) {
      delete body.brevo_password;
    }
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

    // Never echo the SMTP password back — same masking rule as GET /.
    if ('brevo_password' in saved) {
      saved.brevo_configured = Boolean(String(saved.brevo_password || '').trim());
      delete saved.brevo_password;
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
      // The SMTP password never leaves the server — even in a settings backup
      // the operator may share with someone or store off-box. Export a flag.
      if (s.key === 'brevo_password') {
        out.brevo_configured = Boolean(String(s.value || '').trim());
        continue;
      }
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

// POST /test-alert — fire a test operational alert to the configured webhook.
router.post('/test-alert', async (req, res) => {
  try {
    const sent = await sendOperationalAlert({
      event: 'test-alert',
      severity: 'warning',
      message: 'اختبار التنبيهات من لوحة التحكم — تم الإرسال بنجاح',
    });
    if (!sent) {
      return res.status(400).json({ success: false, error: 'لم يُرسل التنبيه — تحقق من رابط الـ webhook في الإعدادات' });
    }
    audit({ ...reqCtx(req), action: 'APP_SETTINGS_TEST_ALERT', resource: 'AppSetting' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[app-settings] test-alert error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /test-email — send a test email to the configured MAIL_FROM address.
router.post('/test-email', async (req, res) => {
  try {
    const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
    const doc = await AppSetting.findOne({ key: 'mail_from' }).lean().exec();
    const to = doc && String(doc.value || '').trim() ? String(doc.value).trim() : String(process.env.MAIL_FROM || '').trim();
    if (!to) {
      return res.status(400).json({ success: false, error: 'لم يُحدد بريد المُرسِل (mail_from) في الإعدادات' });
    }
    const result = await sendEmail({
      to,
      subject: 'اختبار البريد — DZ HOOF',
      template: 'welcome', // generic text template; exact template name is not critical for a connectivity test
      variables: { name: 'مشرف DZ HOOF' },
    });
    if (!result.ok) {
      return res.status(400).json({ success: false, error: `فشل الإرسال: ${result.error || 'خطأ SMTP'}` });
    }
    audit({ ...reqCtx(req), action: 'APP_SETTINGS_TEST_EMAIL', resource: 'AppSetting' });
    return res.json({ success: true, data: { to } });
  } catch (err) {
    console.error('[app-settings] test-email error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
