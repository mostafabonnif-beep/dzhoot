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
    // Freemium: the client learns from the server whether to render ads and
    // which channel groups the account is limited to ([] = everything).
    const { adsPolicyForUser } = require('../services/ads-policy');
    const { allowedGroupsForUser, isFreeTierUser } = require('../services/channel-scope');
    const [adsPolicy, groups] = await Promise.all([
      adsPolicyForUser(req.user),
      allowedGroupsForUser(req.user),
    ]);
    return res.json({
      success: true,
      data: {
        ...data,
        tier: isFreeTierUser(req.user) ? 'free' : req.user.role === 'Admin' ? 'admin' : 'paid',
        accessGroups: groups || [],
        ads: { show: adsPolicy.showAds, ...adsPolicy.config },
      },
    });
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
    const { deviceId, name, platform, appVersion, pushToken } = req.body || {};
    const result = await registerDevice(req.user.id, { deviceId, name, platform, appVersion, pushToken });
    if (!result.ok) {
      const status = result.error === 'DEVICE_REGISTRATION_BUSY' ? 503 : 403;
      return res.status(status).json({
        success: false,
        error: result.message,
        code: result.error,
        devicesUsed: result.devicesUsed,
        maxDevices: result.maxDevices,
      });
    }
    const device = result.device?.toObject ? result.device.toObject() : { ...result.device };
    delete device.pushToken;
    return res.status(201).json({ success: true, data: device });
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
    // Broadcast announcements for everyone, plus messages addressed to this
    // user specifically (e.g. their subscription is about to expire).
    const notifications = await Notification.find({
      status: 'SENT',
      $or: [{ targetUserId: null }, { targetUserId: req.user.id }],
    })
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
    // Only a notification this user can actually see may be marked as read:
    // broadcasts (targetUserId null) or one addressed to them. Without this the
    // endpoint created read rows for other users' targeted messages.
    const notification = await Notification.findOne({
      _id: req.params.id,
      status: 'SENT',
      $or: [{ targetUserId: null }, { targetUserId: req.user.id }],
    }).lean();
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
