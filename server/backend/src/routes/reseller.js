const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const CodeBatch = require('../models/CodeBatch');
const Plan = require('../models/Plan');
const ActivationCode = require('../models/ActivationCode');
const Reseller = require('../models/Reseller');
const Device = require('../models/Device');
const User = require('../models/User');
const SupportTicket = require('../models/SupportTicket');
const { decryptSecret } = require('../utils/crypto');
const { generateCodes, getCodeExpiryDays, recordCreditTx } = require('../services/subscription-service');
const CreditTransaction = require('../models/CreditTransaction');
const ActivationRedemption = require('../models/ActivationRedemption');
const Subscription = require('../models/Subscription');
const { requireReseller } = require('../middleware/requireReseller');
const { audit, reqCtx } = require('../services/audit-log');
const { getPublicBaseUrl } = require('../utils/public-url');

// Reseller portal (بوابة الموزعين): /api/v1/reseller/*
router.use(requireReseller);

// ─── Permission matrix (مصفوفة صلاحيات الموزع) ─────────────────────────
// Every flag defaults to ON so existing resellers keep full access. Admins
// switch features off per shop; a disabled feature returns 403 PERMISSION_DENIED.
const PERMISSION_DEFAULTS = {
  generateCodes: true,
  transfers: true,
  renew: true,
  changePackage: true,
  suspend: true,
  exportM3U: true,
  viewHistory: true,
};

function hasPerm(reseller, key) {
  const perms = reseller.permissions || {};
  return perms[key] !== undefined ? perms[key] : PERMISSION_DEFAULTS[key];
}

function deny(res, key) {
  return res.status(403).json({
    success: false,
    error: 'This feature is disabled for your account. Contact the admin.',
    code: 'PERMISSION_DENIED',
    permission: key,
  });
}

function parseId(id) {
  return mongoose.isValidObjectId(id) ? id : null;
}

/** Find a code owned by this reseller + its most recent subscription. */
async function codeWithSubscription(resellerId, codeId) {
  const code = await ActivationCode.findOne({ _id: codeId, resellerId }).lean().exec();
  if (!code) return { code: null, subscription: null };
  const subscription = await Subscription.findOne({ activationCodeId: code._id })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  return { code, subscription };
}

/** Atomic credit deduction for one plan; returns remaining balance or null. */
async function consumeCredit(resellerId, planId, qty = 1) {
  const updated = await Reseller.findOneAndUpdate(
    { _id: resellerId, credit: { $elemMatch: { planId, quantity: { $gte: qty } } } },
    { $inc: { 'credit.$.quantity': -qty } },
    { new: true },
  )
    .select('credit')
    .lean()
    .exec();
  if (!updated) return null;
  return (updated.credit || []).find((c) => String(c.planId) === String(planId))?.quantity || 0;
}

/** Credit of this reseller enriched with plan info: [{planId, quantity, plan}] */
async function resellerCredit(resellerId) {
  const reseller = await Reseller.findById(resellerId).lean().exec();
  const credit = reseller?.credit || [];
  const planIds = [...new Set(credit.map((c) => String(c.planId)))];
  const plans = planIds.length
    ? await Plan.find({ _id: { $in: planIds } }).select('name durationDays status allowCustomDuration').lean()
    : [];
  const planMap = new Map(plans.map((p) => [String(p._id), p]));
  return credit
    .filter((c) => planMap.get(String(c.planId)))
    .map((c) => ({
      planId: String(c.planId),
      quantity: c.quantity,
      plan: {
        name: planMap.get(String(c.planId)).name,
        durationDays: planMap.get(String(c.planId)).durationDays,
        allowCustomDuration: Boolean(planMap.get(String(c.planId)).allowCustomDuration),
      },
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
        permissions: {
          generateCodes: hasPerm(r, 'generateCodes'),
          transfers: hasPerm(r, 'transfers'),
          renew: hasPerm(r, 'renew'),
          changePackage: hasPerm(r, 'changePackage'),
          suspend: hasPerm(r, 'suspend'),
          exportM3U: hasPerm(r, 'exportM3U'),
          viewHistory: hasPerm(r, 'viewHistory'),
        },
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

// GET /statement — this reseller's financial statement (كشف حساب):
// purchase value, consumption, returns, running balance + CSV export.
router.get('/statement', async (req, res) => {
  try {
    const rows = await CreditTransaction.find({ resellerId: req.reseller._id })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const planIds = [...new Set(rows.map((r) => String(r.planId)))];
    const plans = planIds.length ? await Plan.find({ _id: { $in: planIds } }).select('name').lean() : [];
    const planMap = new Map(plans.map((p) => [String(p._id), p.name]));

    const data = rows.map((r) => ({
      _id: r._id,
      type: r.type,
      quantity: r.quantity,
      unitPrice: r.unitPrice || 0,
      amount: r.amount || 0,
      balanceAfter: r.balanceAfter,
      planName: planMap.get(String(r.planId)) || '—',
      note: r.note || '',
      createdAt: r.createdAt,
    }));

    const summary = {
      granted: data.filter((r) => r.type === 'GRANT').reduce((s, r) => s + r.quantity, 0),
      consumed: Math.abs(data.filter((r) => r.type === 'CONSUME').reduce((s, r) => s + r.quantity, 0)),
      returned: Math.abs(data.filter((r) => r.type === 'RETURN' || r.type === 'EXPIRE_RETURN').reduce((s, r) => s + r.quantity, 0)),
      purchaseValue: data.reduce((s, r) => s + (r.type === 'GRANT' ? r.amount : 0), 0),
      netCodes: data.reduce((s, r) => s + r.quantity, 0),
    };

    if (String(req.query.format).toLowerCase() === 'csv') {
      const head = 'date,type,plan,quantity,unit_price,amount,balance_after,note';
      const body = data
        .map((r) =>
          [
            new Date(r.createdAt).toISOString(),
            r.type,
            `"${String(r.planName).replace(/"/g, '""')}"`,
            r.quantity,
            r.unitPrice,
            r.amount,
            r.balanceAfter,
            `"${String(r.note).replace(/"/g, '""')}"`,
          ].join(','),
        )
        .join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="dzhoof-statement-${String(req.reseller._id).slice(-6)}.csv"`);
      return res.send(`${head}\n${body}`);
    }

    res.json({ success: true, data: { summary, rows: data, total: data.length } });
  } catch (err) {
    console.error('[reseller] statement error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /clients — this reseller's customers. Codes generated WITH customer
// info (name/phone — Round 19) are aggregated per customer, enriched with
// subscription expiry, and sorted so expiring-soon customers surface first.
router.get('/clients', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const codes = await ActivationCode.find({
      resellerId: req.reseller._id,
      $or: [{ customerName: { $nin: [null, ''] } }, { customerPhone: { $nin: [null, ''] } }],
    })
      .select('codeEnc prefix codeLast4 customerName customerPhone customDurationDays status activatedAt codeExpiresAt planId createdAt')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const planIds = [...new Set(codes.map((c) => String(c.planId)))];
    const plans = planIds.length ? await Plan.find({ _id: { $in: planIds } }).select('name').lean() : [];
    const planMap = new Map(plans.map((p) => [String(p._id), p.name]));

    // Subscription expiry per activated code (active subscriptions only).
    const activatedIds = codes.filter((c) => c.status === 'ACTIVATED').map((c) => c._id);
    const subs = activatedIds.length
      ? await Subscription.find({ activationCodeId: { $in: activatedIds }, status: 'ACTIVE' })
          .select('activationCodeId expiresAt')
          .lean()
          .exec()
      : [];
    const expiryByCode = new Map(subs.map((s) => [String(s.activationCodeId), s.expiresAt]));

    // Group by phone (digits) when present, else by normalized name.
    const clients = new Map();
    for (const c of codes) {
      const phone = String(c.customerPhone || '').replace(/\D/g, '');
      const name = String(c.customerName || '').trim();
      const key = phone || name.toLowerCase();
      if (!key) continue;
      let client = clients.get(key);
      if (!client) {
        client = { key, name, phone, codes: [] };
        clients.set(key, client);
      }
      if (!client.name && name) client.name = name;
      if (!client.phone && phone) client.phone = phone;
      client.codes.push({
        _id: c._id,
        code: c.codeEnc ? decryptSecret(c.codeEnc) : `${c.prefix}-••••-••••-${c.codeLast4}`,
        planName: planMap.get(String(c.planId)) || '—',
        planId: String(c.planId),
        status: c.status,
        activatedAt: c.activatedAt || null,
        expiresAt: expiryByCode.get(String(c._id)) || null,
        customDurationDays: c.customDurationDays || null,
      });
    }

    const now = Date.now();
    const soon = now + 7 * 24 * 60 * 60 * 1000;
    const list = [];
    for (const cl of clients.values()) {
      cl.codeCount = cl.codes.length;
      cl.activatedCount = cl.codes.filter((x) => x.status === 'ACTIVATED').length;
      const expiries = cl.codes.map((x) => x.expiresAt).filter(Boolean).map((d) => new Date(d).getTime());
      cl.nextExpiry = expiries.length ? new Date(Math.max(...expiries)).toISOString() : null;
      cl.expiringSoon = Boolean(cl.nextExpiry) && new Date(cl.nextExpiry).getTime() <= soon;
      if (search && !(cl.name.toLowerCase().includes(search) || cl.phone.includes(search))) continue;
      list.push(cl);
    }
    list.sort((a, b) => {
      if (a.expiringSoon !== b.expiringSoon) return a.expiringSoon ? -1 : 1;
      if (a.nextExpiry && b.nextExpiry) return new Date(a.nextExpiry).getTime() - new Date(b.nextExpiry).getTime();
      if (a.nextExpiry) return -1;
      if (b.nextExpiry) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    const summary = {
      totalClients: list.length,
      totalCodes: list.reduce((s, c) => s + c.codeCount, 0),
      activatedCodes: list.reduce((s, c) => s + c.activatedCount, 0),
      expiringSoon: list.filter((c) => c.expiringSoon).length,
    };
    res.json({ success: true, data: { summary, clients: list.slice(0, 500) } });
  } catch (err) {
    console.error('[reseller] clients error:', err);
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
  if (!hasPerm(req.reseller, 'generateCodes')) return deny(res, 'generateCodes');
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

    // Optional customer details captured at generation time (MIBOX-style).
    const customerName =
      body.customerName !== undefined && body.customerName !== null && String(body.customerName).trim() !== ''
        ? String(body.customerName).trim().slice(0, 100)
        : null;
    const customerPhone =
      body.customerPhone !== undefined && body.customerPhone !== null && String(body.customerPhone).trim() !== ''
        ? String(body.customerPhone).trim().slice(0, 30)
        : null;

    // Optional custom duration override — only allowed on plans explicitly
    // configured with allowCustomDuration (protects the wholesale price model).
    let customDurationDays = null;
    if (body.customDays !== undefined && body.customDays !== null && body.customDays !== '') {
      const days = Number(body.customDays);
      if (!Number.isInteger(days) || days < 1 || days > 730) {
        return res.status(400).json({ success: false, error: 'customDays must be an integer between 1 and 730' });
      }
      customDurationDays = days;
    }

    const plan = await Plan.findById(planId).lean().exec();
    if (!plan || plan.status !== 'Active') {
      return res.status(400).json({ success: false, error: 'Plan not found or inactive' });
    }
    if (customDurationDays !== null && !plan.allowCustomDuration) {
      return res
        .status(400)
        .json({ success: false, error: 'This plan does not allow custom durations', code: 'CUSTOM_DURATION_NOT_ALLOWED' });
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
      customerName,
      customerPhone,
      customDurationDays,
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
      ActivationCode.find({ batchId: id }).select('codeEnc prefix codeLast4 status customerName customerPhone customDurationDays').lean().exec(),
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
      const customer =
        c.customerName || c.customerPhone
          ? `  —  ${c.customerName || ''}${c.customerPhone ? ` (${c.customerPhone})` : ''}`
          : '';
      const customDur = c.customDurationDays ? `  [${c.customDurationDays} يوم]` : '';
      lines.push(`${String(i + 1).padStart(3)}. ${plain}${statusMark}${customer}${customDur}`);
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

// ─── Reseller-to-reseller credit transfers (تحويل رصيد بين الموزعين) ──
// A reseller can send code credit of a plan to another reseller; both sides
// get a ledger row and the sender's credit is deducted atomically.

// GET /transfers — this reseller's transfer history (in + out)
router.get('/transfers', async (req, res) => {
  try {
    const rows = await CreditTransaction.find({
      resellerId: req.reseller._id,
      type: { $in: ['TRANSFER_IN', 'TRANSFER_OUT'] },
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();
    const planIds = [...new Set(rows.map((r) => String(r.planId)))];
    const plans = planIds.length ? await Plan.find({ _id: { $in: planIds } }).select('name durationDays').lean() : [];
    const planMap = new Map(plans.map((p) => [String(p._id), p]));
    const counterpartyIds = [...new Set(rows.map((r) => (r.counterpartyId ? String(r.counterpartyId) : null)).filter(Boolean))];
    const resellers = counterpartyIds.length
      ? await Reseller.find({ _id: { $in: counterpartyIds } }).select('name city username').lean()
      : [];
    const resellerMap = new Map(resellers.map((r) => [String(r._id), r]));
    const data = rows.map((r) => ({
      _id: r._id,
      type: r.type,
      quantity: r.quantity,
      balanceAfter: r.balanceAfter,
      plan: planMap.get(String(r.planId)) || null,
      counterparty: r.counterpartyId
        ? {
            _id: r.counterpartyId,
            name: resellerMap.get(String(r.counterpartyId))?.name || '—',
            city: resellerMap.get(String(r.counterpartyId))?.city || '',
          }
        : null,
      note: r.note || '',
      createdAt: r.createdAt,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[reseller] transfers list error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /transfers — send plan credit to another reseller
router.post('/transfers', async (req, res) => {
  if (!hasPerm(req.reseller, 'transfers')) return deny(res, 'transfers');
  let creditDeducted = false;
  let planId = null;
  let qty = 0;
  const rollback = () =>
    Reseller.updateOne({ _id: req.reseller._id, 'credit.planId': planId }, { $inc: { 'credit.$.quantity': qty } }).exec();
  try {
    const { toUsername, planId: bodyPlanId, quantity } = req.body || {};
    planId = bodyPlanId ?? null;
    qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) {
      return res.status(400).json({ success: false, error: 'quantity must be an integer between 1 and 100000' });
    }
    if (!parseId(planId)) return res.status(400).json({ success: false, error: 'planId is required' });
    const toUser = String(toUsername || '').trim().toLowerCase();
    if (!toUser) return res.status(400).json({ success: false, error: 'toUsername is required' });
    if (toUser === String(req.reseller.username || '').toLowerCase()) {
      return res.status(400).json({ success: false, error: 'Cannot transfer credit to yourself' });
    }
    // Usernames are admin-constrained to [a-z0-9_.-]; enforce the same shape
    // here so the lookup value is a plain safe string (no query operators).
    if (!/^[a-z0-9_.-]{1,50}$/.test(toUser)) {
      return res.status(400).json({ success: false, error: 'Invalid recipient username' });
    }
    // NOTE(CodeQL js/nosql-injection): the $eq value below is regex-constrained
    // to [a-z0-9_.-] — MongoDB operator injection requires keys starting with
    // '
      Reseller.findOne({ username: { $eq: toUser } }).select('name city username status credit').lean().exec(),
      // planId already passed parseId() above — construct a typed ObjectId so
      // the query never receives raw client text.
      Plan.findOne({ _id: new mongoose.Types.ObjectId(planId) }).select('name durationDays status').lean().exec(),
    ]);
    if (!recipient) return res.status(404).json({ success: false, error: 'Recipient reseller not found' });
    if (recipient.status !== 'Active') {
      return res.status(400).json({ success: false, error: 'Recipient reseller is inactive' });
    }
    if (!plan || plan.status !== 'Active') {
      return res.status(400).json({ success: false, error: 'Plan not found or inactive' });
    }

    // Atomic deduction from the sender — never below zero.
    const senderUpdated = await consumeCredit(String(req.reseller._id), String(planId), qty);
    if (senderUpdated === null) {
      return res.status(400).json({ success: false, error: 'Insufficient credit for this plan', code: 'INSUFFICIENT_CREDIT' });
    }
    creditDeducted = true;

    // Credit the recipient: increment an existing entry or create a new one.
    const planObjId = new mongoose.Types.ObjectId(planId);
    const recipientUpdated = await Reseller.findOneAndUpdate(
      { _id: recipient._id, 'credit.planId': planObjId },
      { $inc: { 'credit.$.quantity': qty } },
      { new: true },
    )
      .select('credit')
      .lean()
      .exec();
    let recipientBalance = qty;
    if (!recipientUpdated) {
      await Reseller.updateOne(
        { _id: recipient._id },
        { $push: { credit: { planId: new mongoose.Types.ObjectId(String(planId)), quantity: qty } } },
      ).exec();
    } else {
      recipientBalance =
        (recipientUpdated.credit || []).find((c) => String(c.planId) === String(planId))?.quantity || qty;
    }

    await Promise.all([
      recordCreditTx({
        resellerId: String(req.reseller._id),
        planId: String(planId),
        type: 'TRANSFER_OUT',
        quantity: -qty,
        balanceAfter: senderUpdated,
        note: `تحويل رصيد إلى ${recipient.name}`,
        counterpartyId: String(recipient._id),
      }),
      recordCreditTx({
        resellerId: String(recipient._id),
        planId: String(planId),
        type: 'TRANSFER_IN',
        quantity: qty,
        balanceAfter: recipientBalance,
        note: `تحويل رصيد من ${req.reseller.name}`,
        counterpartyId: String(req.reseller._id),
      }),
    ]);
    audit({
      ...reqCtx(req),
      action: 'RESELLER_CREDIT_TRANSFER',
      resource: 'Reseller',
      resourceId: String(req.reseller._id),
      changes: { after: { toResellerId: String(recipient._id), planId: String(planId), quantity: qty } },
    });
    res.status(201).json({
      success: true,
      data: {
        plan: { name: plan.name, durationDays: plan.durationDays },
        quantity: qty,
        recipient: { _id: recipient._id, name: recipient.name, city: recipient.city || '' },
        senderBalanceAfter: senderUpdated,
        recipientBalanceAfter: recipientBalance,
      },
    });
  } catch (err) {
    if (creditDeducted) {
      try {
        await rollback();
      } catch (rollbackErr) {
        console.error('[reseller] transfer credit rollback failed:', rollbackErr);
      }
    }
    console.error('[reseller] transfer error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─── Code actions (إدارة الاشتراك لكل كود) ────────────────────────────
// Renew / Change package / Suspend / Reactivate / m3u export / history.

// GET /codes/:id — full detail: plan, customer, subscription window,
// redemption history and bound devices (سجل الكود — watch logs).
router.get('/codes/:id', async (req, res) => {
  if (!hasPerm(req.reseller, 'viewHistory')) return deny(res, 'viewHistory');
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code, subscription } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });

    const [plan, redemptions] = await Promise.all([
      Plan.findById(code.planId).select('name durationDays').lean().exec(),
      ActivationRedemption.find({ activationCodeId: code._id }).sort({ createdAt: -1 }).limit(20).lean().exec(),
    ]);
    const userIds = [...new Set(redemptions.map((r) => String(r.userId)).filter(Boolean))];
    const [users, devices] = await Promise.all([
      userIds.length ? User.find({ _id: { $in: userIds } }).select('username channelListCode').lean() : [],
      userIds.length
        ? Device.find({ userId: { $in: userIds } })
            .select('deviceId name platform appVersion lastSeenAt createdAt')
            .sort({ lastSeenAt: -1 })
            .limit(20)
            .lean()
        : [],
    ]);
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const subUserId = subscription?.userId ? String(subscription.userId) : null;

    res.json({
      success: true,
      data: {
        _id: code._id,
        code: code.codeEnc ? decryptSecret(code.codeEnc) : `${code.prefix}-••••-••••-${code.codeLast4}`,
        status: code.status,
        plan: plan ? { name: plan.name, durationDays: plan.durationDays } : null,
        customerName: code.customerName || null,
        customerPhone: code.customerPhone || null,
        customDurationDays: code.customDurationDays || null,
        createdAt: code.createdAt,
        subscription: subscription
          ? {
              status: subscription.status,
              startsAt: subscription.startsAt || null,
              expiresAt: subscription.expiresAt || null,
              userId: subUserId,
              username: subUserId ? userMap.get(subUserId)?.username || null : null,
            }
          : null,
        redemptions: redemptions.map((r) => ({
          createdAt: r.createdAt,
          result: r.result,
          deviceId: r.deviceId,
          failureReason: r.failureReason,
        })),
        devices: devices.map((d) => ({
          deviceId: d.deviceId,
          name: d.name,
          platform: d.platform,
          appVersion: d.appVersion,
          lastSeenAt: d.lastSeenAt,
        })),
      },
    });
  } catch (err) {
    console.error('[reseller] code detail error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /codes/:id/renew — extend the customer's subscription by the plan
// duration (or a custom duration when the plan allows it). Consumes 1 credit
// of the code's plan; also re-activates EXPIRED/SUSPENDED subscriptions.
router.post('/codes/:id/renew', async (req, res) => {
  if (!hasPerm(req.reseller, 'renew')) return deny(res, 'renew');
  let planId = null;
  let creditDeducted = false;
  const rollback = () =>
    Reseller.updateOne({ _id: req.reseller._id, 'credit.planId': planId }, { $inc: { 'credit.$.quantity': 1 } }).exec();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code, subscription } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (!subscription) {
      return res.status(400).json({ success: false, error: 'Code has not been activated yet', code: 'NOT_ACTIVATED' });
    }
    if (subscription.status === 'CANCELLED') {
      return res.status(400).json({ success: false, error: 'Cancelled subscriptions cannot be renewed' });
    }

    planId = String(code.planId);
    const plan = await Plan.findById(planId).lean().exec();
    if (!plan || plan.status !== 'Active') {
      return res.status(400).json({ success: false, error: 'Plan not found or inactive' });
    }

    let days = plan.durationDays;
    if (req.body.customDays !== undefined && req.body.customDays !== null && req.body.customDays !== '') {
      const d = Number(req.body.customDays);
      if (!Number.isInteger(d) || d < 1 || d > 730) {
        return res.status(400).json({ success: false, error: 'customDays must be an integer between 1 and 730' });
      }
      if (!plan.allowCustomDuration) {
        return res
          .status(400)
          .json({ success: false, error: 'This plan does not allow custom durations', code: 'CUSTOM_DURATION_NOT_ALLOWED' });
      }
      days = d;
    }

    const balanceAfter = await consumeCredit(String(req.reseller._id), planId, 1);
    if (balanceAfter === null) {
      return res.status(400).json({ success: false, error: 'Insufficient credit for this plan', code: 'INSUFFICIENT_CREDIT' });
    }
    creditDeducted = true;

    const now = Date.now();
    const currentExpiry = subscription.expiresAt ? new Date(subscription.expiresAt).getTime() : now;
    const newExpiry = new Date(Math.max(now, currentExpiry) + days * 24 * 60 * 60 * 1000);
    await Subscription.updateOne(
      { _id: subscription._id },
      { $set: { expiresAt: newExpiry, status: 'ACTIVE', cancelledAt: null } },
    ).exec();
    await recordCreditTx({
      resellerId: String(req.reseller._id),
      planId,
      type: 'CONSUME',
      quantity: -1,
      balanceAfter,
      note: `تجديد اشتراك (${plan.name} +${days} يوم)`,
    });
    audit({
      ...reqCtx(req),
      action: 'RESELLER_CODE_RENEW',
      resource: 'ActivationCode',
      resourceId: String(code._id),
      changes: { after: { expiresAt: newExpiry, days } },
    });
    res.json({
      success: true,
      data: {
        codeId: code._id,
        plan: { name: plan.name, durationDays: days },
        expiresAt: newExpiry.toISOString(),
        remainingCredit: balanceAfter,
      },
    });
  } catch (err) {
    if (creditDeducted) {
      try {
        await rollback();
      } catch (rollbackErr) {
        console.error('[reseller] renew credit rollback failed:', rollbackErr);
      }
    }
    console.error('[reseller] renew error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /codes/:id/change-plan — switch the code to another plan and extend
// the subscription by the new plan's duration. Consumes 1 credit of the new
// plan; the remaining days of the old plan are forfeited (standard practice).
router.post('/codes/:id/change-plan', async (req, res) => {
  if (!hasPerm(req.reseller, 'changePackage')) return deny(res, 'changePackage');
  let planId = null;
  let creditDeducted = false;
  const rollback = () =>
    Reseller.updateOne({ _id: req.reseller._id, 'credit.planId': planId }, { $inc: { 'credit.$.quantity': 1 } }).exec();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code, subscription } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (!subscription) {
      return res.status(400).json({ success: false, error: 'Code has not been activated yet', code: 'NOT_ACTIVATED' });
    }

    const newPlanId = req.body.planId ?? null;
    if (!parseId(newPlanId)) return res.status(400).json({ success: false, error: 'planId is required' });
    if (String(newPlanId) === String(code.planId)) {
      return res.status(400).json({ success: false, error: 'Code is already on this plan' });
    }
    // newPlanId passed parseId() above — typed ObjectId keeps raw client text out of queries.
    const newPlanObjId = new mongoose.Types.ObjectId(newPlanId);
    const newPlan = await Plan.findOne({ _id: newPlanObjId }).lean().exec();
    if (!newPlan || newPlan.status !== 'Active') {
      return res.status(400).json({ success: false, error: 'Plan not found or inactive' });
    }

    planId = String(newPlanId);
    const balanceAfter = await consumeCredit(String(req.reseller._id), planId, 1);
    if (balanceAfter === null) {
      return res.status(400).json({ success: false, error: 'Insufficient credit for this plan', code: 'INSUFFICIENT_CREDIT' });
    }
    creditDeducted = true;

    const now = Date.now();
    const currentExpiry = subscription.expiresAt ? new Date(subscription.expiresAt).getTime() : now;
    const newExpiry = new Date(Math.max(now, currentExpiry) + newPlan.durationDays * 24 * 60 * 60 * 1000);
    await Promise.all([
      ActivationCode.updateOne({ _id: code._id }, { $set: { planId: new mongoose.Types.ObjectId(newPlanId) } }).exec(),
      Subscription.updateOne(
        { _id: subscription._id },
        { $set: { planId: new mongoose.Types.ObjectId(newPlanId), expiresAt: newExpiry, status: 'ACTIVE', cancelledAt: null } },
      ).exec(),
    ]);
    await recordCreditTx({
      resellerId: String(req.reseller._id),
      planId,
      type: 'CONSUME',
      quantity: -1,
      balanceAfter,
      note: `تغيير باقة إلى ${newPlan.name} (+${newPlan.durationDays} يوم)`,
    });
    audit({
      ...reqCtx(req),
      action: 'RESELLER_CODE_CHANGE_PLAN',
      resource: 'ActivationCode',
      resourceId: String(code._id),
      changes: { after: { planId: String(newPlanId), expiresAt: newExpiry } },
    });
    res.json({
      success: true,
      data: {
        codeId: code._id,
        plan: { name: newPlan.name, durationDays: newPlan.durationDays },
        expiresAt: newExpiry.toISOString(),
        remainingCredit: balanceAfter,
      },
    });
  } catch (err) {
    if (creditDeducted) {
      try {
        await rollback();
      } catch (rollbackErr) {
        console.error('[reseller] change-plan credit rollback failed:', rollbackErr);
      }
    }
    console.error('[reseller] change-plan error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /codes/:id/suspend — block the customer's subscription (playback
// denied; the code stays bound). Reversible via /reactivate.
router.post('/codes/:id/suspend', async (req, res) => {
  if (!hasPerm(req.reseller, 'suspend')) return deny(res, 'suspend');
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code, subscription } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (!subscription) {
      return res.status(400).json({ success: false, error: 'Code has not been activated yet', code: 'NOT_ACTIVATED' });
    }
    if (subscription.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, error: 'Only an active subscription can be suspended' });
    }
    await Subscription.updateOne({ _id: subscription._id }, { $set: { status: 'SUSPENDED' } }).exec();
    audit({ ...reqCtx(req), action: 'RESELLER_CODE_SUSPEND', resource: 'ActivationCode', resourceId: String(code._id) });
    res.json({ success: true, data: { codeId: code._id, status: 'SUSPENDED' } });
  } catch (err) {
    console.error('[reseller] suspend error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /codes/:id/reactivate — lift a suspension.
router.post('/codes/:id/reactivate', async (req, res) => {
  if (!hasPerm(req.reseller, 'suspend')) return deny(res, 'suspend');
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code, subscription } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (!subscription) {
      return res.status(400).json({ success: false, error: 'Code has not been activated yet', code: 'NOT_ACTIVATED' });
    }
    if (subscription.status !== 'SUSPENDED') {
      return res.status(400).json({ success: false, error: 'Only a suspended subscription can be reactivated' });
    }
    if (new Date(subscription.expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ success: false, error: 'Subscription has expired — renew it instead' });
    }
    await Subscription.updateOne({ _id: subscription._id }, { $set: { status: 'ACTIVE' } }).exec();
    audit({ ...reqCtx(req), action: 'RESELLER_CODE_REACTIVATE', resource: 'ActivationCode', resourceId: String(code._id) });
    res.json({ success: true, data: { codeId: code._id, status: 'ACTIVE' } });
  } catch (err) {
    console.error('[reseller] reactivate error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /codes/:id/m3u — the customer's full playlist (same M3U the TV app
// uses, with tokenized playback URLs). Lets the reseller hand the customer
// a working playlist for any player.
router.get('/codes/:id/m3u', async (req, res) => {
  if (!hasPerm(req.reseller, 'exportM3U')) return deny(res, 'exportM3U');
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });

    const redemption = await ActivationRedemption.findOne({ activationCodeId: code._id, result: 'SUCCESS' })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (!redemption) {
      return res.status(400).json({ success: false, error: 'Code has not been activated yet', code: 'NOT_ACTIVATED' });
    }
    const user = await User.findById(redemption.userId).exec();
    if (!user) return res.status(404).json({ success: false, error: 'Customer account not found' });

    const baseUrl = getPublicBaseUrl(req);
    const m3uContent = await user.generateUserPlaylist(baseUrl);
    const safeUsername = String(user.username || 'customer').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${safeUsername}-playlist.m3u"`);
    audit({ ...reqCtx(req), action: 'RESELLER_CODE_M3U_EXPORT', resource: 'ActivationCode', resourceId: String(code._id) });
    res.send(m3uContent);
  } catch (err) {
    console.error('[reseller] m3u export error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─── Support tickets (تذاكر الدعم) ─────────────────────────────────────
// Resellers open tickets; the admin replies from the admin panel. A reseller
// reply reopens a closed ticket; closing is available to both sides.

// GET /tickets — own tickets, newest first, with status filter.
router.get('/tickets', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { resellerId: req.reseller._id };
    // Whitelisted via a constant lookup — the query never contains client text.
    const STATUS_VALUES = { OPEN: 'OPEN', PENDING: 'PENDING', CLOSED: 'CLOSED' };
    if (typeof status === 'string' && STATUS_VALUES[status]) filter.status = STATUS_VALUES[status];
    const tickets = await SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();
    const data = tickets.map((t) => ({
      _id: t._id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      messageCount: (t.messages || []).length,
      lastMessage: t.messages?.length
        ? { author: t.messages[t.messages.length - 1].author, body: t.messages[t.messages.length - 1].body, createdAt: t.messages[t.messages.length - 1].createdAt }
        : null,
      closedAt: t.closedAt || null,
      createdAt: t.createdAt,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[reseller] tickets list error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /tickets — open a new support ticket.
router.post('/tickets', async (req, res) => {
  try {
    const { subject, body, priority } = req.body || {};
    const cleanSubject = String(subject || '').trim().slice(0, 200);
    const cleanBody = String(body || '').trim().slice(0, 4000);
    if (!cleanSubject) return res.status(400).json({ success: false, error: 'subject is required' });
    if (!cleanBody) return res.status(400).json({ success: false, error: 'body is required' });
    const cleanPriority = ['LOW', 'MEDIUM', 'HIGH'].includes(priority) ? priority : 'MEDIUM';
    const ticket = await SupportTicket.create({
      resellerId: req.reseller._id,
      subject: cleanSubject,
      priority: cleanPriority,
      status: 'OPEN',
      messages: [{ author: 'reseller', body: cleanBody }],
    });
    audit({
      ...reqCtx(req),
      action: 'RESELLER_TICKET_CREATE',
      resource: 'SupportTicket',
      resourceId: String(ticket._id),
      changes: { after: { subject: cleanSubject, priority: cleanPriority } },
    });
    res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    console.error('[reseller] ticket create error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /tickets/:id — full thread (own ticket only).
router.get('/tickets/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ticket id' });
    const ticket = await SupportTicket.findOne({ _id: id, resellerId: req.reseller._id }).lean().exec();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    res.json({ success: true, data: ticket });
  } catch (err) {
    console.error('[reseller] ticket detail error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /tickets/:id/reply — append a message; reopens closed tickets.
router.post('/tickets/:id/reply', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ticket id' });
    const ticket = await SupportTicket.findOne({ _id: id, resellerId: req.reseller._id }).exec();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    const body = String(req.body?.body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ success: false, error: 'body is required' });
    ticket.messages.push({ author: 'reseller', body });
    ticket.status = 'OPEN';
    ticket.closedAt = null;
    await ticket.save();
    audit({ ...reqCtx(req), action: 'RESELLER_TICKET_REPLY', resource: 'SupportTicket', resourceId: String(ticket._id) });
    res.json({ success: true, data: ticket });
  } catch (err) {
    console.error('[reseller] ticket reply error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /tickets/:id/close
router.post('/tickets/:id/close', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ticket id' });
    const ticket = await SupportTicket.findOne({ _id: id, resellerId: req.reseller._id }).exec();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    ticket.status = 'CLOSED';
    ticket.closedAt = new Date();
    await ticket.save();
    audit({ ...reqCtx(req), action: 'RESELLER_TICKET_CLOSE', resource: 'SupportTicket', resourceId: String(ticket._id) });
    res.json({ success: true, data: { _id: ticket._id, status: 'CLOSED' } });
  } catch (err) {
    console.error('[reseller] ticket close error:', err);
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
 or '{'/'}', which cannot appear. This is a validated primitive value.

    const [recipient, plan] = await Promise.all([
      Reseller.findOne({ username: { $eq: toUser } }).select('name city username status credit').lean().exec(),
      // planId already passed parseId() above — construct a typed ObjectId so
      // the query never receives raw client text.
      Plan.findOne({ _id: new mongoose.Types.ObjectId(planId) }).select('name durationDays status').lean().exec(),
    ]);
    if (!recipient) return res.status(404).json({ success: false, error: 'Recipient reseller not found' });
    if (recipient.status !== 'Active') {
      return res.status(400).json({ success: false, error: 'Recipient reseller is inactive' });
    }
    if (!plan || plan.status !== 'Active') {
      return res.status(400).json({ success: false, error: 'Plan not found or inactive' });
    }

    // Atomic deduction from the sender — never below zero.
    const senderUpdated = await consumeCredit(String(req.reseller._id), String(planId), qty);
    if (senderUpdated === null) {
      return res.status(400).json({ success: false, error: 'Insufficient credit for this plan', code: 'INSUFFICIENT_CREDIT' });
    }
    creditDeducted = true;

    // Credit the recipient: increment an existing entry or create a new one.
    const planObjId = new mongoose.Types.ObjectId(planId);
    const recipientUpdated = await Reseller.findOneAndUpdate(
      { _id: recipient._id, 'credit.planId': planObjId },
      { $inc: { 'credit.$.quantity': qty } },
      { new: true },
    )
      .select('credit')
      .lean()
      .exec();
    let recipientBalance = qty;
    if (!recipientUpdated) {
      await Reseller.updateOne(
        { _id: recipient._id },
        { $push: { credit: { planId: new mongoose.Types.ObjectId(String(planId)), quantity: qty } } },
      ).exec();
    } else {
      recipientBalance =
        (recipientUpdated.credit || []).find((c) => String(c.planId) === String(planId))?.quantity || qty;
    }

    await Promise.all([
      recordCreditTx({
        resellerId: String(req.reseller._id),
        planId: String(planId),
        type: 'TRANSFER_OUT',
        quantity: -qty,
        balanceAfter: senderUpdated,
        note: `تحويل رصيد إلى ${recipient.name}`,
        counterpartyId: String(recipient._id),
      }),
      recordCreditTx({
        resellerId: String(recipient._id),
        planId: String(planId),
        type: 'TRANSFER_IN',
        quantity: qty,
        balanceAfter: recipientBalance,
        note: `تحويل رصيد من ${req.reseller.name}`,
        counterpartyId: String(req.reseller._id),
      }),
    ]);
    audit({
      ...reqCtx(req),
      action: 'RESELLER_CREDIT_TRANSFER',
      resource: 'Reseller',
      resourceId: String(req.reseller._id),
      changes: { after: { toResellerId: String(recipient._id), planId: String(planId), quantity: qty } },
    });
    res.status(201).json({
      success: true,
      data: {
        plan: { name: plan.name, durationDays: plan.durationDays },
        quantity: qty,
        recipient: { _id: recipient._id, name: recipient.name, city: recipient.city || '' },
        senderBalanceAfter: senderUpdated,
        recipientBalanceAfter: recipientBalance,
      },
    });
  } catch (err) {
    if (creditDeducted) {
      try {
        await rollback();
      } catch (rollbackErr) {
        console.error('[reseller] transfer credit rollback failed:', rollbackErr);
      }
    }
    console.error('[reseller] transfer error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─── Code actions (إدارة الاشتراك لكل كود) ────────────────────────────
// Renew / Change package / Suspend / Reactivate / m3u export / history.

// GET /codes/:id — full detail: plan, customer, subscription window,
// redemption history and bound devices (سجل الكود — watch logs).
router.get('/codes/:id', async (req, res) => {
  if (!hasPerm(req.reseller, 'viewHistory')) return deny(res, 'viewHistory');
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code, subscription } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });

    const [plan, redemptions] = await Promise.all([
      Plan.findById(code.planId).select('name durationDays').lean().exec(),
      ActivationRedemption.find({ activationCodeId: code._id }).sort({ createdAt: -1 }).limit(20).lean().exec(),
    ]);
    const userIds = [...new Set(redemptions.map((r) => String(r.userId)).filter(Boolean))];
    const [users, devices] = await Promise.all([
      userIds.length ? User.find({ _id: { $in: userIds } }).select('username channelListCode').lean() : [],
      userIds.length
        ? Device.find({ userId: { $in: userIds } })
            .select('deviceId name platform appVersion lastSeenAt createdAt')
            .sort({ lastSeenAt: -1 })
            .limit(20)
            .lean()
        : [],
    ]);
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const subUserId = subscription?.userId ? String(subscription.userId) : null;

    res.json({
      success: true,
      data: {
        _id: code._id,
        code: code.codeEnc ? decryptSecret(code.codeEnc) : `${code.prefix}-••••-••••-${code.codeLast4}`,
        status: code.status,
        plan: plan ? { name: plan.name, durationDays: plan.durationDays } : null,
        customerName: code.customerName || null,
        customerPhone: code.customerPhone || null,
        customDurationDays: code.customDurationDays || null,
        createdAt: code.createdAt,
        subscription: subscription
          ? {
              status: subscription.status,
              startsAt: subscription.startsAt || null,
              expiresAt: subscription.expiresAt || null,
              userId: subUserId,
              username: subUserId ? userMap.get(subUserId)?.username || null : null,
            }
          : null,
        redemptions: redemptions.map((r) => ({
          createdAt: r.createdAt,
          result: r.result,
          deviceId: r.deviceId,
          failureReason: r.failureReason,
        })),
        devices: devices.map((d) => ({
          deviceId: d.deviceId,
          name: d.name,
          platform: d.platform,
          appVersion: d.appVersion,
          lastSeenAt: d.lastSeenAt,
        })),
      },
    });
  } catch (err) {
    console.error('[reseller] code detail error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /codes/:id/renew — extend the customer's subscription by the plan
// duration (or a custom duration when the plan allows it). Consumes 1 credit
// of the code's plan; also re-activates EXPIRED/SUSPENDED subscriptions.
router.post('/codes/:id/renew', async (req, res) => {
  if (!hasPerm(req.reseller, 'renew')) return deny(res, 'renew');
  let planId = null;
  let creditDeducted = false;
  const rollback = () =>
    Reseller.updateOne({ _id: req.reseller._id, 'credit.planId': planId }, { $inc: { 'credit.$.quantity': 1 } }).exec();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code, subscription } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (!subscription) {
      return res.status(400).json({ success: false, error: 'Code has not been activated yet', code: 'NOT_ACTIVATED' });
    }
    if (subscription.status === 'CANCELLED') {
      return res.status(400).json({ success: false, error: 'Cancelled subscriptions cannot be renewed' });
    }

    planId = String(code.planId);
    const plan = await Plan.findById(planId).lean().exec();
    if (!plan || plan.status !== 'Active') {
      return res.status(400).json({ success: false, error: 'Plan not found or inactive' });
    }

    let days = plan.durationDays;
    if (req.body.customDays !== undefined && req.body.customDays !== null && req.body.customDays !== '') {
      const d = Number(req.body.customDays);
      if (!Number.isInteger(d) || d < 1 || d > 730) {
        return res.status(400).json({ success: false, error: 'customDays must be an integer between 1 and 730' });
      }
      if (!plan.allowCustomDuration) {
        return res
          .status(400)
          .json({ success: false, error: 'This plan does not allow custom durations', code: 'CUSTOM_DURATION_NOT_ALLOWED' });
      }
      days = d;
    }

    const balanceAfter = await consumeCredit(String(req.reseller._id), planId, 1);
    if (balanceAfter === null) {
      return res.status(400).json({ success: false, error: 'Insufficient credit for this plan', code: 'INSUFFICIENT_CREDIT' });
    }
    creditDeducted = true;

    const now = Date.now();
    const currentExpiry = subscription.expiresAt ? new Date(subscription.expiresAt).getTime() : now;
    const newExpiry = new Date(Math.max(now, currentExpiry) + days * 24 * 60 * 60 * 1000);
    await Subscription.updateOne(
      { _id: subscription._id },
      { $set: { expiresAt: newExpiry, status: 'ACTIVE', cancelledAt: null } },
    ).exec();
    await recordCreditTx({
      resellerId: String(req.reseller._id),
      planId,
      type: 'CONSUME',
      quantity: -1,
      balanceAfter,
      note: `تجديد اشتراك (${plan.name} +${days} يوم)`,
    });
    audit({
      ...reqCtx(req),
      action: 'RESELLER_CODE_RENEW',
      resource: 'ActivationCode',
      resourceId: String(code._id),
      changes: { after: { expiresAt: newExpiry, days } },
    });
    res.json({
      success: true,
      data: {
        codeId: code._id,
        plan: { name: plan.name, durationDays: days },
        expiresAt: newExpiry.toISOString(),
        remainingCredit: balanceAfter,
      },
    });
  } catch (err) {
    if (creditDeducted) {
      try {
        await rollback();
      } catch (rollbackErr) {
        console.error('[reseller] renew credit rollback failed:', rollbackErr);
      }
    }
    console.error('[reseller] renew error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /codes/:id/change-plan — switch the code to another plan and extend
// the subscription by the new plan's duration. Consumes 1 credit of the new
// plan; the remaining days of the old plan are forfeited (standard practice).
router.post('/codes/:id/change-plan', async (req, res) => {
  if (!hasPerm(req.reseller, 'changePackage')) return deny(res, 'changePackage');
  let planId = null;
  let creditDeducted = false;
  const rollback = () =>
    Reseller.updateOne({ _id: req.reseller._id, 'credit.planId': planId }, { $inc: { 'credit.$.quantity': 1 } }).exec();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code, subscription } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (!subscription) {
      return res.status(400).json({ success: false, error: 'Code has not been activated yet', code: 'NOT_ACTIVATED' });
    }

    const newPlanId = req.body.planId ?? null;
    if (!parseId(newPlanId)) return res.status(400).json({ success: false, error: 'planId is required' });
    if (String(newPlanId) === String(code.planId)) {
      return res.status(400).json({ success: false, error: 'Code is already on this plan' });
    }
    // newPlanId passed parseId() above — typed ObjectId keeps raw client text out of queries.
    const newPlanObjId = new mongoose.Types.ObjectId(newPlanId);
    const newPlan = await Plan.findOne({ _id: newPlanObjId }).lean().exec();
    if (!newPlan || newPlan.status !== 'Active') {
      return res.status(400).json({ success: false, error: 'Plan not found or inactive' });
    }

    planId = String(newPlanId);
    const balanceAfter = await consumeCredit(String(req.reseller._id), planId, 1);
    if (balanceAfter === null) {
      return res.status(400).json({ success: false, error: 'Insufficient credit for this plan', code: 'INSUFFICIENT_CREDIT' });
    }
    creditDeducted = true;

    const now = Date.now();
    const currentExpiry = subscription.expiresAt ? new Date(subscription.expiresAt).getTime() : now;
    const newExpiry = new Date(Math.max(now, currentExpiry) + newPlan.durationDays * 24 * 60 * 60 * 1000);
    await Promise.all([
      ActivationCode.updateOne({ _id: code._id }, { $set: { planId: new mongoose.Types.ObjectId(newPlanId) } }).exec(),
      Subscription.updateOne(
        { _id: subscription._id },
        { $set: { planId: new mongoose.Types.ObjectId(newPlanId), expiresAt: newExpiry, status: 'ACTIVE', cancelledAt: null } },
      ).exec(),
    ]);
    await recordCreditTx({
      resellerId: String(req.reseller._id),
      planId,
      type: 'CONSUME',
      quantity: -1,
      balanceAfter,
      note: `تغيير باقة إلى ${newPlan.name} (+${newPlan.durationDays} يوم)`,
    });
    audit({
      ...reqCtx(req),
      action: 'RESELLER_CODE_CHANGE_PLAN',
      resource: 'ActivationCode',
      resourceId: String(code._id),
      changes: { after: { planId: String(newPlanId), expiresAt: newExpiry } },
    });
    res.json({
      success: true,
      data: {
        codeId: code._id,
        plan: { name: newPlan.name, durationDays: newPlan.durationDays },
        expiresAt: newExpiry.toISOString(),
        remainingCredit: balanceAfter,
      },
    });
  } catch (err) {
    if (creditDeducted) {
      try {
        await rollback();
      } catch (rollbackErr) {
        console.error('[reseller] change-plan credit rollback failed:', rollbackErr);
      }
    }
    console.error('[reseller] change-plan error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /codes/:id/suspend — block the customer's subscription (playback
// denied; the code stays bound). Reversible via /reactivate.
router.post('/codes/:id/suspend', async (req, res) => {
  if (!hasPerm(req.reseller, 'suspend')) return deny(res, 'suspend');
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code, subscription } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (!subscription) {
      return res.status(400).json({ success: false, error: 'Code has not been activated yet', code: 'NOT_ACTIVATED' });
    }
    if (subscription.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, error: 'Only an active subscription can be suspended' });
    }
    await Subscription.updateOne({ _id: subscription._id }, { $set: { status: 'SUSPENDED' } }).exec();
    audit({ ...reqCtx(req), action: 'RESELLER_CODE_SUSPEND', resource: 'ActivationCode', resourceId: String(code._id) });
    res.json({ success: true, data: { codeId: code._id, status: 'SUSPENDED' } });
  } catch (err) {
    console.error('[reseller] suspend error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /codes/:id/reactivate — lift a suspension.
router.post('/codes/:id/reactivate', async (req, res) => {
  if (!hasPerm(req.reseller, 'suspend')) return deny(res, 'suspend');
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code, subscription } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (!subscription) {
      return res.status(400).json({ success: false, error: 'Code has not been activated yet', code: 'NOT_ACTIVATED' });
    }
    if (subscription.status !== 'SUSPENDED') {
      return res.status(400).json({ success: false, error: 'Only a suspended subscription can be reactivated' });
    }
    if (new Date(subscription.expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ success: false, error: 'Subscription has expired — renew it instead' });
    }
    await Subscription.updateOne({ _id: subscription._id }, { $set: { status: 'ACTIVE' } }).exec();
    audit({ ...reqCtx(req), action: 'RESELLER_CODE_REACTIVATE', resource: 'ActivationCode', resourceId: String(code._id) });
    res.json({ success: true, data: { codeId: code._id, status: 'ACTIVE' } });
  } catch (err) {
    console.error('[reseller] reactivate error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /codes/:id/m3u — the customer's full playlist (same M3U the TV app
// uses, with tokenized playback URLs). Lets the reseller hand the customer
// a working playlist for any player.
router.get('/codes/:id/m3u', async (req, res) => {
  if (!hasPerm(req.reseller, 'exportM3U')) return deny(res, 'exportM3U');
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const { code } = await codeWithSubscription(req.reseller._id, id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });

    const redemption = await ActivationRedemption.findOne({ activationCodeId: code._id, result: 'SUCCESS' })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (!redemption) {
      return res.status(400).json({ success: false, error: 'Code has not been activated yet', code: 'NOT_ACTIVATED' });
    }
    const user = await User.findById(redemption.userId).exec();
    if (!user) return res.status(404).json({ success: false, error: 'Customer account not found' });

    const baseUrl = getPublicBaseUrl(req);
    const m3uContent = await user.generateUserPlaylist(baseUrl);
    const safeUsername = String(user.username || 'customer').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${safeUsername}-playlist.m3u"`);
    audit({ ...reqCtx(req), action: 'RESELLER_CODE_M3U_EXPORT', resource: 'ActivationCode', resourceId: String(code._id) });
    res.send(m3uContent);
  } catch (err) {
    console.error('[reseller] m3u export error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─── Support tickets (تذاكر الدعم) ─────────────────────────────────────
// Resellers open tickets; the admin replies from the admin panel. A reseller
// reply reopens a closed ticket; closing is available to both sides.

// GET /tickets — own tickets, newest first, with status filter.
router.get('/tickets', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { resellerId: req.reseller._id };
    // Whitelisted via a constant lookup — the query never contains client text.
    const STATUS_VALUES = { OPEN: 'OPEN', PENDING: 'PENDING', CLOSED: 'CLOSED' };
    if (typeof status === 'string' && STATUS_VALUES[status]) filter.status = STATUS_VALUES[status];
    const tickets = await SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();
    const data = tickets.map((t) => ({
      _id: t._id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      messageCount: (t.messages || []).length,
      lastMessage: t.messages?.length
        ? { author: t.messages[t.messages.length - 1].author, body: t.messages[t.messages.length - 1].body, createdAt: t.messages[t.messages.length - 1].createdAt }
        : null,
      closedAt: t.closedAt || null,
      createdAt: t.createdAt,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[reseller] tickets list error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /tickets — open a new support ticket.
router.post('/tickets', async (req, res) => {
  try {
    const { subject, body, priority } = req.body || {};
    const cleanSubject = String(subject || '').trim().slice(0, 200);
    const cleanBody = String(body || '').trim().slice(0, 4000);
    if (!cleanSubject) return res.status(400).json({ success: false, error: 'subject is required' });
    if (!cleanBody) return res.status(400).json({ success: false, error: 'body is required' });
    const cleanPriority = ['LOW', 'MEDIUM', 'HIGH'].includes(priority) ? priority : 'MEDIUM';
    const ticket = await SupportTicket.create({
      resellerId: req.reseller._id,
      subject: cleanSubject,
      priority: cleanPriority,
      status: 'OPEN',
      messages: [{ author: 'reseller', body: cleanBody }],
    });
    audit({
      ...reqCtx(req),
      action: 'RESELLER_TICKET_CREATE',
      resource: 'SupportTicket',
      resourceId: String(ticket._id),
      changes: { after: { subject: cleanSubject, priority: cleanPriority } },
    });
    res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    console.error('[reseller] ticket create error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /tickets/:id — full thread (own ticket only).
router.get('/tickets/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ticket id' });
    const ticket = await SupportTicket.findOne({ _id: id, resellerId: req.reseller._id }).lean().exec();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    res.json({ success: true, data: ticket });
  } catch (err) {
    console.error('[reseller] ticket detail error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /tickets/:id/reply — append a message; reopens closed tickets.
router.post('/tickets/:id/reply', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ticket id' });
    const ticket = await SupportTicket.findOne({ _id: id, resellerId: req.reseller._id }).exec();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    const body = String(req.body?.body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ success: false, error: 'body is required' });
    ticket.messages.push({ author: 'reseller', body });
    ticket.status = 'OPEN';
    ticket.closedAt = null;
    await ticket.save();
    audit({ ...reqCtx(req), action: 'RESELLER_TICKET_REPLY', resource: 'SupportTicket', resourceId: String(ticket._id) });
    res.json({ success: true, data: ticket });
  } catch (err) {
    console.error('[reseller] ticket reply error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /tickets/:id/close
router.post('/tickets/:id/close', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ticket id' });
    const ticket = await SupportTicket.findOne({ _id: id, resellerId: req.reseller._id }).exec();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    ticket.status = 'CLOSED';
    ticket.closedAt = new Date();
    await ticket.save();
    audit({ ...reqCtx(req), action: 'RESELLER_TICKET_CLOSE', resource: 'SupportTicket', resourceId: String(ticket._id) });
    res.json({ success: true, data: { _id: ticket._id, status: 'CLOSED' } });
  } catch (err) {
    console.error('[reseller] ticket close error:', err);
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
