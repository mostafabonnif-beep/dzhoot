const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const CodeBatch = require('../models/CodeBatch');
const Plan = require('../models/Plan');
const ActivationCode = require('../models/ActivationCode');
const Reseller = require('../models/Reseller');
const { decryptSecret } = require('../utils/crypto');
const { generateCodes, getCodeExpiryDays, recordCreditTx } = require('../services/subscription-service');
const CreditTransaction = require('../models/CreditTransaction');
const ActivationRedemption = require('../models/ActivationRedemption');
const Subscription = require('../models/Subscription');
const { requireReseller } = require('../middleware/requireReseller');
const { audit, reqCtx } = require('../services/audit-log');

// Reseller portal (بوابة الموزعين): /api/v1/reseller/*
router.use(requireReseller);

function parseId(id) {
  return mongoose.isValidObjectId(id) ? id : null;
}

/** Credit of this reseller enriched with plan info: [{planId, quantity, plan}] */
async function resellerCredit(resellerId) {
  const reseller = await Reseller.findById(resellerId).lean().exec();
  const credit = reseller?.credit || [];
  const planIds = [...new Set(credit.map((c) => String(c.planId)))];
  const plans = planIds.length
    ? await Plan.find({ _id: { $in: planIds } }).select('name durationDays status').lean()
    : [];
  const planMap = new Map(plans.map((p) => [String(p._id), p]));
  return credit
    .filter((c) => planMap.get(String(c.planId)))
    .map((c) => ({
      planId: String(c.planId),
      quantity: c.quantity,
      plan: { name: planMap.get(String(c.planId)).name, durationDays: planMap.get(String(c.planId)).durationDays },
    }));
}

// GET /me — profile + code stats + wholesale prices
router.get('/me', async (req, res) => {
  try {
    const r = req.reseller;
    const [total, activated, revoked] = await Promise.all([
      ActivationCode.countDocuments({ resellerId: r._id }),
      ActivationCode.countDocuments({ resellerId: r._id, status: 'ACTIVATED' }),
      ActivationCode.countDocuments({ resellerId: r._id, status: 'REVOKED' }),
    ]);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const activatedThisMonth = await ActivationCode.countDocuments({
      resellerId: r._id,
      status: 'ACTIVATED',
      activatedAt: { $gte: monthStart },
    });

    // Wholesale prices per plan (سعر الجملة) with plan info.
    const pricePlanIds = [...new Set((r.prices || []).map((p) => String(p.planId)))];
    const pricePlans = pricePlanIds.length
      ? await Plan.find({ _id: { $in: pricePlanIds } }).select('name durationDays').lean()
      : [];
    const pricePlanMap = new Map(pricePlans.map((p) => [String(p._id), p]));
    const prices = (r.prices || [])
      .filter((p) => pricePlanMap.get(String(p.planId)))
      .map((p) => ({
        planId: String(p.planId),
        price: p.price,
        currency: 'DZD',
        plan: {
          name: pricePlanMap.get(String(p.planId)).name,
          durationDays: pricePlanMap.get(String(p.planId)).durationDays,
        },
      }));

    // Account summary: how much credit was bought (purchases), consumed, returned.
    const ledgerAgg = await CreditTransaction.aggregate([
      { $match: { resellerId: r._id } },
      {
        $group: {
          _id: null,
          grantedQty: { $sum: { $cond: [{ $eq: ['$type', 'GRANT'] }, '$quantity', 0] } },
          // Purchases value counts only real top-ups (positive GRANT). Negative
          // GRANT rows are admin clawbacks/adjustments — they reduce credit and
          // must NOT inflate what the reseller paid.
          grantedValue: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'GRANT'] }, { $gt: ['$quantity', 0] }] }, '$amount', 0],
            },
          },
          consumedQty: {
            $sum: {
              $cond: [{ $eq: ['$type', 'CONSUME'] }, { $subtract: [0, '$quantity'] }, 0],
            },
          },
          returnedQty: { $sum: { $cond: [{ $in: ['$type', ['RETURN', 'EXPIRE_RETURN']] }, '$quantity', 0] } },
        },
      },
    ]);
    const acc = ledgerAgg[0] || { grantedQty: 0, grantedValue: 0, consumedQty: 0, returnedQty: 0 };

    // Expiring-soon: unused codes that die within 7 days (or already past — caught by the daily task).
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiringSoon = await ActivationCode.countDocuments({
      resellerId: r._id,
      status: 'UNUSED',
      codeExpiresAt: { $lte: soon, $gt: new Date() },
    });

    res.json({
      success: true,
      data: {
        _id: r._id,
        name: r.name,
        city: r.city || '',
        prefix: r.prefix || 'DZHF',
        stats: {
          total,
          activated,
          activatedThisMonth,
          remaining: Math.max(total - activated - revoked, 0),
          revoked,
        },
        credit: await resellerCredit(r._id),
        prices,
        account: {
          purchasedQty: acc.grantedQty,
          purchasedValue: acc.grantedValue,
          consumedQty: acc.consumedQty,
          returnedQty: acc.returnedQty,
          // RETURN/EXPIRE_RETURN restore credit — they ADD to the balance.
          netQty: acc.grantedQty - acc.consumedQty + acc.returnedQty,
        },
        expiringSoon,
      },
    });
  } catch (err) {
    console.error('[reseller] me error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /ledger — this reseller's credit movement history (سجل حركات الرصيد)
router.get('/ledger', async (req, res) => {
  try {
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || '50'), 10) || 50, 1), 200);
    const [rows, total] = await Promise.all([
      CreditTransaction.find({ resellerId: req.reseller._id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
      CreditTransaction.countDocuments({ resellerId: req.reseller._id }),
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
    console.error('[reseller] ledger error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /credit — this reseller's remaining code credit per plan
router.get('/credit', async (req, res) => {
  try {
    res.json({ success: true, data: await resellerCredit(req.reseller._id) });
  } catch (err) {
    console.error('[reseller] credit error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /codes/generate — reseller self-service code generation.
// Deducts from their per-plan credit (atomically) and mints a batch of
// plaintext codes; the subscription duration starts on customer activation.
router.post('/codes/generate', async (req, res) => {
  // Credit rollback state — must live at the handler level so the outer catch
  // can restore the reseller's credit if anything throws after the deduction.
  let creditDeducted = false;
  let planId = null;
  let qty = 0;
  const rollbackCredit = () =>
    Reseller.updateOne({ _id: req.reseller._id, 'credit.planId': planId }, { $inc: { 'credit.$.quantity': qty } }).exec();
  try {
    const body = req.body || {};
    planId = body.planId ?? null;
    qty = Number(body.quantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      return res.status(400).json({ success: false, error: 'quantity must be an integer between 1 and 50' });
    }
    if (!parseId(planId)) return res.status(400).json({ success: false, error: 'planId is required' });

    const plan = await Plan.findById(planId).lean().exec();
    if (!plan || plan.status !== 'Active') {
      return res.status(400).json({ success: false, error: 'Plan not found or inactive' });
    }

    // Atomic credit deduction: only succeeds if enough credit remains for this plan.
    const updated = await Reseller.findOneAndUpdate(
      { _id: req.reseller._id, credit: { $elemMatch: { planId, quantity: { $gte: qty } } } },
      { $inc: { 'credit.$.quantity': -qty } },
      { new: true },
    )
      .select('credit')
      .lean()
      .exec();
    if (!updated) {
      return res.status(400).json({ success: false, error: 'Insufficient credit for this plan', code: 'INSUFFICIENT_CREDIT' });
    }

    // From here on, ANY failure must put the deducted credit back — otherwise
    // the reseller pays twice for codes they never received.
    creditDeducted = true;

    // Sequential batch number per reseller (دفعة 1، 2، …) so self-generated
    // codes also appear in their batches list and exportable sheets.
    let batch = null;
    try {
      const lastBatch = await CodeBatch.findOne({ resellerId: req.reseller._id }).sort({ batchNumber: -1 }).select('batchNumber').lean().exec();
      let batchNumber = (lastBatch?.batchNumber || 0) + 1;
      // batchNumber is unique per { resellerId, batchNumber }; two concurrent
      // generations can collide on the same number — retry with the next one.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          batch = await CodeBatch.create({
            resellerId: req.reseller._id,
            planId,
            batchNumber,
            quantity: qty,
            receiptDate: new Date(),
            notes: 'توليد ذاتي من بوابة الموزعين',
            status: 'delivered',
          });
          break;
        } catch (batchErr) {
          if (batchErr?.code === 11000 && attempt < 2) {
            batchNumber += 1;
            continue;
          }
          await rollbackCredit();
          throw batchErr;
        }
      }
    } catch (err) {
      console.error('[reseller] batch create error:', err);
      return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }

    // Codes generated by resellers expire after the configured window; the
    // credit is returned automatically when they expire unused.
    const codeExpiryDays = await getCodeExpiryDays();
    const result = await generateCodes({
      planId: String(planId),
      quantity: qty,
      prefix: req.reseller.prefix || 'DZHF',
      codeExpiresInDays: codeExpiryDays,
      resellerId: String(req.reseller._id),
      batchId: String(batch._id),
    });

    if (!result.ok) {
      // Roll back credit + batch on failure.
      await Promise.all([
        rollbackCredit(),
        CodeBatch.findByIdAndDelete(batch._id).exec(),
      ]);
      return res.status(400).json({ success: false, error: result.error });
    }

    const remainingCredit = (updated.credit || []).find((c) => String(c.planId) === String(planId));
    await recordCreditTx({
      resellerId: String(req.reseller._id),
      planId: String(planId),
      type: 'CONSUME',
      quantity: -qty,
      balanceAfter: remainingCredit ? remainingCredit.quantity : 0,
      note: `توليد ${qty} كود (دفعة ${batch.batchNumber}) — تنتهي خلال ${codeExpiryDays} يومًا`,
    });
    res.status(201).json({
      success: true,
      data: {
        batch: {
          _id: batch._id,
          batchNumber: batch.batchNumber,
          plan: { name: plan.name, durationDays: plan.durationDays },
          receiptDate: batch.receiptDate,
        },
        codes: result.codes, // plaintext — shown once to the reseller
        codeExpiresAt: result.codes.length
          ? new Date(Date.now() + codeExpiryDays * 24 * 60 * 60 * 1000).toISOString()
          : null,
        remainingCredit: remainingCredit ? remainingCredit.quantity : 0,
      },
    });
  } catch (err) {
    // Any throw after the credit deduction (e.g. generateCodes failing) must
    // restore the reseller's credit — never let them pay for codes they don't get.
    if (creditDeducted) {
      try {
        await Reseller.updateOne(
          { _id: req.reseller._id, 'credit.planId': planId },
          { $inc: { 'credit.$.quantity': qty } },
        ).exec();
      } catch (rollbackErr) {
        console.error('[reseller] generate credit rollback failed:', rollbackErr);
      }
    }
    console.error('[reseller] generate error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /batches — this reseller's deliveries with code stats
router.get('/batches', async (req, res) => {
  try {
    const batches = await CodeBatch.find({ resellerId: req.reseller._id }).sort({ createdAt: -1 }).lean();
    const ids = batches.map((b) => b._id);
    const stats = ids.length
      ? await ActivationCode.aggregate([
          { $match: { batchId: { $in: ids } } },
          {
            $group: {
              _id: '$batchId',
              total: { $sum: 1 },
              activated: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVATED'] }, 1, 0] } },
              revoked: { $sum: { $cond: [{ $eq: ['$status', 'REVOKED'] }, 1, 0] } },
            },
          },
        ])
      : [];
    const statsByBatch = new Map(stats.map((s) => [String(s._id), s]));
    const planIds = [...new Set(batches.map((b) => String(b.planId)))];
    const plans = await Plan.find({ _id: { $in: planIds } }).select('name durationDays').lean();
    const planMap = new Map(plans.map((p) => [String(p._id), p]));

    const data = batches.map((b) => {
      const st = statsByBatch.get(String(b._id)) || { total: 0, activated: 0, revoked: 0 };
      return {
        _id: b._id,
        batchNumber: b.batchNumber,
        plan: planMap.get(String(b.planId)) || null,
        receiptDate: b.receiptDate,
        notes: b.notes || '',
        stats: {
          total: st.total,
          activated: st.activated,
          remaining: Math.max(st.total - st.activated - st.revoked, 0),
          revoked: st.revoked,
        },
      };
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[reseller] batches error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /batches/:id/codes — PLAINTEXT codes of one of their batches (they sell these).
// Activated codes also expose the subscription window (the days the customer got).
router.get('/batches/:id/codes', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const batch = await CodeBatch.findOne({ _id: id, resellerId: req.reseller._id }).lean().exec();
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });
    const codes = await ActivationCode.find({ batchId: id })
      .select('+codeEnc prefix codeLast4 status activatedAt')
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    // For activated codes, resolve the subscription window via the redemption link.
    const activated = codes.filter((c) => c.status === 'ACTIVATED');
    const redemptions = activated.length
      ? await ActivationRedemption.find({ activationCodeId: { $in: activated.map((c) => c._id) } })
          .select('activationCodeId subscriptionId')
          .lean()
          .exec()
      : [];
    const subIds = [...new Set(redemptions.map((r) => r.subscriptionId).filter(Boolean))];
    const subs = subIds.length
      ? await Subscription.find({ _id: { $in: subIds } }).select('startsAt expiresAt').lean().exec()
      : [];
    const subMap = new Map(subs.map((s) => [String(s._id), s]));
    const subByCode = new Map();
    for (const r of redemptions) {
      if (r.subscriptionId && subMap.has(String(r.subscriptionId))) {
        subByCode.set(String(r.activationCodeId), subMap.get(String(r.subscriptionId)));
      }
    }

    const data = codes.map((c) => {
      const sub = subByCode.get(String(c._id));
      return {
        _id: c._id,
        code: c.codeEnc ? decryptSecret(c.codeEnc) : `${c.prefix}-••••-••••-${c.codeLast4}`,
        status: c.status,
        activatedAt: c.activatedAt || null,
        subscriptionStartsAt: sub?.startsAt || null,
        subscriptionExpiresAt: sub?.expiresAt || null,
      };
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[reseller] codes error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /batches/:id/export — printable sheet of one of their batches
router.get('/batches/:id/export', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const batch = await CodeBatch.findOne({ _id: id, resellerId: req.reseller._id }).lean().exec();
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });
    const [plan, codes] = await Promise.all([
      Plan.findById(batch.planId).lean().exec(),
      ActivationCode.find({ batchId: id }).select('codeEnc prefix codeLast4 status').lean().exec(),
    ]);
    const lines = [];
    lines.push('==============================================');
    lines.push('          DZ HOOF — دفعة أكواد التفعيل');
    lines.push('==============================================');
    lines.push(`المحل: ${req.reseller.name}  |  المدينة: ${req.reseller.city || '—'}`);
    lines.push(`رقم الدفعة: ${batch.batchNumber}  |  تاريخ الاستلام: ${batch.receiptDate.toISOString().slice(0, 10)}`);
    lines.push(`المدة: ${plan?.name || '—'} (${plan?.durationDays || '?'} يومًا)  |  عدد الأكواد: ${codes.length}`);
    lines.push('----------------------------------------------');
    codes.forEach((c, i) => {
      const plain = c.codeEnc ? decryptSecret(c.codeEnc) : `${c.prefix}-••••-••••-${c.codeLast4}`;
      const statusMark = c.status === 'ACTIVATED' ? ' [مفعّل]' : c.status === 'REVOKED' ? ' [ملغي]' : '';
      lines.push(`${String(i + 1).padStart(3)}. ${plain}${statusMark}`);
    });
    lines.push('----------------------------------------------');
    lines.push('كل كود يُفعّل مرة واحدة على جهاز واحد.');
    const fileName = `dzhoof-batch-${batch.batchNumber}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[reseller] export error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─── Customer debts (ديون الزبائن) ─────────────────────────────
// Lets a reseller record credit given to customers who haven't paid yet,
// see who owes him (oldest unpaid first), settle debts, and jump to a
// WhatsApp reminder. Self-service, reseller-scoped only.
const ResellerDebt = require('../models/ResellerDebt');

function parseDebtId(id) {
  return mongoose.isValidObjectId(id) ? id : null;
}

function parseDebtAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function parseDebtQuantity(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100000) return null;
  return n;
}

// GET /debts — list (UNPAID first, then newest) + summary of what's still owed
router.get('/debts', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { resellerId: req.reseller._id };
    if (['UNPAID', 'PARTIAL', 'PAID'].includes(status)) filter.status = status;

    const [debts, summary, totalDebts] = await Promise.all([
      // UNPAID first (oldest first), then PARTIAL, then PAID — computed on the
      // server so the cap never cuts the debts the reseller must see first.
      ResellerDebt.aggregate([
        { $match: filter },
        {
          $addFields: {
            statusOrder: {
              $switch: {
                branches: [
                  { case: { $eq: ['$status', 'UNPAID'] }, then: 0 },
                  { case: { $eq: ['$status', 'PARTIAL'] }, then: 1 },
                ],
                default: 2,
              },
            },
          },
        },
        { $sort: { statusOrder: 1, createdAt: 1 } },
        { $limit: 1000 },
      ]).exec(),
      ResellerDebt.aggregate([
        { $match: { resellerId: req.reseller._id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            remaining: {
              $sum: { $subtract: ['$amount', { $ifNull: ['$paidAmount', 0] }] },
            },
          },
        },
      ]).exec(),
      ResellerDebt.countDocuments({ resellerId: req.reseller._id }).exec(),
    ]);

    const byStatus = Object.fromEntries(summary.map((s) => [s._id, s]));
    const outstanding = (byStatus.UNPAID?.remaining || 0) + (byStatus.PARTIAL?.remaining || 0);
    const unpaidCount = (byStatus.UNPAID?.count || 0) + (byStatus.PARTIAL?.count || 0);

    const data = debts.map((d) => ({
      _id: String(d._id),
      customerName: d.customerName,
      customerPhone: d.customerPhone || '',
      amount: d.amount,
      paidAmount: d.paidAmount || 0,
      remaining: Math.round((d.amount - (d.paidAmount || 0)) * 100) / 100,
      quantity: d.quantity ?? null,
      planName: d.planName || '',
      status: d.status,
      note: d.note || '',
      paidAt: d.paidAt ? new Date(d.paidAt).toISOString() : null,
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
    }));

    return res.json({
      success: true,
      data,
      summary: { outstanding, unpaidCount, totalDebts },
    });
  } catch (err) {
    console.error('[reseller] list debts error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /debts — record a new unpaid debt
router.post('/debts', async (req, res) => {
  try {
    const { customerName, customerPhone, amount, quantity, planName, note } = req.body || {};
    const name = String(customerName || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'customerName is required' });
    }
    const amt = parseDebtAmount(amount);
    if (amt === null) {
      return res.status(400).json({ success: false, error: 'amount must be a positive number' });
    }
    const qty = parseDebtQuantity(quantity);
    if (qty === null && quantity !== undefined && quantity !== null && quantity !== '') {
      return res.status(400).json({ success: false, error: 'quantity must be a positive integer' });
    }
    const debt = await ResellerDebt.create({
      resellerId: req.reseller._id,
      customerName: name.slice(0, 100),
      customerPhone: String(customerPhone || '').trim().slice(0, 30),
      amount: amt,
      paidAmount: 0,
      quantity: qty,
      planName: String(planName || '').trim().slice(0, 100),
      note: String(note || '').trim().slice(0, 500),
      status: 'UNPAID',
    });
    audit({ ...reqCtx(req), action: 'RESELLER_DEBT_CREATE', resource: 'ResellerDebt', resourceId: String(debt._id), changes: { after: { customerName: debt.customerName, amount: debt.amount } } });
    return res.status(201).json({ success: true, data: debt });
  } catch (err) {
    console.error('[reseller] create debt error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PATCH /debts/:id — settle (full/partial) or edit
router.patch('/debts/:id', async (req, res) => {
  try {
    const id = parseDebtId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid debt id' });
    const debt = await ResellerDebt.findOne({ _id: id, resellerId: req.reseller._id }).exec();
    if (!debt) return res.status(404).json({ success: false, error: 'Debt not found' });

    const $set = {};
    if (req.body.customerName !== undefined) {
      const v = String(req.body.customerName).trim();
      if (!v) return res.status(400).json({ success: false, error: 'customerName cannot be empty' });
      $set.customerName = v.slice(0, 100);
    }
    if (req.body.customerPhone !== undefined) $set.customerPhone = String(req.body.customerPhone).trim().slice(0, 30);
    if (req.body.amount !== undefined) {
      const v = parseDebtAmount(req.body.amount);
      if (v === null) return res.status(400).json({ success: false, error: 'amount must be a non-negative number' });
      $set.amount = v;
    }
    if (req.body.note !== undefined) $set.note = String(req.body.note).trim().slice(0, 500);
    if (req.body.planName !== undefined) $set.planName = String(req.body.planName).trim().slice(0, 100);

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
        // PARTIAL: paidAmount defaults to current (or explicit)
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
    const updated = await ResellerDebt.findOneAndUpdate({ _id: id, resellerId: req.reseller._id }, { $set }, { new: true }).lean().exec();
    audit({ ...reqCtx(req), action: 'RESELLER_DEBT_UPDATE', resource: 'ResellerDebt', resourceId: String(id), changes: { after: $set } });
    return res.json({
      success: true,
      data: {
        _id: String(updated._id),
        customerName: updated.customerName,
        amount: updated.amount,
        paidAmount: updated.paidAmount,
        remaining: Math.round((updated.amount - updated.paidAmount) * 100) / 100,
        status: updated.status,
        paidAt: updated.paidAt ? new Date(updated.paidAt).toISOString() : null,
      },
    });
  } catch (err) {
    console.error('[reseller] update debt error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// DELETE /debts/:id
router.delete('/debts/:id', async (req, res) => {
  try {
    const id = parseDebtId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid debt id' });
    const r = await ResellerDebt.deleteOne({ _id: id, resellerId: req.reseller._id }).exec();
    if (r.deletedCount === 0) return res.status(404).json({ success: false, error: 'Debt not found' });
    audit({ ...reqCtx(req), action: 'RESELLER_DEBT_DELETE', resource: 'ResellerDebt', resourceId: String(id) });
    return res.json({ success: true });
  } catch (err) {
    console.error('[reseller] delete debt error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
