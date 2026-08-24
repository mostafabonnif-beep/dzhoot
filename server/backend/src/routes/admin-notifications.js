const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx } = require('../services/audit-log');
const { sendNotificationToDevices } = require('../services/fcm-service');

// Admin-only notifications: /api/v1/admin/notifications
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

// GET / — list notifications
router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 50, status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const [totalCount, data] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(pageSize))
        .limit(Number(pageSize))
        .lean(),
    ]);
    return res.json({ success: true, data, totalCount });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST / — create a notification (DRAFT)
router.post('/', async (req, res) => {
  try {
    const { title, body, imageUrl, deepLink, audience, scheduledAt } = req.body || {};
    if (!title || !body) {
      return res.status(400).json({ success: false, error: 'title and body are required' });
    }
    const scheduledAtDate = scheduledAt ? new Date(scheduledAt) : null;
    const notification = await Notification.create({
      title: String(title).trim(),
      body: String(body).trim(),
      imageUrl: imageUrl || '',
      deepLink: deepLink || '',
      audience: audience === 'ACTIVE' ? 'ACTIVE' : 'ALL',
      status: scheduledAtDate && scheduledAtDate.getTime() > Date.now() ? 'SCHEDULED' : 'DRAFT',
      scheduledAt: scheduledAtDate,
      createdBy: req.user.id,
    });
    audit({ ...reqCtx(req), action: 'NOTIFICATION_CREATE', resource: 'Notification', resourceId: String(notification._id) });
    return res.status(201).json({ success: true, data: notification });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/send — deliver through FCM when configured and mark as sent for in-app clients
router.post('/:id/send', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid notification id' });
    const notification = await Notification.findById(id).exec();
    if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });

    const fcm = await sendNotificationToDevices({
      title: notification.title,
      body: notification.body,
      imageUrl: notification.imageUrl,
      deepLink: notification.deepLink,
      audience: notification.audience,
    });

    notification.status = 'SENT';
    notification.sentAt = new Date();
    await notification.save();

    audit({ ...reqCtx(req), action: 'NOTIFICATION_SEND', resource: 'Notification', resourceId: String(id), metadata: fcm });
    return res.json({ success: true, data: notification, fcm });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid notification id' });
    await Notification.findByIdAndDelete(id).exec();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
