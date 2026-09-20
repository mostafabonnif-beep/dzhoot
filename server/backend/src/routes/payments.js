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

/* ── Fulfilment state machine ────────────────────────────────────────────────
 *
 *   pending ──claim──▶ processing ──code persisted──▶ paid
 *      ▲                  │
 *      └── code gen failed┘          (money is captured: NEVER a terminal
 *                                     'failed' — see P-2 below)
 *
 *   pending ──gateway reported failed/canceled──▶ failed | canceled | expired
 *
 * 'processing' is the in-flight claim. Only the trigger that atomically moved
 * the document into 'processing' (from 'pending', or from a stale 'processing')
 * may mint a code, so the three independent triggers — Chargily webhook,
 * GET /status/:token and GET /chargily/status/:token — can no longer each issue
 * one for the same payment. 'paid' is only ever written together with
 * activationCodeId/codeEnc in the same update.
 *
 * Crash handling: a claim whose document has not been written for longer than
 * FULFILLMENT_STALE_MS is taken over by the next trigger. Trade-off: a worker
 * that is alive but stalled for more than 5 minutes inside a sub-second
 * operation would have its claim stolen and a second code minted — but the
 * fenced finalize means the stalled worker cannot clobber the new owner's fields
 * and it deletes the orphan code it generated. The alternative (a permanent
 * 'processing' dead end where a captured payment never gets a code) is strictly
 * worse than a rare duplicate code.
 */
const FULFILLMENT_STALE_MS = 5 * 60_000;

/** A payment still waiting for its activation code: 'pending', or 'processing'
 * while a claim is in flight (possibly stale after a crash). */
function isAwaitingFulfillment(status) {
  return status === 'pending' || status === 'processing';
}

/** Fulfilment outcomes the gateway must NOT be ACKed for: 'in-flight'/'retry'
 * are transient and a retry can finish the fulfilment; 'mismatch' is permanent
 * but a non-2xx is exactly what keeps it visible to operators (and to the
 * gateway's delivery log) instead of silently ACKing money we never validated. */
function mustRetryFulfillment(outcome) {
  return outcome === 'in-flight' || outcome === 'retry' || outcome === 'mismatch';
}

/* ── Money validation (defense in depth, P-4) ────────────────────────────────
 * A gateway payload is only allowed to fulfil a payment when the money it
 * reports agrees with the amount/currency we recorded at checkout creation.
 * Both webhooks (and the status-poll reconciliation) funnel through
 * fulfillPayment, so the check lives there rather than in each handler.
 *
 * Only fields the payload actually carries are compared — Chargily webhooks in
 * particular can arrive without amount/currency and must keep working. The
 * payment token is cross-checked when present: Chargily echoes the metadata we
 * sent at creation ([{ paymentToken }, { planId }]), CinetPay's /payment/check
 * answers with transaction_id (our publicToken).
 */

/** Chargily returns metadata as an array of single-key objects; CinetPay may
 * echo it as a JSON string. Normalize all of those to a plain object — an
 * unknown/unparseable shape yields {} (no token to check, never a false alarm). */
function normalizeGatewayMetadata(metadata) {
  let value = metadata;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (Array.isArray(value)) {
    const merged = {};
    for (const entry of value) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) Object.assign(merged, entry);
    }
    return merged;
  }
  return value && typeof value === 'object' ? value : {};
}

/**
 * Compare a gateway payload against the payment we recorded. Returns a
 * human-readable description of every disagreement, or null when consistent
 * (or when the payload carries nothing to compare — see above).
 */
function gatewayPaymentMismatch(payment, gatewayData) {
  if (!gatewayData || typeof gatewayData !== 'object') return null;
  const problems = [];

  const rawAmount = gatewayData.amount;
  if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
    const gatewayAmount = Number(rawAmount);
    const expectedAmount = Number(payment.amount);
    if (!Number.isFinite(gatewayAmount)) {
      problems.push(`amount unparseable (gateway=${String(rawAmount)})`);
    } else if (gatewayAmount !== expectedAmount) {
      problems.push(`amount gateway=${gatewayAmount} payment=${expectedAmount}`);
    }
  }

  const rawCurrency = gatewayData.currency;
  if (rawCurrency !== undefined && rawCurrency !== null && String(rawCurrency).trim() !== '') {
    const gatewayCurrency = String(rawCurrency).trim().toLowerCase();
    const expectedCurrency = String(payment.currency || '').trim().toLowerCase();
    if (gatewayCurrency !== expectedCurrency) {
      problems.push(`currency gateway=${gatewayCurrency} payment=${expectedCurrency}`);
    }
  }

  const metadata = normalizeGatewayMetadata(gatewayData.metadata);
  const rawToken = metadata.paymentToken ?? metadata.payment_token ?? gatewayData.transaction_id;
  if (rawToken !== undefined && rawToken !== null && String(rawToken).trim() !== '') {
    const gatewayToken = String(rawToken).trim();
    const expectedToken = String(payment.publicToken || '').trim();
    if (gatewayToken !== expectedToken) {
      problems.push(`token gateway=${gatewayToken} payment=${expectedToken}`);
    }
  }

  return problems.length ? problems.join('; ') : null;
}

// GET /api/v1/payments/status/:token — provider-agnostic polling for the
// success/failure page. Dispatches reconciliation to the right gateway.
router.get('/status/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'token is required' });

    const payment = await Payment.findOne({ publicToken: token }).select('+codeEnc').exec();
    if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

    const refreshed = await reconcilePayment(payment);

    return res.json({ success: true, data: await paymentStatusData(refreshed) });
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
    // Never trust the creation response as settlement, whatever it says: a
    // payment may only become terminally 'paid' together with its code, which
    // happens in fulfillPayment (webhook or status reconciliation) — not here.
    payment.status = 'pending';
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
    const refreshed = await reconcilePayment(payment);

    return res.json({ success: true, data: await paymentStatusData(refreshed) });
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
      const result = await fulfillPayment(payment, checkout);
      if (mustRetryFulfillment(result.outcome)) {
        // No ACK on purpose: Chargily retries, and that retry either observes the
        // winner's 'paid' or re-claims the payment we released. ACKing here would
        // silently strand a captured payment with no code (P-2).
        return res.sendStatus(500);
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

/**
 * Best-effort reconciliation for the polling endpoints: when the webhook hasn't
 * landed after a few seconds (or died mid-fulfilment), ask the gateway directly.
 * Covered states are exactly the ones that can still change — 'pending' and a
 * (possibly stale) 'processing' claim.
 *
 * Never throws: reconciliation is a safety net, the webhook remains the trigger.
 * @returns the document the response should be built from — a fresh one when this
 *          call itself fulfilled the payment, otherwise the one passed in.
 */
async function reconcilePayment(payment) {
  const ageMs = Date.now() - payment.createdAt.getTime();
  if (!isAwaitingFulfillment(payment.status) || ageMs <= 15_000 || !payment.checkoutId) {
    return payment;
  }

  try {
    if (payment.provider === 'chargily') {
      const remote = await retrieveCheckout(payment.checkoutId);
      if (remote.status === 'paid') {
        const result = await fulfillPayment(payment, remote);
        return result.payment || payment;
      }
      if ((remote.status === 'failed' || remote.status === 'canceled') && payment.status === 'pending') {
        payment.status = remote.status;
        await payment.save();
      }
    } else if (payment.provider === 'cinetpay') {
      const remote = await checkCinetpayTransaction(payment.checkoutId);
      const mapped = mapCinetpayStatus(remote.status);
      if (mapped === 'paid') {
        const result = await fulfillPayment(payment, remote);
        return result.payment || payment;
      }
      if (mapped && mapped !== 'paid' && payment.status === 'pending') {
        payment.status = mapped;
        payment.failureReason = `CinetPay reported ${remote.status}`;
        await payment.save();
      }
    }
  } catch {
    // Best-effort only — the webhook remains the source of truth.
  }
  return payment;
}

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
    // ASSUMPTION: CinetPay's POST /v2/payment (creation) response is not a
    // settlement signal. The transaction status only becomes authoritative via
    // POST /v2/payment/check — which both the webhook and the status poll go
    // through — where ACCEPTED means funds captured; a create-time 'ACCEPTED'
    // also shows up on throwaway/duplicate checkouts. So we always start
    // 'pending': a payment may only become terminally 'paid' together with its
    // code, in fulfillPayment. (Before this fix such a row was stored 'paid'
    // with no code and every path early-returned forever.)
    payment.status = 'pending';
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
    const refreshed = await reconcilePayment(payment);

    return res.json({ success: true, data: await paymentStatusData(refreshed) });
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

    // Settled means paid AND carrying its code. A 'paid' row without one is a
    // legacy pre-fix record (create-time ACCEPTED) — fall through so the check
    // below can fulfil it instead of early-returning forever.
    if (payment.status === 'paid' && payment.activationCodeId) return res.sendStatus(200);

    let remote;
    try {
      remote = await checkCinetpayTransaction(transactionId);
    } catch (err) {
      console.error('[payments] cinetpay check failed:', err?.message);
      return res.sendStatus(500); // Let CinetPay retry later.
    }

    const mapped = mapCinetpayStatus(remote.status);
    if (mapped === 'paid') {
      const result = await fulfillPayment(payment, remote);
      if (mustRetryFulfillment(result.outcome)) {
        // No ACK: CinetPay retries and a later attempt (or the status poll) can
        // still finish the fulfilment of this captured payment (P-2).
        return res.sendStatus(500);
      }
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
 * Atomically claim the right to fulfil a payment — the single arbiter of code
 * issuance, decided by MongoDB rather than by process memory. Returns the
 * claimed document, or null when the payment is already settled/terminal or
 * another trigger holds a live claim (losers write nothing at all).
 *
 * The claim token is the document's own `updatedAt`, which every write bumps:
 * the Payment schema has no dedicated claim-id column (and is out of scope
 * here), so the update timestamp doubles as the monotonic claim token that
 * `finalizeFulfillment` fences on.
 */
async function claimFulfillment(paymentId) {
  const staleBefore = new Date(Date.now() - FULFILLMENT_STALE_MS);
  return Payment.findOneAndUpdate(
    {
      _id: paymentId,
      $or: [
        { status: 'pending' },
        // Pre-fix rows stored 'paid' without ever receiving a code (create-time
        // CinetPay ACCEPTED): fulfilable again on the next trigger.
        { status: 'paid', activationCodeId: null, codeEnc: null },
        // Winner crashed mid-fulfilment: `processing` untouched for longer than
        // FULFILLMENT_STALE_MS is taken over instead of leaving the payment
        // stuck forever.
        { status: 'processing', updatedAt: { $lt: staleBefore } },
      ],
    },
    { $set: { status: 'processing' } },
    { new: true },
  ).exec();
}

/**
 * Persist the outcome of a held claim, fenced on the claim token: if the claim
 * was taken over (or the payment moved to a terminal status) while we were
 * generating, the write is a no-op so we never clobber the new owner's fields.
 * @returns the updated document (with codeEnc, so the poll can reveal the code),
 *          or null when this trigger no longer owned the claim.
 */
async function finalizeFulfillment(paymentId, claimToken, fields) {
  return Payment.findOneAndUpdate(
    { _id: paymentId, status: 'processing', updatedAt: claimToken },
    { $set: fields },
    { new: true },
  )
    .select('+codeEnc')
    .exec();
}

/**
 * Hand a claim back after a failed attempt so a later trigger can retry. Goes
 * back to 'pending' — NEVER 'failed': the gateway already reported the money as
 * captured, so a terminal failure here is exactly what strands the customer.
 */
async function releaseFulfillmentClaim(paymentId, claimToken, reason) {
  await Payment.findOneAndUpdate(
    { _id: paymentId, status: 'processing', updatedAt: claimToken },
    { $set: { status: 'pending', failureReason: String(reason).slice(0, 500) } },
  ).exec();
}

/**
 * Mark a payment whose gateway payload failed the money check, without ever
 * minting a code and without inventing a second state machine: claim it through
 * claimFulfillment and immediately hand the claim back via
 * releaseFulfillmentClaim, so the row ends up 'pending' with the mismatch in
 * failureReason — visible for reconciliation, never 'failed' (the money may
 * well be captured) and never stuck in 'processing'.
 */
async function recordFulfillmentMismatch(payment, reason) {
  const claim = await claimFulfillment(payment._id);
  if (!claim) return; // Already settled, or another trigger holds the claim.
  await releaseFulfillmentClaim(claim._id, claim.updatedAt, reason);
}

/**
 * Turn a confirmed online payment (Chargily or CinetPay) into exactly one
 * activation code — the same hashed/encrypted-at-rest code mechanism resellers
 * and admins already use.
 *
 * Idempotent by construction: the atomic claim means a second (or third)
 * concurrent trigger is a no-op, and 'paid' is written in the same update as
 * the code.
 *
 * Returns the outcome the caller turns into a gateway response:
 *   'fulfilled' — this trigger won the claim and stored a fresh code (the
 *                 written document is returned as `payment` so a status poll can
 *                 answer with the code immediately);
 *   'settled'   — already fulfilled or terminally failed: nothing to do, ACK;
 *   'in-flight' — another trigger holds a live claim: don't ACK, retry later;
 *   'retry'     — we claimed it but code generation failed and the claim was
 *                 released back to 'pending': don't ACK, retry later (P-2);
 *   'mismatch'  — the gateway payload disagrees with the payment's amount,
 *                 currency or token (P-4): do NOT fulfil, do NOT ACK, leave the
 *                 row 'pending' with the reason recorded for reconciliation.
 * Code-generation failures never throw; only an unexpected write failure while
 * releasing the claim can, and the callers keep their own try/catch for that.
 */
async function fulfillPayment(payment, checkoutData) {
  const mismatch = gatewayPaymentMismatch(payment, checkoutData);
  if (mismatch) {
    const reason = `Gateway/payment mismatch: ${mismatch}`;
    console.error(
      `[payments][MONEY-MISMATCH] provider=${payment.provider} payment=${payment._id} checkout=${payment.checkoutId} — ${mismatch}; refusing to fulfil`,
    );
    await recordFulfillmentMismatch(payment, reason);
    return { outcome: 'mismatch' };
  }

  const claim = await claimFulfillment(payment._id);
  if (!claim) {
    // Loser: write nothing — the winner's fields (code, status) stay untouched.
    // The document we came in with is stale by now, so the CURRENT status decides
    // whether the gateway should retry ('processing': someone is fulfilling right
    // now) or may be ACKed (already 'paid'/terminal).
    const current = await Payment.findById(payment._id).select('status').lean().exec();
    return { outcome: current?.status === 'processing' ? 'in-flight' : 'settled' };
  }

  const claimToken = claim.updatedAt;
  try {
    const codeExpiryDays = await getCodeExpiryDays();
    const result = await generateCodes({
      planId: String(claim.planId),
      quantity: 1,
      prefix: 'DZPAY',
      codeExpiresInDays: codeExpiryDays,
      resellerId: claim.resellerId ? String(claim.resellerId) : null,
      customerPhone: claim.customerPhone || null,
    });

    if (!result.ok) {
      await releaseFulfillmentClaim(claim._id, claimToken, `Code generation failed: ${result.error}`);
      console.error(`[payments] code generation failed for payment=${claim._id} (${claim.provider}): ${result.error}`);
      return { outcome: 'retry' };
    }

    const plainCode = result.codes[0];
    const hash = hashActivationCode(normalizeActivationCode(plainCode));
    const codeDoc = await ActivationCode.findOne({ codeHash: hash }).select('_id').exec();

    const finalized = await finalizeFulfillment(claim._id, claimToken, {
      status: 'paid',
      paymentMethod: checkoutData?.payment_method || checkoutData?.payment_method_ref || claim.paymentMethod || null,
      activationCodeId: codeDoc?._id || null,
      codeEnc: encryptSecret(plainCode),
      fulfilledAt: new Date(),
      failureReason: null,
    });

    if (!finalized) {
      // Our claim was taken over while we were generating. codeHash is unique,
      // so codeDoc is the code WE minted — drop it rather than leave an orphan
      // activation code that belongs to no payment.
      if (codeDoc?._id) await ActivationCode.findByIdAndDelete(codeDoc._id).exec();
      console.warn(`[payments] lost the fulfilment race for payment=${claim._id} — discarded its generated code`);
      return { outcome: 'in-flight' };
    }

    // Fire-and-forget audit entry. AuditLog.userId is a User ref; there is no
    // signed-in user for a webhook-driven fulfillment, so we log via console
    // instead of forcing an invalid/misleading ObjectId into the audit trail.
    console.log(
      `[payments] ${claim.provider} payment fulfilled: payment=${claim._id} plan=${claim.planId} amount=${claim.amount}${claim.currency}`,
    );
    return { outcome: 'fulfilled', payment: finalized };
  } catch (err) {
    // Unexpected throw (Mongo, crypto, …): release the claim so a later trigger
    // can retry instead of the payment sitting in 'processing' forever.
    await releaseFulfillmentClaim(claim._id, claimToken, 'Code generation failed');
    console.error(`[payments] fulfillment error for payment=${claim._id}:`, err);
    return { outcome: 'retry' };
  }
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
