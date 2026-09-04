const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx } = require('../services/audit-log');
const { sendNotificationToDevices, pushOutcome } = require('../services/fcm-service');

// Admin-only notifications: /api/v1/admin/notifications
router.use(requireAuth);
router.use(requireAdmin);

const activeSendLocks = new Set();

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

// GET / — list notifications
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || '50'), 10) || 50, 1), 200);
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const [totalCount, data] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
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
    if (scheduledAtDate && Number.isNaN(scheduledAtDate.getTime())) {
      return res.status(400).json({ success: false, error: 'scheduledAt must be a valid date' });
    }
    const notification = await Notification.create({
      title: String(title).trim().slice(0, 200),
      body: String(body).trim().slice(0, 2000),
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
  let lockKey;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid notification id' });
    lockKey = String(id);
    if (activeSendLocks.has(lockKey)) {
      return res.status(409).json({ success: false, error: 'This notification is already being sent' });
    }
    activeSendLocks.add(lockKey);
    // Atomic claim: exactly one concurrent /send request may proceed. The
    // delivered-guard is part of the filter, so a notification that already
    // went out (SENT + push delivered) can't be claimed, and a racing second
    // request (which would see the transitional SENDING status) also can't.
    // A SENT notification whose push FAILED stays claimable (re-send allowed).
    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ['DRAFT', 'SCHEDULED', 'SENT', 'FAILED'] },
        $or: [
          { status: { $in: ['DRAFT', 'FAILED'] } },
          { status: 'SCHEDULED', scheduledAt: { $gt: new Date() } },
          { status: 'SENT', 'deliveryStats.pushDelivered': { $ne: true } },
        ],
      },
      { $set: { status: 'SENDING' } },
      { new: true },
    ).exec();
    if (!notification) {
      const existing = await Notification.findById(id).select('status deliveryStats.pushDelivered').lean().exec();
      if (!existing) return res.status(404).json({ success: false, error: 'Notification not found' });
      if (existing.status === 'SENDING') {
        return res.status(409).json({ success: false, error: 'This notification is already being sent' });
      }
      return res.status(409).json({ success: false, error: 'This notification was already sent and delivered' });
    }

    const fcm = await sendNotificationToDevices({
      title: notification.title,
      body: notification.body,
      imageUrl: notification.imageUrl,
      deepLink: notification.deepLink,
      audience: notification.audience,
    });

    // The in-app channel always delivers (users see the notification in the
    // app), so the status is SENT; push outcome lives in deliveryStats so the
    // operator can see whether phones actually received a push.
    const outcome = pushOutcome(fcm);
    notification.status = 'SENT';
    notification.sentAt = new Date();
    notification.deliveryStats = { ...fcm, pushDelivered: outcome.pushDelivered, reason: outcome.reason };
    await notification.save();

    audit({ ...reqCtx(req), action: 'NOTIFICATION_SEND', resource: 'Notification', resourceId: String(id), metadata: fcm });
    return res.json({ success: true, data: notification, fcm, reason: outcome.reason });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  } finally {
    if (lockKey) activeSendLocks.delete(lockKey);
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
