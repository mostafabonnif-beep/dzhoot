const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ActivationCode = require('../models/ActivationCode');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx } = require('../services/audit-log');
const {
  generateCodes,
  revokeCode,
  expireStaleCodes,
} = require('../services/subscription-service');

// Admin-only activation code management: /api/v1/admin/activation-codes
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

// GET / — list codes with filters (planId, status, search by last4, pagination)
router.get('/', async (req, res) => {
  try {
    const { planId, status, search, page = 1, pageSize = 50 } = req.query;
    const query = {};

    if (planId && parseId(planId)) query.planId = parseId(planId);
    if (status && status !== 'ALL') query.status = status;
    if (search) query.codeLast4 = { $regex: String(search).toUpperCase(), $options: 'i' };

    // Flip stale UNUSED codes to EXPIRED so the list is honest.
    await expireStaleCodes();

    const totalCount = await ActivationCode.countDocuments(query);
    const codes = await ActivationCode.find(query)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(pageSize))
      .limit(Number(pageSize))
      .populate('planId', 'name durationDays maxDevices')
      .populate('activatedBy', 'username email')
      .lean();

    return res.json({ success: true, data: codes, totalCount });
  } catch (err) {
    console.error('[admin-codes] list error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /stats — counts by status and per plan
router.get('/stats', async (req, res) => {
  try {
    await expireStaleCodes();
    const [byStatus, byPlan] = await Promise.all([
      ActivationCode.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      ActivationCode.aggregate([
        { $group: { _id: '$planId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
    ]);

    const statusCounts = { UNUSED: 0, ACTIVATED: 0, REVOKED: 0, EXPIRED: 0 };
    byStatus.forEach((s) => {
      statusCounts[s._id] = s.count;
    });

    return res.json({
      success: true,
      data: {
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        byStatus: statusCounts,
        byPlan,
      },
    });
  } catch (err) {
    console.error('[admin-codes] stats error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /generate — create a batch of codes; plaintext returned exactly once
router.post('/generate', async (req, res) => {
  try {
    const { planId, quantity, prefix, codeExpiresInDays } = req.body || {};

    if (!planId || !parseId(planId)) {
      return res.status(400).json({ success: false, error: 'planId is required' });
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) {
      return res.status(400).json({ success: false, error: 'quantity must be an integer between 1 and 10000' });
    }

    const result = await generateCodes({
      planId,
      quantity: qty,
      prefix: prefix || 'DZHF',
      codeExpiresInDays: codeExpiresInDays ? Number(codeExpiresInDays) : null,
      createdBy: req.user.id,
    });

    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }

    audit({
      ...reqCtx(req),
      action: 'CODES_GENERATE',
      resource: 'ActivationCode',
      changes: { after: { planId, count: result.count, prefix: prefix || 'DZHF' } },
    });

    return res.status(201).json({
      success: true,
      data: {
        count: result.count,
        plan: result.plan,
        codes: result.codes, // plaintext — shown/exported once
      },
    });
  } catch (err) {
    console.error('[admin-codes] generate error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /:id — single code detail
router.get('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const code = await ActivationCode.findById(id)
      .populate('planId', 'name durationDays maxDevices price currency')
      .populate('activatedBy', 'username email')
      .populate('createdBy', 'username email')
      .lean();
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    return res.json({ success: true, data: code });
  } catch (err) {
    console.error('[admin-codes] get error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/revoke — revoke an unused code
router.post('/:id/revoke', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });

    const result = await revokeCode(String(id));
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }

    audit({
      ...reqCtx(req),
      action: 'CODE_REVOKE',
      resource: 'ActivationCode',
      resourceId: String(id),
      changes: { before: { status: 'UNUSED' }, after: { status: 'REVOKED' } },
    });

    return res.json({ success: true, data: result.code });
  } catch (err) {
    console.error('[admin-codes] revoke error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
