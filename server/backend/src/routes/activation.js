const express = require('express');
const router = express.Router();
const { resolveUser } = require('../middleware/resolveUser');
const { redeemCode } = require('../services/subscription-service');

const REDEEM_WINDOW_MS = 10 * 60 * 1000;
const REDEEM_MAX_ATTEMPTS = 10;
const redeemAttempts = new Map();
const redeemCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - REDEEM_WINDOW_MS;
  for (const [key, timestamps] of redeemAttempts) {
    const recent = timestamps.filter((timestamp) => timestamp > cutoff);
    if (recent.length) redeemAttempts.set(key, recent);
    else redeemAttempts.delete(key);
  }
}, REDEEM_WINDOW_MS);
redeemCleanupTimer.unref?.();

// All activation endpoints require a signed-in user (session or JWT).
router.use(resolveUser);

// POST /api/v1/activation/redeem
// Body: { code: "DZHF-XXXX-XXXX-XXXX", deviceId?, deviceName?, platform?, appVersion? }
router.post('/redeem', async (req, res) => {
  try {
    const { code, deviceId, deviceName, platform, appVersion } = req.body || {};
    if (!code || typeof code !== 'string' || code.length > 100) {
      return res
        .status(400)
        .json({ success: false, error: 'Code is required and must be at most 100 characters', code: 'INVALID_CODE' });
    }

    const rateLimitKey = String(req.user.id);
    const cutoff = Date.now() - REDEEM_WINDOW_MS;
    const recentAttempts = (redeemAttempts.get(rateLimitKey) || []).filter((timestamp) => timestamp > cutoff);
    if (recentAttempts.length >= REDEEM_MAX_ATTEMPTS) {
      res.set('Retry-After', String(Math.ceil(REDEEM_WINDOW_MS / 1000)));
      return res.status(429).json({
        success: false,
        error: 'Too many activation attempts. Try again later.',
        code: 'ACTIVATION_RATE_LIMITED',
      });
    }
    redeemAttempts.set(rateLimitKey, [...recentAttempts, Date.now()]);

    const deviceInfo = deviceId
      ? { deviceId, name: deviceName, platform, appVersion }
      : undefined;

    const result = await redeemCode(req.user.id, code, deviceInfo, req.ip);

    if (!result.success) {
      const status = result.code === 'DEVICE_LIMIT_REACHED' ? 403 : 400;
      return res.status(status).json({
        success: false,
        error: result.error,
        code: result.code,
      });
    }

    redeemAttempts.delete(rateLimitKey);
    return res.json({
      success: true,
      data: {
        subscription: result.subscription,
        plan: {
          _id: result.plan._id,
          name: result.plan.name,
          durationDays: result.plan.durationDays,
          maxDevices: result.plan.maxDevices,
        },
        devicesUsed: result.devicesUsed,
        maxDevices: result.maxDevices,
      },
    });
  } catch (err) {
    console.error('[activation] redeem error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
