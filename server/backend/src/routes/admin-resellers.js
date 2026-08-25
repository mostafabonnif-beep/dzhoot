const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Reseller = require('../models/Reseller');
const ActivationCode = require('../models/ActivationCode');
const CodeBatch = require('../models/CodeBatch');
const Plan = require('../models/Plan');

const { audit, reqCtx } = require('../services/audit-log');
const bcrypt = require('bcryptjs');
const CreditTransaction = require('../models/CreditTransaction');
const ResellerCreditDebt = require('../models/ResellerCreditDebt');
const { recordCreditTx, returnUnusedCreditForReseller } = require('../services/subscription-service');

// Admin-only reseller management: /api/v1/admin/resellers
const { requireAuth, requireAdmin } = require('./auth');
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.isValidObjectId(id) ? id : null;
}

// Auto-create a debt for an unpaid credit grant. amount = Σ positive delta ×
// wholesale price (same math as the ledger's purchase value). Returns the
// created debt or null (no positive value / already marked paid).
async function autoDebtFromGrant(adminId, resellerId, deltasByPlan, priceMap, opts = {}) {
  const value = deltasByPlan.reduce((sum, { planId, delta }) => {
    if (delta <= 0) return sum;
    return sum + delta * (priceMap.get(planId) || 0);
  }, 0);
  if (value <= 0) return null;
  if (opts.creditPaid === true) return null;
  const debt = await ResellerCreditDebt.create({
    adminId,
    resellerId,
    amount: Math.round(value * 100) / 100,
    paidAmount: 0,
    status: 'UNPAID',
    autoFromGrant: true,
    note: opts.note || `منح رصيد بقيمة ${Math.round(value)} دج`,
  });
  audit({
    ...reqCtx(opts.req),
    action: 'RESELLER_CREDIT_DEBT_AUTO',
    resource: 'ResellerCreditDebt',
    resourceId: String(debt._id),
    changes: { after: { resellerId: String(resellerId), amount: debt.amount } },
  });
  return debt;
}


/** Clean a credit array: [{planId, quantity}] — merge duplicates by summing, drop invalid. */
function cleanCredit(raw) {
  if (!Array.isArray(raw)) return [];
  const byPlan = new Map();
  for (const item of raw) {
    if (!item || !parseId(item.planId)) continue;
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 0) continue;
    byPlan.set(String(item.planId), (byPlan.get(String(item.planId)) || 0) + qty);
  }
  return [...byPlan.entries()].map(([planId, quantity]) => ({ planId, quantity }));
}

// GET / — list resellers with code stats + purchase value
router.get('/', async (req, res) => {
  try {
    const resellers = await Reseller.find({}).sort({ createdAt: -1 }).lean();
    const codeStats = await ActivationCode.aggregate([
      { $group: { _id: '$resellerId', total: { $sum: 1 }, activated: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVATED'] }, 1, 0] } } } },
    ]);
    const statsByReseller = new Map(
      codeStats.filter((s) => s._id).map((s) => [String(s._id), { total: s.total, activated: s.activated }]),
    );
    const purchaseAgg = await CreditTransaction.aggregate([
      { $match: { type: 'GRANT' } },
      { $group: { _id: '$resellerId', value: { $sum: '$amount' } } },
    ]);
    const purchasesByReseller = new Map(purchaseAgg.filter((p) => p._id).map((p) => [String(p._id), p.value || 0]));
    const data = resellers.map((r) => {
      const st = statsByReseller.get(String(r._id)) || { total: 0, activated: 0 };
      return {
        ...r,
        stats: { total: st.total, activated: st.activated, remaining: st.total - st.activated },
        purchasedValue: purchasesByReseller.get(String(r._id)) || 0,
      };
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
    const { name, city, phone, notes, status, prices, username, password, credit, prefix } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    if (username && !/^[a-z0-9_.-]{3,50}$/i.test(String(username).trim())) {
      return res.status(400).json({ success: false, error: 'username must be 3-50 letters/numbers/._-' });
    }
    if (password && String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'password must be at least 6 characters' });
    }
    const cleanPrefix = prefix ? String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : undefined;
    if (prefix && (!cleanPrefix || cleanPrefix.length < 3)) {
      return res.status(400).json({ success: false, error: 'prefix must be 3-6 letters/numbers' });
    }
    const cleanPrices = Array.isArray(prices)
      ? prices
          .filter((p) => p && p.planId && Number.isFinite(Number(p.price)) && Number(p.price) >= 0)
          .map((p) => ({ planId: p.planId, price: Number(p.price) }))
      : [];
    const priceMap = new Map(cleanPrices.map((p) => [String(p.planId), Number(p.price) || 0]));
    const doc = await Reseller.create({
      name: String(name).trim(),
      city: String(city || '').trim(),
      phone: String(phone || '').trim(),
      notes: String(notes || '').trim(),
      status: status === 'Inactive' ? 'Inactive' : 'Active',
      prices: cleanPrices,
      credit: cleanCredit(credit),
      username: username ? String(username).trim().toLowerCase() : undefined,
      passwordHash: password ? String(password) : undefined,
      prefix: cleanPrefix,
    });
    // Ledger: record every initial credit grant (balanceAfter = granted qty).
    for (const c of cleanCredit(credit)) {
      await recordCreditTx({
        resellerId: String(doc._id),
        planId: String(c.planId),
        type: 'GRANT',
        quantity: c.quantity,
        balanceAfter: c.quantity,
        unitPrice: priceMap.get(String(c.planId)) || 0,
        note: 'منح رصيد عند إنشاء المحل',
        createdBy: req.user?.id || null,
      });
    }
    // Auto debt: initial credit granted without upfront payment → record what's owed
    if (credit !== undefined && Array.isArray(credit) && credit.length > 0) {
      await autoDebtFromGrant(
        req.user.id,
        String(doc._id),
        cleanCredit(credit).map((c) => ({ planId: String(c.planId), delta: Number(c.quantity) || 0 })),
        priceMap,
        { req, creditPaid: req.body.creditPaid === true, note: 'رصيد عند إنشاء المحل (غير مسدد)' },
      );
    }
    audit({ ...reqCtx(req), action: 'RESELLER_CREATE', resource: 'Reseller', resourceId: String(doc._id), changes: { after: { name: doc.name, city: doc.city } } });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    // Unique index on username/prefix — surface as a clear 400, not a 500.
    if (err && err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Duplicate reseller — username or prefix already in use' });
    }
    console.error('[admin-resellers] create error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PUT /:id — update reseller
router.put('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const { name, city, phone, notes, status, prices, username, password, credit, prefix } = req.body || {};
    const update = {};
    if (username !== undefined) {
      if (username && !/^[a-z0-9_.-]{3,50}$/i.test(String(username).trim())) {
        return res.status(400).json({ success: false, error: 'username must be 3-50 letters/numbers/._-' });
      }
      update.username = username ? String(username).trim().toLowerCase() : null;
    }
    if (password !== undefined) {
      if (password && String(password).length < 6) {
        return res.status(400).json({ success: false, error: 'password must be at least 6 characters' });
      }
      // findByIdAndUpdate bypasses the pre-save hook, so hash here explicitly.
      // Empty string clears the portal login.
      update.passwordHash = password ? await bcrypt.hash(String(password), 12) : '';
    }
    if (name !== undefined) update.name = String(name).trim();
    if (city !== undefined) update.city = String(city).trim();
    if (phone !== undefined) update.phone = String(phone).trim();
    if (notes !== undefined) update.notes = String(notes).trim();
    if (status !== undefined) update.status = status === 'Inactive' ? 'Inactive' : 'Active';
    if (prefix !== undefined) {
      const cleanPrefix = prefix ? String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : undefined;
      if (prefix && (!cleanPrefix || cleanPrefix.length < 3)) {
        return res.status(400).json({ success: false, error: 'prefix must be 3-6 letters/numbers' });
      }
      update.prefix = cleanPrefix || null;
    }
    if (prices !== undefined) {
      update.prices = Array.isArray(prices)
        ? prices
            .filter((p) => p && p.planId && Number.isFinite(Number(p.price)) && Number(p.price) >= 0)
            .map((p) => ({ planId: p.planId, price: Number(p.price) }))
        : [];
    }
    // Only require a name when the client is actually setting one — a pure
    // credit top-up or status toggle must not need to resend the whole doc.
    if (req.body.name !== undefined && (!req.body.name || !String(req.body.name).trim())) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    if (update.name) update.name = String(update.name).trim();
    if (credit !== undefined) update.credit = cleanCredit(credit);
    const prev = await Reseller.findById(id).select('credit').lean().exec();
    const doc = await Reseller.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
    if (!doc) return res.status(404).json({ success: false, error: 'Reseller not found' });
    // Ledger: record credit deltas (new vs previous) with final balanceAfter.
    if (credit !== undefined) {
      const oldMap = new Map((prev?.credit || []).map((c) => [String(c.planId), Number(c.quantity) || 0]));
      const newCredit = cleanCredit(credit);
      const newMap = new Map(newCredit.map((c) => [String(c.planId), Number(c.quantity) || 0]));
      const priceMap = new Map((doc.prices || []).map((p) => [String(p.planId), Number(p.price) || 0]));
      const allPlans = new Set([...oldMap.keys(), ...newMap.keys()]);
      for (const planId of allPlans) {
        const oldQty = oldMap.get(planId) || 0;
        const newQty = newMap.get(planId) || 0;
        const delta = newQty - oldQty;
        if (delta === 0) continue;
        await recordCreditTx({
          resellerId: String(doc._id),
          planId,
          type: 'GRANT',
          quantity: delta,
          balanceAfter: newQty,
          unitPrice: priceMap.get(planId) || 0,
          note: delta > 0 ? `منح رصيد (${delta})` : `خصم رصيد (${-delta})`,
          createdBy: req.user?.id || null,
        });
      }
      // Auto debt: credit increased without upfront payment → record what's owed
      await autoDebtFromGrant(
        req.user.id,
        String(doc._id),
        [...newMap.keys()].map((planId) => ({ planId, delta: (newMap.get(planId) || 0) - (oldMap.get(planId) || 0) })),
        priceMap,
        { req, creditPaid: req.body.creditPaid === true, note: 'زيادة رصيد (غير مسددة)' },
      );
    }
    audit({ ...reqCtx(req), action: 'RESELLER_UPDATE', resource: 'Reseller', resourceId: String(doc._id) });
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[admin-resellers] update error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/credit/return — reclaim credit from a reseller's UNUSED codes.
// Body: { batchId? } — all unused codes, or only that batch's codes, are
// revoked (REVOKED) and the credit is restored to the reseller (ledger RETURN).
router.post('/:id/credit/return', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const reseller = await Reseller.findById(id).select('name').lean().exec();
    if (!reseller) return res.status(404).json({ success: false, error: 'Reseller not found' });

    const { batchId, planId } = req.body || {};
    const result = await returnUnusedCreditForReseller(String(id), {
      batchId: batchId || undefined,
      planId: planId || undefined,
      note: batchId ? 'استرجاع يدوي — دفعة كاملة' : 'استرجاع يدوي — كل الأكواد غير المستخدمة',
      createdBy: req.user?.id || null,
    });
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });

    audit({
      ...reqCtx(req),
      action: 'RESELLER_CREDIT_RETURN',
      resource: 'Reseller',
      resourceId: String(id),
      changes: { after: { name: reseller.name, revoked: result.revoked, restored: result.restored } },
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[admin-resellers] credit return error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /:id/ledger — credit movement history of one reseller (سجل حركات الرصيد)
router.get('/:id/ledger', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || '50'), 10) || 50, 1), 200);
    const [rows, total] = await Promise.all([
      CreditTransaction.find({ resellerId: id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
      CreditTransaction.countDocuments({ resellerId: id }),
    ]);
    const planIds = [...new Set(rows.map((r) => String(r.planId)))];
    const plans = planIds.length ? await Plan.find({ _id: { $in: planIds } }).select('name').lean() : [];
    const planMap = new Map(plans.map((p) => [String(p._id), p.name]));
    const data = rows.map((r) => ({
      _id: r._id,
      type: r.type,
      quantity: r.quantity,
      balanceAfter: r.balanceAfter,
      unitPrice: r.unitPrice || 0,
      amount: r.amount || 0,
      planName: planMap.get(String(r.planId)) || '—',
      note: r.note || '',
      createdAt: r.createdAt,
    }));
    res.json({ success: true, data: { rows: data, total, page, pageSize } });
  } catch (err) {
    console.error('[admin-resellers] ledger error:', err);
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
    // Never allow deleting a shop that still owes money — the debt records
    // would lose their subject and the receivable silently disappears.
    const unpaidDebts = await ResellerCreditDebt.countDocuments({
      resellerId: id,
      status: { $in: ['UNPAID', 'PARTIAL'] },
    }).exec();
    if (unpaidDebts > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete: ${unpaidDebts} unpaid debt record(s) reference this reseller — settle the debts first`,
      });
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

module.exports = router;
