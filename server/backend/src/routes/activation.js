const express = require('express');
const router = express.Router();
const { resolveUser } = require('../middleware/resolveUser');
const { redeemCode } = require('../services/subscription-service');

// All activation endpoints require a signed-in user (session or JWT).
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
