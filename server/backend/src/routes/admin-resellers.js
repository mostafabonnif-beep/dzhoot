const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Reseller = require('../models/Reseller');
const ActivationCode = require('../models/ActivationCode');
const CodeBatch = require('../models/CodeBatch');

const { audit, reqCtx } = require('../services/audit-log');

// Admin-only reseller management: /api/v1/admin/resellers
const { requireAuth, requireAdmin } = require('./auth');
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.isValidObjectId(id) ? id : null;
}

// GET / — list resellers with code stats
router.get('/', async (req, res) => {
  try {
    const resellers = await Reseller.find({}).sort({ createdAt: -1 }).lean();
    const codeStats = await ActivationCode.aggregate([
      { $group: { _id: '$resellerId', total: { $sum: 1 }, activated: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVATED'] }, 1, 0] } } } },
    ]);
    const statsByReseller = new Map(
      codeStats.filter((s) => s._id).map((s) => [String(s._id), { total: s.total, activated: s.activated }]),
    );
    const data = resellers.map((r) => {
      const st = statsByReseller.get(String(r._id)) || { total: 0, activated: 0 };
      return { ...r, stats: { total: st.total, activated: st.activated, remaining: st.total - st.activated } };
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[admin-resellers] list error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST / — create reseller
router.post('/', async (req, res) => {
  try {
    const { name, city, phone, notes, status, prices } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    const cleanPrices = Array.isArray(prices)
      ? prices
          .filter((p) => p && p.planId && Number.isFinite(Number(p.price)) && Number(p.price) >= 0)
          .map((p) => ({ planId: p.planId, price: Number(p.price) }))
      : [];
    const doc = await Reseller.create({
      name: String(name).trim(),
      city: String(city || '').trim(),
      phone: String(phone || '').trim(),
      notes: String(notes || '').trim(),
      status: status === 'Inactive' ? 'Inactive' : 'Active',
      prices: cleanPrices,
    });
    audit({ ...reqCtx(req), action: 'RESELLER_CREATE', resource: 'Reseller', resourceId: String(doc._id), changes: { after: { name: doc.name, city: doc.city } } });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error('[admin-resellers] create error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PUT /:id — update reseller
router.put('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const { name, city, phone, notes, status, prices } = req.body || {};
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (city !== undefined) update.city = String(city).trim();
    if (phone !== undefined) update.phone = String(phone).trim();
    if (notes !== undefined) update.notes = String(notes).trim();
    if (status !== undefined) update.status = status === 'Inactive' ? 'Inactive' : 'Active';
    if (prices !== undefined) {
      update.prices = Array.isArray(prices)
        ? prices
            .filter((p) => p && p.planId && Number.isFinite(Number(p.price)) && Number(p.price) >= 0)
            .map((p) => ({ planId: p.planId, price: Number(p.price) }))
        : [];
    }
    if (!update.name) return res.status(400).json({ success: false, error: 'name is required' });
    const doc = await Reseller.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
    if (!doc) return res.status(404).json({ success: false, error: 'Reseller not found' });
    audit({ ...reqCtx(req), action: 'RESELLER_UPDATE', resource: 'Reseller', resourceId: String(doc._id) });
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[admin-resellers] update error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// DELETE /:id — hard delete only when no codes/batches reference it
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const linked = await ActivationCode.countDocuments({ resellerId: id }).exec();
    if (linked > 0) {
      return res.status(400).json({ success: false, error: `Cannot delete: ${linked} activation code(s) reference this reseller` });
    }
    const doc = await Reseller.findByIdAndDelete(id).exec();
    if (!doc) return res.status(404).json({ success: false, error: 'Reseller not found' });
    audit({ ...reqCtx(req), action: 'RESELLER_DELETE', resource: 'Reseller', resourceId: id });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-resellers] delete error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
