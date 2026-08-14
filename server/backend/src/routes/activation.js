const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const Session = require('../models/Session');
const { resolveUser } = require('../middleware/resolveUser');
const { redeemCode } = require('../services/subscription-service');

/**
 * Customer onboarding: the sold activation code is the only credential the
 * client needs. We create an internal User + session and never expose the
 * generated password to the customer.
 * POST /api/v1/activation/claim
 */
router.post('/claim', async (req, res) => {
  let customer = null;
  try {
    const { code, deviceId, deviceName, platform, appVersion } = req.body || {};
    if (typeof code !== 'string' || code.trim().length < 8) {
      return res.status(400).json({ success: false, error: 'Code is required', code: 'INVALID_CODE' });
    }

    const nonce = crypto.randomBytes(10).toString('hex');
    customer = await User.create({
      username: `client_${nonce}`,
      email: `client+${nonce}@customers.invalid`,
      password: crypto.randomBytes(32).toString('base64url'),
      role: 'User',
      channelListCode: await User.generateChannelListCode(),
      isActive: true,
      emailVerified: true,
      allCatalog: true,
    });

    const result = await redeemCode(
      customer._id.toString(),
      code,
      deviceId ? { deviceId, name: deviceName, platform, appVersion } : undefined,
      req.ip,
    );
    if (!result.success) {
      await User.deleteOne({ _id: customer._id });
      const status = result.code === 'DEVICE_LIMIT_REACHED' ? 403 : 400;
      return res.status(status).json({ success: false, error: result.error, code: result.code });
    }

    const sessionId = crypto.randomBytes(32).toString('hex');
    await Session.create({
      sessionId,
      userId: customer._id,
      username: customer.username,
      email: customer.email,
      role: 'User',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      sessionId,
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
    if (customer?._id) await User.deleteOne({ _id: customer._id }).catch(() => undefined);
    console.error('[activation] claim error:', err);
    return res.status(500).json({ success: false, error: 'Unable to activate this code' });
  }
});

// Existing redeem endpoint remains for already authenticated users and admin tooling.
router.use(resolveUser);

// POST /api/v1/activation/redeem
// Body: { code: "DZHF-XXXX-XXXX-XXXX", deviceId?, deviceName?, platform?, appVersion? }
router.post('/redeem', async (req, res) => {
  try {
    const { code, deviceId, deviceName, platform, appVersion } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res
        .status(400)
        .json({ success: false, error: 'Code is required', code: 'INVALID_CODE' });
    }

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
