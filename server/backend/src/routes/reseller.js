const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const CodeBatch = require('../models/CodeBatch');
const Plan = require('../models/Plan');
const ActivationCode = require('../models/ActivationCode');
const { decryptSecret } = require('../utils/crypto');
const { generateCodes } = require('../services/subscription-service');
const { requireReseller } = require('../middleware/requireReseller');

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

// GET /me — profile + code stats
router.get('/me', async (req, res) => {
  try {
    const r = req.reseller;
    const [total, activated, revoked] = await Promise.all([
      ActivationCode.countDocuments({ resellerId: r._id }),
      ActivationCode.countDocuments({ resellerId: r._id, status: 'ACTIVATED' }),
      ActivationCode.countDocuments({ resellerId: r._id, status: 'REVOKED' }),
    ]);
    res.json({
      success: true,
      data: {
        _id: r._id,
        name: r.name,
        city: r.city || '',
        stats: {
          total,
          activated,
          remaining: Math.max(total - activated - revoked, 0),
          revoked,
        },
        credit: await resellerCredit(r._id),
      },
    });
  } catch (err) {
    console.error('[reseller] me error:', err);
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
  try {
    const { planId, quantity } = req.body || {};
    const qty = Number(quantity ?? 1);
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

    // Sequential batch number per reseller (دفعة 1، 2، …) so self-generated
    // codes also appear in their batches list and exportable sheets.
    const lastBatch = await CodeBatch.findOne({ resellerId: req.reseller._id }).sort({ batchNumber: -1 }).select('batchNumber').lean().exec();
    const batch = await CodeBatch.create({
      resellerId: req.reseller._id,
      planId,
      batchNumber: (lastBatch?.batchNumber || 0) + 1,
      quantity: qty,
      receiptDate: new Date(),
      notes: 'توليد ذاتي من بوابة الموزعين',
      status: 'delivered',
    });

    const result = await generateCodes({
      planId: String(planId),
      quantity: qty,
      prefix: 'DZHF',
      resellerId: String(req.reseller._id),
      batchId: String(batch._id),
    });

    if (!result.ok) {
      // Roll back credit + batch on failure.
      await Promise.all([
        Reseller.updateOne({ _id: req.reseller._id, 'credit.planId': planId }, { $inc: { 'credit.$.quantity': qty } }).exec(),
        CodeBatch.findByIdAndDelete(batch._id).exec(),
      ]);
      return res.status(400).json({ success: false, error: result.error });
    }

    const remainingCredit = (updated.credit || []).find((c) => String(c.planId) === String(planId));
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
        remainingCredit: remainingCredit ? remainingCredit.quantity : 0,
      },
    });
  } catch (err) {
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

// GET /batches/:id/codes — PLAINTEXT codes of one of their batches (they sell these)
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
    const data = codes.map((c) => ({
      _id: c._id,
      code: c.codeEnc ? decryptSecret(c.codeEnc) : `${c.prefix}-••••-••••-${c.codeLast4}`,
      status: c.status,
      activatedAt: c.activatedAt || null,
    }));
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

module.exports = router;
