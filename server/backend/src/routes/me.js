const express = require('express');
const router = express.Router();
const { resolveUser } = require('../middleware/resolveUser');
const { getUserSubscription, registerDevice } = require('../services/subscription-service');
const Device = require('../models/Device');

// User-facing "me" endpoints (session or JWT).
router.use(resolveUser);

// GET /api/v1/me/subscription — current subscription + plan + device usage
router.get('/subscription', async (req, res) => {
  try {
    const data = await getUserSubscription(req.user.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[me] subscription error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/me/devices — registered devices
router.get('/devices', async (req, res) => {
  try {
    const devices = await Device.find({ userId: req.user.id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, data: devices });
  } catch (err) {
    console.error('[me] devices error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /api/v1/me/devices — register/update a device (enforces subscription cap)
router.post('/devices', async (req, res) => {
  try {
    const { deviceId, name, platform, appVersion } = req.body || {};
    const result = await registerDevice(req.user.id, { deviceId, name, platform, appVersion });
    if (!result.ok) {
      return res.status(403).json({
        success: false,
        error: result.message,
        code: result.error,
        devicesUsed: result.devicesUsed,
        maxDevices: result.maxDevices,
      });
    }
    return res.status(201).json({ success: true, data: result.device });
  } catch (err) {
    console.error('[me] register device error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// DELETE /api/v1/me/devices/:deviceId — remove a device (frees a slot)
router.delete('/devices/:deviceId', async (req, res) => {
  try {
    const deleted = await Device.deleteOne({ userId: req.user.id, deviceId: req.params.deviceId });
    if (deleted.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[me] delete device error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/me/notifications — sent notifications with per-user read state
router.get('/notifications', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const UserNotification = require('../models/UserNotification');
    const notifications = await Notification.find({ status: 'SENT' })
      .sort({ sentAt: -1 })
      .limit(50)
      .lean();
    const reads = await UserNotification.find({
      userId: req.user.id,
      notificationId: { $in: notifications.map((n) => n._id) },
    })
      .lean();
    const readMap = new Map(reads.map((r) => [String(r.notificationId), r.readAt]));
    const data = notifications.map((n) => ({
      ...n,
      read: readMap.has(String(n._id)) ? !!readMap.get(String(n._id)) : false,
    }));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[me] notifications error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /api/v1/me/notifications/:id/read — mark one notification as read
router.post('/notifications/:id/read', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const UserNotification = require('../models/UserNotification');
    const notification = await Notification.findById(req.params.id).lean();
    if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });

    await UserNotification.findOneAndUpdate(
      { userId: req.user.id, notificationId: notification._id },
      { $set: { readAt: new Date() } },
      { upsert: true, setDefaultsOnInsert: true },
    ).exec();
    return res.json({ success: true });
  } catch (err) {
    console.error('[me] mark read error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
