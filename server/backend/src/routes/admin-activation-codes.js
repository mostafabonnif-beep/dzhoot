const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ActivationCode = require('../models/ActivationCode');
const Plan = require('../models/Plan');
const { requireAuth, requireAdmin } = require('./auth');
const { escapeRegex } = require('../utils/escapeRegex');
const { audit, reqCtx } = require('../services/audit-log');
const { decryptSecret } = require('../utils/crypto');
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
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || '50'), 10) || 50, 1), 200);
    const { planId, status, search, resellerId, batchId } = req.query;
    const query = {};

    if (planId && parseId(planId)) query.planId = parseId(planId);
    if (status && status !== 'ALL') query.status = status;
    if (resellerId && parseId(resellerId)) query.resellerId = parseId(resellerId);
    if (batchId && parseId(batchId)) query.batchId = parseId(batchId);
    if (search) query.codeLast4 = { $regex: escapeRegex(String(search).toUpperCase()), $options: 'i' };

    // Flip stale UNUSED codes to EXPIRED so the list is honest.
    await expireStaleCodes();

    const totalCount = await ActivationCode.countDocuments(query);
    const codes = await ActivationCode.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate('planId', 'name durationDays maxDevices')
      .populate('activatedBy', 'username email')
      .populate('resellerId', 'name city')
      .populate('batchId', 'batchNumber receiptDate')
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

// GET /export/csv — download codes (plaintext when recoverable) as CSV.
// Registered before /:id so it isn't swallowed by the id route.
router.get('/export/csv', async (req, res) => {
  try {
    const { planId, status, search } = req.query;
    const query = {};
    if (planId && parseId(planId)) query.planId = parseId(planId);
    if (status && status !== 'ALL') query.status = status;
    if (search) query.codeLast4 = { $regex: escapeRegex(String(search).toUpperCase()), $options: 'i' };

    await expireStaleCodes();

    const codes = await ActivationCode.find(query)
      .select('+codeEnc')
      .sort({ createdAt: -1 })
      .limit(20000)
      .populate('planId', 'name durationDays')
      .populate('activatedBy', 'username')
      .lean();

    const esc = (v) => {
      const s = String(v ?? '');
      const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${guarded.replace(/"/g, '""')}"`;
    };
    const rows = [
      ['code', 'prefix', 'last4', 'plan', 'status', 'activated_by', 'activated_at', 'code_expires_at', 'created_at', 'notes'].join(','),
    ];
    for (const c of codes) {
      let plain = '';
      if (c.codeEnc) {
        try { plain = decryptSecret(c.codeEnc); } catch { plain = ''; }
      }
      rows.push([
        esc(plain), esc(c.prefix), esc(c.codeLast4),
        esc(c.planId && c.planId.name ? c.planId.name : ''),
        esc(c.status),
        esc(c.activatedBy && c.activatedBy.username ? c.activatedBy.username : ''),
        esc(c.activatedAt ? new Date(c.activatedAt).toISOString() : ''),
        esc(c.codeExpiresAt ? new Date(c.codeExpiresAt).toISOString() : ''),
        esc(c.createdAt ? new Date(c.createdAt).toISOString() : ''),
        esc(c.notes || ''),
      ].join(','));
    }

    audit({
      ...reqCtx(req),
      action: 'CODES_EXPORT',
      resource: 'ActivationCode',
      changes: { after: { count: codes.length, filters: { planId, status, search } } },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="activation-codes.csv"');
    return res.send('﻿' + rows.join('\n'));
  } catch (err) {
    console.error('[admin-codes] export error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /bulk-revoke — revoke many unused codes at once (requires confirmation).
// NOTE: must be registered before /:id routes so 'bulk-revoke' never shadow-matches :id.
router.post('/bulk-revoke', async (req, res) => {
  try {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Bulk revoke requires { "confirmed": true } in request body',
      });
    }
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
    const ids = rawIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids[] is required (valid ObjectIds)' });
    }
    if (rawIds.length > 2000) {
      return res.status(400).json({ success: false, error: 'Too many ids (max 2000)' });
    }

    const result = await ActivationCode.updateMany(
      { _id: { $in: ids }, status: { $ne: 'ACTIVATED' } },
      { $set: { status: 'REVOKED' } },
    );

    audit({
      ...reqCtx(req),
      action: 'code_bulk_revoke',
      resource: 'ActivationCode',
      changes: { after: { count: result.modifiedCount } },
    });

    return res.json({ success: true, revokedCount: result.modifiedCount });
  } catch (err) {
    console.error('[admin-codes] bulk revoke error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /bulk-restore — restore many revoked/expired codes to UNUSED.
// NOTE: must be registered before /:id routes so 'bulk-restore' never shadow-matches :id.
router.post('/bulk-restore', async (req, res) => {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
    const ids = rawIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids[] is required (valid ObjectIds)' });
    }
    if (rawIds.length > 2000) {
      return res.status(400).json({ success: false, error: 'Too many ids (max 2000)' });
    }

    // Mirror the single-code restore: only clear an expiry that already passed,
    // so a future expiry set by the admin survives a bulk restore.
    const result = await ActivationCode.updateMany(
      { _id: { $in: ids }, status: { $in: ['REVOKED', 'EXPIRED'] } },
      [
        {
          $set: {
            status: 'UNUSED',
            codeExpiresAt: {
              $cond: {
                if: { $and: [{ $ne: ['$codeExpiresAt', null] }, { $lt: ['$codeExpiresAt', new Date()] }] },
                then: null,
                else: '$codeExpiresAt',
              },
            },
          },
        },
      ],
    );

    audit({
      ...reqCtx(req),
      action: 'code_bulk_restore',
      resource: 'ActivationCode',
      changes: { after: { count: result.modifiedCount } },
    });

    return res.json({ success: true, restoredCount: result.modifiedCount });
  } catch (err) {
    console.error('[admin-codes] bulk restore error:', err);
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

// GET /:id/reveal — decrypt and return the plaintext code (admin only).
router.get('/:id/reveal', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const code = await ActivationCode.findById(id).select('+codeEnc').lean();
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (!code.codeEnc) {
      return res.status(404).json({
        success: false,
        error: 'Full code is not recoverable for legacy codes generated before this feature',
      });
    }
    const plain = decryptSecret(code.codeEnc);
    // Revealing a plaintext code is a sensitive operation — keep an audit trail
    // of who decrypted which code and when.
    audit({
      userId: req.user?.id,
      action: 'code_reveal',
      resource: 'ActivationCode',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ success: true, data: { code: plain } });
  } catch (err) {
    console.error('[admin-codes] reveal error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PATCH /:id — edit plan, code expiry, notes
router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const code = await ActivationCode.findById(id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });

    const { planId, codeExpiresAt, notes } = req.body || {};
    const before = {
      planId: String(code.planId),
      codeExpiresAt: code.codeExpiresAt,
      notes: code.notes,
    };

    if (planId !== undefined) {
      const pid = parseId(planId);
      if (!pid) return res.status(400).json({ success: false, error: 'Invalid planId' });
      const plan = await Plan.findById(pid).lean();
      if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
      code.planId = pid;
    }

    if (codeExpiresAt !== undefined) {
      if (codeExpiresAt === null || codeExpiresAt === '') {
        code.codeExpiresAt = null;
      } else {
        const d = new Date(codeExpiresAt);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ success: false, error: 'Invalid codeExpiresAt date' });
        }
        code.codeExpiresAt = d;
      }
    }

    if (notes !== undefined) {
      code.notes = notes === null ? null : String(notes).slice(0, 500);
    }

    await code.save();

    audit({
      ...reqCtx(req),
      action: 'CODE_UPDATE',
      resource: 'ActivationCode',
      resourceId: String(id),
      changes: {
        before,
        after: { planId: String(code.planId), codeExpiresAt: code.codeExpiresAt, notes: code.notes },
      },
    });

    const updated = await ActivationCode.findById(id)
      .populate('planId', 'name durationDays maxDevices')
      .populate('activatedBy', 'username email')
      .lean();
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[admin-codes] update error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/restore — bring a REVOKED or EXPIRED (never activated) code back to UNUSED
router.post('/:id/restore', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const code = await ActivationCode.findById(id);
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (code.status === 'ACTIVATED') {
      return res.status(400).json({ success: false, error: 'Cannot restore an activated code' });
    }
    if (code.status === 'UNUSED') {
      return res.status(400).json({ success: false, error: 'Code is already active (unused)' });
    }

    const before = code.status;
    code.status = 'UNUSED';
    // If it expired because of a past codeExpiresAt, clear it so it doesn't re-expire immediately.
    if (code.codeExpiresAt && code.codeExpiresAt < new Date()) {
      code.codeExpiresAt = null;
    }
    await code.save();

    audit({
      ...reqCtx(req),
      action: 'CODE_RESTORE',
      resource: 'ActivationCode',
      resourceId: String(id),
      changes: { before: { status: before }, after: { status: 'UNUSED' } },
    });

    return res.json({ success: true, data: code });
  } catch (err) {
    console.error('[admin-codes] restore error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// DELETE /:id — permanently remove a code that was never activated
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid code id' });
    const code = await ActivationCode.findById(id).lean();
    if (!code) return res.status(404).json({ success: false, error: 'Code not found' });
    if (code.status === 'ACTIVATED') {
      return res.status(400).json({ success: false, error: 'Cannot delete an activated code' });
    }

    await ActivationCode.deleteOne({ _id: id });

    audit({
      ...reqCtx(req),
      action: 'CODE_DELETE',
      resource: 'ActivationCode',
      resourceId: String(id),
      changes: { before: { prefix: code.prefix, last4: code.codeLast4, status: code.status } },
    });

    return res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    console.error('[admin-codes] delete error:', err);
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
