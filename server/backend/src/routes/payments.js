/**
 * Online payments — Chargily Pay (Algeria: EDAHABIA / CIB / Chargily App, DZD).
 *
 *   POST /api/v1/payments/chargily/checkout   create a checkout for a plan, no auth required
 *   GET  /api/v1/payments/chargily/status/:t  poll payment status by public token (success page)
 *   POST /api/v1/payments/chargily/webhook    Chargily → us, signature-verified, no auth
 *
 * The whole feature is optional: when CHARGILY_SECRET_KEY isn't configured,
 * /checkout returns 503 PAYMENTS_NOT_CONFIGURED instead of crashing — the
 * frontend hides the "pay by card" button in that case (see /shop/plans).
 */
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();
const Plan = require('../models/Plan');
const Payment = require('../models/Payment');
const ActivationCode = require('../models/ActivationCode');
const Reseller = require('../models/Reseller');
const {
  isChargilyConfigured,
  createCheckout,
  retrieveCheckout,
  verifyWebhookSignature,
} = require('../services/chargily-service');const {
  isCinetpayConfigured,
  createCinetpayCheckout,
  checkCinetpayTransaction,
  mapCinetpayStatus,
} = require('../services/cinetpay-service');
const { generateCodes, getCodeExpiryDays } = require('../services/subscription-service');
const { hashActivationCode, normalizeActivationCode } = require('../utils/code-generator');
const { encryptSecret, decryptSecret } = require('../utils/crypto');
const { getPublicBaseUrl } = require('../utils/public-url');

function newPublicToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function frontendOrigin() {
  return String(process.env.APP_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
}

// GET /api/v1/payments/status/:token — provider-agnostic polling for the
// success/failure page. Dispatches reconciliation to the right gateway.
router.get('/status/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'token is required' });

    const payment = await Payment.findOne({ publicToken: token }).select('+codeEnc').exec();
    if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

    const ageMs = Date.now() - payment.createdAt.getTime();
    if (payment.status === 'pending' && ageMs > 15_000 && payment.checkoutId) {
      try {
        if (payment.provider === 'chargily') {
          const remote = await retrieveCheckout(payment.checkoutId);
          if (remote.status === 'paid' && payment.status !== 'paid') {
            await fulfillPayment(payment, remote);
          } else if ((remote.status === 'failed' || remote.status === 'canceled') && payment.status === 'pending') {
            payment.status = remote.status;
            await payment.save();
          }
        } else if (payment.provider === 'cinetpay') {
          const remote = await checkCinetpayTransaction(payment.checkoutId);
          const mapped = mapCinetpayStatus(remote.status);
          if (mapped === 'paid' && payment.status !== 'paid') {
            await fulfillPayment(payment, remote);
          } else if (mapped && mapped !== 'paid' && payment.status === 'pending') {
            payment.status = mapped;
            payment.failureReason = `CinetPay reported ${remote.status}`;
            await payment.save();
          }
        }
      } catch {
        // Best-effort reconciliation only — the webhook remains the source of truth.
      }
    }

    return res.json({ success: true, data: await paymentStatusData(payment) });
  } catch (err) {
    console.error('[payments] generic status error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/payments/chargily/config — lets the frontend know whether to show
// the "pay by card" CTA at all, without exposing any secret.
router.get('/chargily/config', (_req, res) => {
  res.json({ success: true, data: { enabled: isChargilyConfigured() } });
});

// POST /api/v1/payments/chargily/checkout
// Body: { planId, shopId?, phone? }
router.post('/chargily/checkout', async (req, res) => {
  try {
    if (!isChargilyConfigured()) {
      return res.status(503).json({ success: false, error: 'Online payment is not configured', code: 'PAYMENTS_NOT_CONFIGURED' });
    }

    const { planId, shopId, phone } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ success: false, error: 'planId is required' });
    }

    const plan = await Plan.findOne({ _id: planId, status: 'Active' }).lean().exec();
    if (!plan) return res.status(400).json({ success: false, error: 'Plan not found or inactive' });
    const amount = Math.round(Number(plan.price) || 0);
    if (amount < 50) {
      return res.status(400).json({ success: false, error: 'This plan is not available for online payment' });
    }

    let resellerId = null;
    if (shopId && mongoose.Types.ObjectId.isValid(shopId)) {
      const reseller = await Reseller.findOne({ _id: shopId, status: 'Active' }).select('_id').lean().exec();
      if (reseller) resellerId = reseller._id;
    }

    const publicToken = newPublicToken();
    const payment = await Payment.create({
      provider: 'chargily',
      publicToken,
      status: 'pending',
      planId: plan._id,
      amount,
      currency: (plan.currency || 'DZD').toLowerCase(),
      resellerId,
      customerPhone: phone ? String(phone).trim().slice(0, 30) : null,
      requestIp: req.ip,
    });

    const backendBase = getPublicBaseUrl(req);
    let checkout;
    try {
      checkout = await createCheckout({
        amount,
        currency: (plan.currency || 'DZD').toLowerCase(),
        successUrl: `${frontendOrigin()}/buy/success?token=${publicToken}`,
        failureUrl: `${frontendOrigin()}/buy/failed?token=${publicToken}`,
        webhookEndpoint: `${backendBase}/api/v1/payments/chargily/webhook`,
        description: `DZ HOOF — ${plan.name}`,
        locale: 'ar',
        metadata: { paymentToken: publicToken, planId: String(plan._id) },
      });
    } catch (err) {
      payment.status = 'failed';
      payment.failureReason = 'Chargily checkout creation failed';
      await payment.save();
      console.error('[payments] Chargily createCheckout failed:', err?.response?.data || err.message);
      return res.status(502).json({ success: false, error: 'Payment gateway is temporarily unavailable' });
    }

    payment.checkoutId = checkout.id;
    payment.checkoutUrl = checkout.checkout_url;
    payment.status = checkout.status === 'paid' ? 'paid' : 'pending';
    await payment.save();

    return res.status(201).json({
      success: true,
      data: {
        token: publicToken,
        checkoutUrl: checkout.checkout_url,
        amount,
        currency: payment.currency,
        planName: plan.name,
      },
    });
  } catch (err) {
    console.error('[payments] checkout error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/payments/chargily/status/:token — polled by the success/failure page.
router.get('/chargily/status/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'token is required' });

    const payment = await Payment.findOne({ publicToken: token }).select('+codeEnc').exec();
    if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

    // Reconcile with Chargily if the webhook hasn't landed yet after a few seconds —
    // covers the case where our webhook endpoint was briefly unreachable.
    const ageMs = Date.now() - payment.createdAt.getTime();
    if (payment.status === 'pending' && ageMs > 15_000 && payment.checkoutId) {
      try {
        const remote = await retrieveCheckout(payment.checkoutId);
        if (remote.status === 'paid' && payment.status !== 'paid') {
          await fulfillPayment(payment, remote);
        } else if ((remote.status === 'failed' || remote.status === 'canceled') && payment.status === 'pending') {
          payment.status = remote.status;
          await payment.save();
        }
      } catch {
        // Best-effort reconciliation only — the webhook remains the source of truth.
      }
    }

    return res.json({ success: true, data: await paymentStatusData(payment) });
  } catch (err) {
    console.error('[payments] status error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /api/v1/payments/chargily/webhook — Chargily → us.
// NOTE: mounted with express.raw() in server.js so req.body is a Buffer here,
// which is required for HMAC signature verification over the exact raw bytes.
router.post('/chargily/webhook', async (req, res) => {
  try {
    const signature = req.get('signature');
    const rawBody = req.body; // Buffer, thanks to express.raw() in server.js
    if (!Buffer.isBuffer(rawBody)) {
      // Defensive: if express.raw() wasn't applied for some reason, refuse rather
      // than verify against a re-serialized (and therefore wrong) body.
      return res.sendStatus(400);
    }
    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.sendStatus(403);
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }

    const checkout = event?.data;
    const checkoutId = checkout?.id;
    if (!checkoutId) return res.sendStatus(200); // Nothing we can act on — ack anyway.

    const payment = await Payment.findOne({ checkoutId }).select('+codeEnc').exec();
    if (!payment) {
      // Unknown checkout (e.g. created outside our flow, or a retried webhook after
      // we lost the record) — ack so Chargily stops retrying.
      return res.sendStatus(200);
    }

    if (event.type === 'checkout.paid') {
      if (payment.status !== 'paid') {
        await fulfillPayment(payment, checkout);
      }
    } else if (event.type === 'checkout.failed' || event.type === 'checkout.canceled') {
      if (payment.status !== 'paid') {
        payment.status = event.type === 'checkout.canceled' ? 'canceled' : 'failed';
        payment.failureReason = `Chargily reported ${event.type}`;
        await payment.save();
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('[payments] webhook error:', err);
    // 500 tells Chargily to retry — safe since our handling above is idempotent.
    return res.sendStatus(500);
  }
});

/** Shared status payload for the success/failure page (provider-agnostic). */
async function paymentStatusData(payment) {
  const plan = await Plan.findById(payment.planId).select('name durationDays').lean().exec();
  const data = {
    status: payment.status,
    planName: plan?.name || null,
    durationDays: plan?.durationDays || null,
    amount: payment.amount,
    currency: payment.currency,
  };
  if (payment.status === 'paid' && payment.codeEnc) {
    try {
      data.code = decryptSecret(payment.codeEnc);
    } catch {
      data.code = null;
    }
  }
  return data;
}

// ─── CinetPay (secondary gateway, mobile money + cards) ─────────────────────

// GET /api/v1/payments/cinetpay/config
router.get('/cinetpay/config', (_req, res) => {
  res.json({ success: true, data: { enabled: isCinetpayConfigured() } });
});

// POST /api/v1/payments/cinetpay/checkout
router.post('/cinetpay/checkout', async (req, res) => {
  try {
    if (!isCinetpayConfigured()) {
      return res.status(503).json({ success: false, error: 'Online payment is not configured', code: 'PAYMENTS_NOT_CONFIGURED' });
    }

    const { planId, shopId, phone } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ success: false, error: 'planId is required' });
    }

    const plan = await Plan.findOne({ _id: planId, status: 'Active' }).lean().exec();
    if (!plan) return res.status(400).json({ success: false, error: 'Plan not found or inactive' });
    const amount = Math.round(Number(plan.price) || 0);
    if (amount < 50) {
      return res.status(400).json({ success: false, error: 'This plan is not available for online payment' });
    }

    let resellerId = null;
    if (shopId && mongoose.Types.ObjectId.isValid(shopId)) {
      const reseller = await Reseller.findOne({ _id: shopId, status: 'Active' }).select('_id').lean().exec();
      if (reseller) resellerId = reseller._id;
    }

    // The public token doubles as CinetPay's transaction_id (unique, ≤50 chars).
    const publicToken = newPublicToken();
    const payment = await Payment.create({
      provider: 'cinetpay',
      publicToken,
      status: 'pending',
      planId: plan._id,
      amount,
      currency: (plan.currency || 'XOF').toUpperCase(),
      resellerId,
      customerPhone: phone ? String(phone).trim().slice(0, 30) : null,
      requestIp: req.ip,
    });

    const backendBase = getPublicBaseUrl(req);
    let checkout;
    try {
      checkout = await createCinetpayCheckout({
        transactionId: publicToken,
        amount,
        currency: (plan.currency || 'XOF').toUpperCase(),
        description: `DZ HOOF — ${plan.name}`,
        notifyUrl: `${backendBase}/api/v1/payments/cinetpay/webhook`,
        returnUrl: `${frontendOrigin()}/buy/success?token=${publicToken}`,
        customerPhone: payment.customerPhone,
        metadata: { paymentToken: publicToken, planId: String(plan._id) },
      });
    } catch (err) {
      payment.status = 'failed';
      payment.failureReason = 'CinetPay checkout creation failed';
      await payment.save();
      console.error('[payments] CinetPay createCheckout failed:', err?.response?.data || err.message);
      return res.status(502).json({ success: false, error: 'Payment gateway is temporarily unavailable' });
    }

    // CinetPay's check/webhook APIs key off transaction_id (our public token).
    payment.checkoutId = publicToken;
    payment.checkoutUrl = checkout.payment_url;
    payment.status = checkout.status === 'ACCEPTED' ? 'paid' : 'pending';
    await payment.save();

    return res.status(201).json({
      success: true,
      data: {
        token: publicToken,
        checkoutUrl: checkout.payment_url,
        amount,
        currency: payment.currency,
        planName: plan.name,
      },
    });
  } catch (err) {
    console.error('[payments] cinetpay checkout error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/payments/cinetpay/status/:token — same polling contract as Chargily.
router.get('/cinetpay/status/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'token is required' });

    const payment = await Payment.findOne({ publicToken: token }).select('+codeEnc').exec();
    if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

    // Reconcile via CinetPay's check endpoint while pending — the notification
    // webhook is only a trigger, the check is the source of truth.
    const ageMs = Date.now() - payment.createdAt.getTime();
    if (payment.status === 'pending' && ageMs > 15_000 && payment.checkoutId) {
      try {
        const remote = await checkCinetpayTransaction(payment.checkoutId);
        const mapped = mapCinetpayStatus(remote.status);
        if (mapped === 'paid' && payment.status !== 'paid') {
          await fulfillPayment(payment, remote);
        } else if (mapped && mapped !== 'paid' && payment.status === 'pending') {
          payment.status = mapped;
          payment.failureReason = `CinetPay reported ${remote.status}`;
          await payment.save();
        }
      } catch {
        // Best-effort reconciliation only — the webhook remains the trigger.
      }
    }

    return res.json({ success: true, data: await paymentStatusData(payment) });
  } catch (err) {
    console.error('[payments] cinetpay status error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /api/v1/payments/cinetpay/webhook — CinetPay → us (form-urlencoded).
// NEVER trusted directly: we re-verify the transaction via /payment/check.
router.post('/cinetpay/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const transactionId = String(body.cpm_trans_id || body.transaction_id || '').trim();
    if (!transactionId) return res.sendStatus(400);

    const payment = await Payment.findOne({ checkoutId: transactionId }).select('+codeEnc').exec();
    if (!payment) return res.sendStatus(200); // Unknown transaction — ack so retries stop.

    if (payment.status === 'paid') return res.sendStatus(200);

    let remote;
    try {
      remote = await checkCinetpayTransaction(transactionId);
    } catch (err) {
      console.error('[payments] cinetpay check failed:', err?.message);
      return res.sendStatus(500); // Let CinetPay retry later.
    }

    const mapped = mapCinetpayStatus(remote.status);
    if (mapped === 'paid') {
      await fulfillPayment(payment, remote);
    } else if (mapped && payment.status === 'pending') {
      payment.status = mapped;
      payment.failureReason = `CinetPay reported ${remote.status}`;
      await payment.save();
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('[payments] cinetpay webhook error:', err);
    return res.sendStatus(500);
  }
});

/**
 * Turn a confirmed online payment (Chargily or CinetPay) into exactly one
 * activation code — the same hashed/encrypted-at-rest code mechanism resellers
 * and admins already use.
 * Idempotent: a `paid` payment already carrying an activationCodeId is a no-op.
 */
async function fulfillPayment(payment, checkoutData) {
  if (payment.status === 'paid' && payment.activationCodeId) return;

  const codeExpiryDays = await getCodeExpiryDays();
  const result = await generateCodes({
    planId: String(payment.planId),
    quantity: 1,
    prefix: 'DZPAY',
    codeExpiresInDays: codeExpiryDays,
    resellerId: payment.resellerId ? String(payment.resellerId) : null,
    customerPhone: payment.customerPhone || null,
  });

  if (!result.ok) {
    payment.status = 'failed';
    payment.failureReason = `Code generation failed: ${result.error}`;
    await payment.save();
    return;
  }

  const plainCode = result.codes[0];
  const hash = hashActivationCode(normalizeActivationCode(plainCode));
  const codeDoc = await ActivationCode.findOne({ codeHash: hash }).select('_id').exec();

  payment.status = 'paid';
  payment.paymentMethod = checkoutData?.payment_method || checkoutData?.payment_method_ref || payment.paymentMethod || null;
  payment.activationCodeId = codeDoc?._id || null;
  payment.codeEnc = encryptSecret(plainCode);
  payment.fulfilledAt = new Date();
  await payment.save();

  // Fire-and-forget audit entry. AuditLog.userId is a User ref; there is no
  // signed-in user for a webhook-driven fulfillment, so we log via console
  // instead of forcing an invalid/misleading ObjectId into the audit trail.
  console.log(
    `[payments] ${payment.provider} payment fulfilled: payment=${payment._id} plan=${payment.planId} amount=${payment.amount}${payment.currency}`,
  );
}


/* ────────────────────────────────────────────────────────────────────────────
 * CinetPay (mobile money + cards, CFA-franc regions) — second gateway beside
 * Chargily. Same optional pattern: when CINETPAY_API_KEY / CINETPAY_SITE_ID
 * aren't configured every route returns 503 PAYMENTS_NOT_CONFIGURED and the
 * frontend hides the CTA. Webhook authenticity is established by re-checking
 * the transaction against CinetPay's server-side /payment/check endpoint
 * (their documented verification flow) — the notification body alone is never
 * trusted.
 * ──────────────────────────────────────────────────────────────────────────── */

module.exports = router;
