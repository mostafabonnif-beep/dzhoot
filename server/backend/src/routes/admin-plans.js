const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const ActivationCode = require('../models/ActivationCode');
const Subscription = require('../models/Subscription');
const { requireAuth, requireAdmin } = require('./auth');
const { escapeRegex } = require('../utils/escapeRegex');
const { audit, reqCtx } = require('../services/audit-log');

// Admin-only plan management: /api/v1/admin/plans
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

// GET / — list plans with code/subscription counts
router.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || '100'), 10) || 100, 1), 200);
    const query = {};
    if (status) query.status = status;
    if (search) query.name = { $regex: escapeRegex(String(search)), $options: 'i' };

    const totalCount = await Plan.countDocuments(query);
    const plans = await Plan.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    const withCounts = await Promise.all(
      plans.map(async (p) => {
        const [codeCount, usedCodeCount, activeSubs] = await Promise.all([
          ActivationCode.countDocuments({ planId: p._id }),
          ActivationCode.countDocuments({ planId: p._id, status: 'ACTIVATED' }),
          Subscription.countDocuments({ planId: p._id, status: 'ACTIVE' }),
        ]);
        return { ...p, codeCount, usedCodeCount, activeSubs };
      }),
    );

    return res.json({ success: true, data: withCounts, totalCount });
  } catch (err) {
    console.error('[admin-plans] list error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST / — create a plan
router.post('/', async (req, res) => {
  try {
    const { name, description, durationDays, maxDevices, maxConcurrentStreams, price, currency, status, allowCustomDuration, features } =
      req.body || {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    const days = Number(durationDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return res.status(400).json({ success: false, error: 'durationDays must be an integer >= 1' });
    }
    const streams = Number(maxConcurrentStreams);
    if (maxConcurrentStreams !== undefined && (!Number.isInteger(streams) || streams < 1 || streams > 100)) {
      return res.status(400).json({ success: false, error: 'maxConcurrentStreams must be an integer between 1 and 100' });
    }
    const priceNum = price === undefined || price === null || price === '' ? 0 : Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ success: false, error: 'price must be a non-negative number' });
    }

    const plan = await Plan.create({
      name: String(name).trim(),
      description: description || '',
      durationDays: days,
      maxDevices: Math.max(1, Number(maxDevices) || 1),
      maxConcurrentStreams: maxConcurrentStreams !== undefined ? streams : 1,
      price: priceNum,
      currency: currency || 'DZD',
      allowCustomDuration: allowCustomDuration === true,
      status: status === 'Inactive' ? 'Inactive' : 'Active',
      features: features || {},
    });

    audit({ ...reqCtx(req), action: 'PLAN_CREATE', resource: 'Plan', resourceId: String(plan._id) });
    return res.status(201).json({ success: true, data: plan });
  } catch (err) {
    console.error('[admin-plans] create error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PATCH /:id — update a plan
router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid plan id' });

    const plan = await Plan.findById(id).exec();
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const before = plan.toObject();
    const { name, description, durationDays, maxDevices, maxConcurrentStreams, price, currency, status, allowCustomDuration, features } =
      req.body || {};

    if (name !== undefined) plan.name = String(name).trim();
    if (description !== undefined) plan.description = description;
    if (durationDays !== undefined) {
      const days = Number(durationDays);
      if (!Number.isInteger(days) || days < 1) {
        return res.status(400).json({ success: false, error: 'durationDays must be an integer >= 1' });
      }
      plan.durationDays = days;
    }
    if (maxDevices !== undefined) plan.maxDevices = Math.max(1, Number(maxDevices) || 1);
    if (maxConcurrentStreams !== undefined) {
      const streams = Number(maxConcurrentStreams);
      if (!Number.isInteger(streams) || streams < 1 || streams > 100) {
        return res.status(400).json({ success: false, error: 'maxConcurrentStreams must be an integer between 1 and 100' });
      }
      plan.maxConcurrentStreams = streams;
    }
    if (price !== undefined && price !== null && price !== '') {
      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return res.status(400).json({ success: false, error: 'price must be a non-negative number' });
      }
      plan.price = priceNum;
    }
    if (currency !== undefined) plan.currency = String(currency).toUpperCase();
    if (allowCustomDuration !== undefined) plan.allowCustomDuration = allowCustomDuration === true;
    if (status !== undefined) plan.status = status === 'Inactive' ? 'Inactive' : 'Active';
    if (features !== undefined) plan.features = features;

    await plan.save();
    audit({
      ...reqCtx(req),
      action: 'PLAN_UPDATE',
      resource: 'Plan',
      resourceId: String(plan._id),
      changes: { before, after: plan.toObject() },
    });
    return res.json({ success: true, data: plan });
  } catch (err) {
    console.error('[admin-plans] update error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// DELETE /:id — hard-delete only if unused; otherwise deactivate
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid plan id' });

    const plan = await Plan.findById(id).exec();
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const codeCount = await ActivationCode.countDocuments({ planId: id });

    if (codeCount === 0) {
      await Plan.deleteOne({ _id: id });
      audit({ ...reqCtx(req), action: 'PLAN_DELETE', resource: 'Plan', resourceId: String(id) });
      return res.json({ success: true, data: { deleted: true, deactivated: false } });
    }

    plan.status = 'Inactive';
    await plan.save();
    audit({
      ...reqCtx(req),
      action: 'PLAN_DEACTIVATE',
      resource: 'Plan',
      resourceId: String(id),
      changes: { before: { status: 'Active' }, after: { status: 'Inactive' } },
    });
    return res.json({ success: true, data: { deleted: false, deactivated: true } });
  } catch (err) {
    console.error('[admin-plans] delete error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
