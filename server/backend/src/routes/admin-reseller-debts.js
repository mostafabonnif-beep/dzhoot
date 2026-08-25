const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Reseller = require('../models/Reseller');
const ResellerCreditDebt = require('../models/ResellerCreditDebt');
const { audit, reqCtx } = require('../services/audit-log');

// Admin-only reseller credit debts: /api/v1/admin/reseller-debts
const { requireAuth, requireAdmin } = require('./auth');
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.isValidObjectId(id) ? id : null;
}

function parseDebtAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// ─── Reseller credit debts (ديون المحلات على الأدمن) ─────────────
// The admin gives resellers code credit; when a grant isn't paid upfront a
// debt is auto-created. These routes list/settle/edit/delete them.

function parseDebtAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// GET /reseller-debts — list (UNPAID first, oldest first) + outstanding summary
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { adminId: req.user.id };
    if (['UNPAID', 'PARTIAL', 'PAID'].includes(status)) filter.status = status;

    const [debts, summary, resellerIds] = await Promise.all([
      ResellerCreditDebt.find(filter).sort({ createdAt: -1 }).limit(300).lean().exec(),
      ResellerCreditDebt.aggregate([
        { $match: { adminId: req.user.id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            remaining: { $sum: { $subtract: ['$amount', { $ifNull: ['$paidAmount', 0] }] } },
          },
        },
      ]).exec(),
      ResellerCreditDebt.distinct('resellerId', filter).exec(),
    ]);

    const resellers = await Reseller.find({ _id: { $in: resellerIds } })
      .select('name city phone')
      .lean()
      .exec();
    const resellerMap = new Map(resellers.map((r) => [String(r._id), r]));

    const byStatus = Object.fromEntries(summary.map((s) => [s._id, s]));
    const outstanding = (byStatus.UNPAID?.remaining || 0) + (byStatus.PARTIAL?.remaining || 0);
    const unpaidCount = (byStatus.UNPAID?.count || 0) + (byStatus.PARTIAL?.count || 0);

    const data = debts.map((d) => ({
      _id: String(d._id),
      resellerId: String(d.resellerId),
      resellerName: resellerMap.get(String(d.resellerId))?.name || '—',
      resellerPhone: resellerMap.get(String(d.resellerId))?.phone || '',
      amount: d.amount,
      paidAmount: d.paidAmount || 0,
      remaining: Math.round((d.amount - (d.paidAmount || 0)) * 100) / 100,
      status: d.status,
      note: d.note || '',
      autoFromGrant: d.autoFromGrant || false,
      paidAt: d.paidAt ? new Date(d.paidAt).toISOString() : null,
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
    }));

    return res.json({ success: true, data, summary: { outstanding, unpaidCount } });
  } catch (err) {
    console.error('[admin-resellers] list debts error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /reseller-debts — manual debt entry
router.post('/', async (req, res) => {
  try {
    const { resellerId, amount, note } = req.body || {};
    const rid = parseId(resellerId);
    if (!rid) return res.status(400).json({ success: false, error: 'resellerId is required (valid ObjectId)' });
    const amt = parseDebtAmount(amount);
    if (amt === null) return res.status(400).json({ success: false, error: 'amount must be a non-negative number' });
    const reseller = await Reseller.findById(rid).select('name').lean().exec();
    if (!reseller) return res.status(404).json({ success: false, error: 'Reseller not found' });

    const debt = await ResellerCreditDebt.create({
      adminId: req.user.id,
      resellerId: rid,
      amount: amt,
      paidAmount: 0,
      status: 'UNPAID',
      note: String(note || '').trim().slice(0, 500),
      autoFromGrant: false,
    });
    audit({ ...reqCtx(req), action: 'RESELLER_CREDIT_DEBT_CREATE', resource: 'ResellerCreditDebt', resourceId: String(debt._id), changes: { after: { resellerId: String(rid), amount: debt.amount } } });
    return res.status(201).json({ success: true, data: debt });
  } catch (err) {
    console.error('[admin-resellers] create debt error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PATCH /reseller-debts/:id — settle (full/partial) or edit
router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid debt id' });
    const debt = await ResellerCreditDebt.findOne({ _id: id, adminId: req.user.id }).exec();
    if (!debt) return res.status(404).json({ success: false, error: 'Debt not found' });

    const $set = {};
    if (req.body.amount !== undefined) {
      const v = parseDebtAmount(req.body.amount);
      if (v === null) return res.status(400).json({ success: false, error: 'amount must be a non-negative number' });
      $set.amount = v;
    }
    if (req.body.note !== undefined) $set.note = String(req.body.note).trim().slice(0, 500);
    if (req.body.status !== undefined) {
      const status = String(req.body.status);
      if (!['UNPAID', 'PARTIAL', 'PAID'].includes(status)) {
        return res.status(400).json({ success: false, error: 'status must be UNPAID, PARTIAL or PAID' });
      }
      $set.status = status;
      if (status === 'PAID') {
        $set.paidAmount = debt.amount;
        $set.paidAt = new Date();
      } else if (status === 'UNPAID') {
        $set.paidAmount = 0;
        $set.paidAt = null;
      } else {
        const v = parseDebtAmount(req.body.paidAmount);
        if (v === null || v > debt.amount) {
          return res.status(400).json({ success: false, error: 'paidAmount must be between 0 and amount' });
        }
        $set.paidAmount = v;
        $set.paidAt = v > 0 ? new Date() : null;
      }
    } else if (req.body.paidAmount !== undefined) {
      const v = parseDebtAmount(req.body.paidAmount);
      if (v === null || v > debt.amount) {
        return res.status(400).json({ success: false, error: 'paidAmount must be between 0 and amount' });
      }
      $set.paidAmount = v;
      $set.status = v >= debt.amount ? 'PAID' : v > 0 ? 'PARTIAL' : 'UNPAID';
      $set.paidAt = v > 0 ? new Date() : null;
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }
    const updated = await ResellerCreditDebt.findOneAndUpdate(
      { _id: id, adminId: req.user.id },
      { $set },
      { new: true },
    ).lean().exec();
    audit({ ...reqCtx(req), action: 'RESELLER_CREDIT_DEBT_UPDATE', resource: 'ResellerCreditDebt', resourceId: String(id), changes: { after: $set } });
    return res.json({
      success: true,
      data: {
        _id: String(updated._id),
        amount: updated.amount,
        paidAmount: updated.paidAmount,
        remaining: Math.round((updated.amount - updated.paidAmount) * 100) / 100,
        status: updated.status,
        paidAt: updated.paidAt ? new Date(updated.paidAt).toISOString() : null,
      },
    });
  } catch (err) {
    console.error('[admin-resellers] update debt error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// DELETE /reseller-debts/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid debt id' });
    const r = await ResellerCreditDebt.deleteOne({ _id: id, adminId: req.user.id }).exec();
    if (r.deletedCount === 0) return res.status(404).json({ success: false, error: 'Debt not found' });
    audit({ ...reqCtx(req), action: 'RESELLER_CREDIT_DEBT_DELETE', resource: 'ResellerCreditDebt', resourceId: String(id) });
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin-resellers] delete debt error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
