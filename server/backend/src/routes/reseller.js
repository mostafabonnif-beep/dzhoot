const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const CodeBatch = require('../models/CodeBatch');
const Plan = require('../models/Plan');
const ActivationCode = require('../models/ActivationCode');
const { decryptSecret } = require('../utils/crypto');
const { requireReseller } = require('../middleware/requireReseller');

// Reseller portal (بوابة الموزعين): /api/v1/reseller/*
router.use(requireReseller);

function parseId(id) {
  return mongoose.isValidObjectId(id) ? id : null;
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
      },
    });
  } catch (err) {
    console.error('[reseller] me error:', err);
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
    const codes = await ActivationCode.find({ batchId: id }).sort({ createdAt: 1 }).lean().exec();
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
