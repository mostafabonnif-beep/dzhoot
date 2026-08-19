const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { resolveUser } = require('../middleware/resolveUser');
const { redeemCode, getUserSubscription, registerDevice } = require('../services/subscription-service');
const User = require('../models/User');
const Session = require('../models/Session');
const ActivationCode = require('../models/ActivationCode');
const Plan = require('../models/Plan');
const { hashActivationCode, normalizeActivationCode } = require('../utils/code-generator');

const REDEEM_WINDOW_MS = 10 * 60 * 1000;
const REDEEM_MAX_ATTEMPTS = 10;

// Catalog access is an explicit plan entitlement. Plans that omit the setting
// retain the safe, backwards-compatible default of full catalog access.
function planGrantsFullCatalog(plan) {
  return plan?.features?.allCatalog !== false;
}

async function syncCatalogEntitlement(user, plan) {
  if (!user || !plan) return;
  const allCatalog = planGrantsFullCatalog(plan);
  if (user.allCatalog === allCatalog) return;
  user.allCatalog = allCatalog;
  await user.save();
}
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

// Customer bootstrap: the installed client receives only an activation code. The
// code is a bearer credential, so this endpoint is deliberately rate-limited and
// returns a normal session plus the managed channel-list credential. Existing
// authenticated users continue to use the protected /redeem endpoint below.
router.post('/client-redeem', async (req, res) => {
  try {
    const { code, deviceId, deviceName, platform, appVersion } = req.body || {};
    const normalized = typeof code === 'string' ? normalizeActivationCode(code) : '';
    const normalizedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';
    if (normalized.length < 8 || normalized.length > 100 || !normalizedDeviceId || normalizedDeviceId.length > 200) {
      return res.status(400).json({ success: false, error: 'Activation code and deviceId are required', code: 'INVALID_CODE' });
    }

    const rateLimitKey = `${req.ip || 'unknown'}:${normalizedDeviceId}`;
    const cutoff = Date.now() - REDEEM_WINDOW_MS;
    const recentAttempts = (redeemAttempts.get(rateLimitKey) || []).filter((timestamp) => timestamp > cutoff);
    if (recentAttempts.length >= REDEEM_MAX_ATTEMPTS) {
      res.set('Retry-After', String(Math.ceil(REDEEM_WINDOW_MS / 1000)));
      return res.status(429).json({ success: false, error: 'Too many activation attempts. Try again later.', code: 'ACTIVATION_RATE_LIMITED' });
    }
    redeemAttempts.set(rateLimitKey, [...recentAttempts, Date.now()]);

    const activation = await ActivationCode.findOne({ codeHash: hashActivationCode(normalized) }).exec();
    if (!activation) return res.status(400).json({ success: false, error: 'Invalid code', code: 'INVALID_CODE' });

    let user;
    if (activation.status === 'ACTIVATED' && activation.activatedBy) {
      user = await User.findById(activation.activatedBy).exec();
      if (!user || !user.isActive) return res.status(401).json({ success: false, error: 'Customer account is inactive', code: 'ACCOUNT_INACTIVE' });
      const plan = await Plan.findById(activation.planId).lean().exec();
      await syncCatalogEntitlement(user, plan);
      const registered = await registerDevice(user._id.toString(), {
        deviceId: normalizedDeviceId,
        name: deviceName,
        platform,
        appVersion,
      }, plan?.maxDevices);
      if (!registered.ok) return res.status(403).json({ success: false, error: registered.message, code: registered.error });
    } else {
      const plan = await Plan.findById(activation.planId).lean().exec();
      if (!plan || plan.status !== 'Active') return res.status(400).json({ success: false, error: 'Subscription plan is unavailable', code: 'PLAN_UNAVAILABLE' });
      const clientId = crypto.randomBytes(10).toString('hex');
      const channelListCode = await User.generateChannelListCode();
      user = await User.create({
        username: `client_${clientId}`,
        email: `${clientId}@clients.dzhoof.invalid`,
        password: crypto.randomBytes(32).toString('hex'),
        role: 'User',
        channelListCode,
        allCatalog: planGrantsFullCatalog(plan),
        isActive: true,
        emailVerified: true,
      });
      const result = await redeemCode(user._id.toString(), normalized, {
        deviceId: normalizedDeviceId,
        name: deviceName,
        platform,
        appVersion,
      }, req.ip);
      if (!result.success) {
        await User.deleteOne({ _id: user._id }).exec();
        return res.status(result.code === 'DEVICE_LIMIT_REACHED' ? 403 : 400).json({ success: false, error: result.error, code: result.code });
      }
    }

    const sessionId = crypto.randomBytes(32).toString('hex');
    await Session.create({
      sessionId,
      userId: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const data = await getUserSubscription(user._id.toString());
    redeemAttempts.delete(rateLimitKey);
    return res.json({
      success: true,
      sessionId,
      user: { id: user._id, username: user.username, role: user.role, channelListCode: user.channelListCode },
      data,
    });
  } catch (err) {
    console.error('[activation] client bootstrap error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// All account-based activation endpoints require a signed-in user.
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

    const currentUser = await User.findById(req.user.id).exec();
    await syncCatalogEntitlement(currentUser, result.plan);
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
