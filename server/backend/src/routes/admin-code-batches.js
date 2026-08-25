const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const CodeBatch = require('../models/CodeBatch');
const Reseller = require('../models/Reseller');
const Plan = require('../models/Plan');
const ActivationCode = require('../models/ActivationCode');
const { generateCodes, getCodeExpiryDays } = require('../services/subscription-service');
const { audit, reqCtx } = require('../services/audit-log');

// Admin-only code-batch (deliveries to shops) management: /api/v1/admin/code-batches
const { requireAuth, requireAdmin } = require('./auth');
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.isValidObjectId(id) ? id : null;
}

// GET / — list batches with reseller/plan + per-batch code stats
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.resellerId && parseId(req.query.resellerId)) filter.resellerId = req.query.resellerId;
    if (req.query.planId && parseId(req.query.planId)) filter.planId = req.query.planId;
    if (req.query.status === 'delivered' || req.query.status === 'pending') filter.status = req.query.status;

    const batches = await CodeBatch.find(filter).sort({ createdAt: -1 }).lean();
    const ids = batches.map((b) => b._id);
    const codeStats = ids.length
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
    const statsByBatch = new Map(codeStats.map((s) => [String(s._id), s]));

    const resellerIds = [...new Set(batches.map((b) => String(b.resellerId)))];
    const planIds = [...new Set(batches.map((b) => String(b.planId)))];
    const [resellers, plans] = await Promise.all([
      Reseller.find({ _id: { $in: resellerIds } }).select('name city status prices').lean(),
      Plan.find({ _id: { $in: planIds } }).select('name durationDays').lean(),
    ]);
    const resellerMap = new Map(resellers.map((r) => [String(r._id), r]));
    const planMap = new Map(plans.map((p) => [String(p._id), p]));

    const data = batches.map((b) => {
      const st = statsByBatch.get(String(b._id)) || { total: 0, activated: 0, revoked: 0 };
      const res = resellerMap.get(String(b.resellerId)) || null;
      const priceEntry = (res?.prices || []).find((p) => String(p.planId) === String(b.planId));
      return {
        ...b,
        reseller: res,
        plan: planMap.get(String(b.planId)) || null,
        wholesalePrice: priceEntry ? Number(priceEntry.price) : null,
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
    console.error('[admin-code-batches] list error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST / — create a delivery: batch + its codes, returns plaintext codes once
router.post('/', async (req, res) => {
  try {
    const { resellerId, planId, quantity, receiptDate, notes, prefix } = req.body || {};
    if (!parseId(resellerId)) return res.status(400).json({ success: false, error: 'resellerId is required' });
    if (!parseId(planId)) return res.status(400).json({ success: false, error: 'planId is required' });
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) {
      return res.status(400).json({ success: false, error: 'quantity must be an integer between 1 and 10000' });
    }

    const [reseller, plan] = await Promise.all([
      Reseller.findById(resellerId).lean().exec(),
      Plan.findById(planId).lean().exec(),
    ]);
    if (!reseller) return res.status(400).json({ success: false, error: 'Reseller not found' });
    if (!plan || plan.status !== 'Active') return res.status(400).json({ success: false, error: 'Plan not found or inactive' });

    // Wholesale price for this shop on this plan (سعر الجملة) if configured.
    const priceEntry = (reseller.prices || []).find((p) => String(p.planId) === String(planId));
    const wholesalePrice = priceEntry ? Number(priceEntry.price) : null;
    const wholesaleTotal = wholesalePrice !== null ? wholesalePrice * qty : null;

    // Sequential batch number per reseller: دفعة 1، دفعة 2، …
    const lastBatch = await CodeBatch.findOne({ resellerId }).sort({ batchNumber: -1 }).select('batchNumber').lean().exec();
    const batchNumber = (lastBatch?.batchNumber || 0) + 1;

    const receipt = receiptDate ? new Date(receiptDate) : new Date();
    if (Number.isNaN(receipt.getTime())) return res.status(400).json({ success: false, error: 'Invalid receiptDate' });

    const batch = await CodeBatch.create({
      resellerId,
      planId,
      batchNumber,
      quantity: qty,
      wholesalePrice: wholesalePrice !== null ? wholesalePrice : null,
      wholesaleTotal: wholesaleTotal !== null ? wholesaleTotal : null,
      receiptDate: receipt,
      notes: String(notes || '').trim(),
      status: 'delivered',
      createdBy: req.user?.id || null,
    });

    // Match the reseller-portal behaviour: codes expire after code_expiry_days
    // so the daily task can expire stale codes and return their credit.
    const codeExpiryDays = await getCodeExpiryDays();
    const result = await generateCodes({
      planId: String(planId),
      quantity: qty,
      prefix: prefix || 'DZHF',
      codeExpiresInDays: codeExpiryDays,
      createdBy: req.user?.id || null,
      resellerId: String(resellerId),
      batchId: String(batch._id),
    });

    if (!result.ok) {
      await CodeBatch.findByIdAndDelete(batch._id).exec();
      return res.status(400).json({ success: false, error: result.error });
    }

    audit({
      ...reqCtx(req),
      action: 'CODES_BATCH_CREATE',
      resource: 'CodeBatch',
      resourceId: String(batch._id),
      changes: { after: { reseller: reseller.name, plan: plan.name, count: result.count, batchNumber } },
    });

    res.status(201).json({
      success: true,
      data: {
        batch: {
          _id: batch._id,
          batchNumber,
          reseller: { name: reseller.name, city: reseller.city },
          plan: { name: plan.name, durationDays: plan.durationDays },
          receiptDate: receipt,
          quantity: result.count,
          wholesalePrice,
          wholesaleTotal,
        },
        codes: result.codes, // plaintext — shown once; also exportable from the batch sheet
      },
    });
  } catch (err) {
    console.error('[admin-code-batches] create error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /:id — batch detail
router.get('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const batch = await CodeBatch.findById(id).lean().exec();
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });
    res.json({ success: true, data: batch });
  } catch (err) {
    console.error('[admin-code-batches] detail error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /:id/codes — the codes of a batch (status only; plaintext revealed one-by-one via codes page)
router.get('/:id/codes', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const batch = await CodeBatch.findById(id).lean().exec();
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });
    const codes = await ActivationCode.find({ batchId: id })
      .sort({ createdAt: 1 })
      .select('prefix codeLast4 status activatedAt createdAt')
      .lean()
      .exec();
    res.json({ success: true, data: codes });
  } catch (err) {
    console.error('[admin-code-batches] codes error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /:id/export — a ready-to-print/send file for the shop:
// header (shop, city, receipt date, duration) + the full plaintext codes list.
router.get('/:id/export', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const batch = await CodeBatch.findById(id).lean().exec();
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });
    const [reseller, plan, codes] = await Promise.all([
      Reseller.findById(batch.resellerId).lean().exec(),
      Plan.findById(batch.planId).lean().exec(),
      ActivationCode.find({ batchId: id }).select('codeEnc codeLast4 prefix status').lean().exec(),
    ]);

    const crypto = require('../utils/crypto');
    const lines = [];
    lines.push('==============================================');
    lines.push('          DZ HOOF — دفعة أكواد التفعيل');
    lines.push('==============================================');
    lines.push(`المحل: ${reseller?.name || '—'}  |  المدينة: ${reseller?.city || '—'}`);
    lines.push(`رقم الدفعة: ${batch.batchNumber}  |  تاريخ الاستلام: ${batch.receiptDate.toISOString().slice(0, 10)}`);
    lines.push(`المدة: ${plan?.name || '—'} (${plan?.durationDays || '?'} يومًا)  |  عدد الأكواد: ${codes.length}`);
    lines.push('----------------------------------------------');
    codes.forEach((c, i) => {
      const plain = c.codeEnc ? crypto.decryptSecret(c.codeEnc) : `${c.prefix}-••••-••••-${c.codeLast4}`;
      const statusMark = c.status === 'ACTIVATED' ? ' [مفعّل]' : c.status === 'REVOKED' ? ' [ملغي]' : '';
      lines.push(`${String(i + 1).padStart(3)}. ${plain}${statusMark}`);
    });
    lines.push('----------------------------------------------');
    lines.push('كل كود يُفعّل مرة واحدة على جهاز واحد.');

    const fileName = `dzhoof-batch-${batch.batchNumber}-${(reseller?.name || 'shop').replace(/[^a-z0-9]/gi, '_')}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[admin-code-batches] export error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
