import request from 'supertest';
import express from 'express';
import Plan from '../models/Plan';
import Payment from '../models/Payment';
import ActivationCode from '../models/ActivationCode';
import Reseller from '../models/Reseller';

// Mock the Chargily API wrapper — no real network calls in tests.
jest.mock('../services/chargily-service', () => ({
  isChargilyConfigured: jest.fn(() => true),
  isChargilyTestMode: jest.fn(() => true),
  createCheckout: jest.fn(),
  retrieveCheckout: jest.fn(),
  verifyWebhookSignature: jest.fn(),
}));

// generateCodes is mocked so a test can force a fulfilment failure; the default
// implementation delegates to the real one (see beforeEach).
jest.mock('../services/subscription-service', () => ({
  ...jest.requireActual('../services/subscription-service'),
  generateCodes: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const chargilyService = require('../services/chargily-service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const subscriptionService = require('../services/subscription-service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const paymentsRouter = require('../routes/payments');

function buildApp() {
  const app = express();
  // Mirror server.js: raw body for the webhook route only, JSON everywhere else.
  app.use(
    '/api/v1/payments/chargily/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
  );
  app.use(express.json());
  app.use('/api/v1/payments', paymentsRouter);
  return app;
}

describe('Chargily payment routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chargilyService.isChargilyConfigured.mockReturnValue(true);
    subscriptionService.generateCodes.mockImplementation(
      jest.requireActual('../services/subscription-service').generateCodes,
    );
  });

  describe('GET /chargily/config', () => {
    it('reports enabled=true when configured', async () => {
      const res = await request(buildApp()).get('/api/v1/payments/chargily/config');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { enabled: true } });
    });

    it('reports enabled=false when not configured', async () => {
      chargilyService.isChargilyConfigured.mockReturnValue(false);
      const res = await request(buildApp()).get('/api/v1/payments/chargily/config');
      expect(res.body.data.enabled).toBe(false);
    });
  });

  describe('POST /chargily/checkout', () => {
    it('returns 503 when Chargily is not configured', async () => {
      chargilyService.isChargilyConfigured.mockReturnValue(false);
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/checkout')
        .send({ planId: String(plan._id) });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('PAYMENTS_NOT_CONFIGURED');
    });

    it('rejects an invalid planId', async () => {
      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/checkout')
        .send({ planId: 'not-an-id' });
      expect(res.status).toBe(400);
    });

    it('rejects a plan priced below the minimum online-payable amount', async () => {
      const plan = await Plan.create({ name: 'رمزي', durationDays: 30, price: 10, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/checkout')
        .send({ planId: String(plan._id) });
      expect(res.status).toBe(400);
    });

    it('creates a Payment record and returns the Chargily checkout URL', async () => {
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      chargilyService.createCheckout.mockResolvedValue({
        id: 'chk_test_123',
        checkout_url: 'https://pay.chargily.net/test/checkouts/chk_test_123',
        status: 'pending',
      });

      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/checkout')
        .send({ planId: String(plan._id) });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.checkoutUrl).toBe('https://pay.chargily.net/test/checkouts/chk_test_123');
      expect(res.body.data.amount).toBe(500);
      expect(res.body.data.planName).toBe('شهري');
      expect(typeof res.body.data.token).toBe('string');

      const saved = await Payment.findOne({ publicToken: res.body.data.token }).exec();
      expect(saved).toBeTruthy();
      expect(saved!.checkoutId).toBe('chk_test_123');
      expect(saved!.status).toBe('pending');
      expect(saved!.amount).toBe(500);
    });

    it('attributes the payment to a reseller when a valid active shopId is given', async () => {
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const reseller = await Reseller.create({ name: 'محل الاختبار', city: 'الجزائر', status: 'Active' });
      chargilyService.createCheckout.mockResolvedValue({
        id: 'chk_test_456',
        checkout_url: 'https://pay.chargily.net/test/checkouts/chk_test_456',
        status: 'pending',
      });

      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/checkout')
        .send({ planId: String(plan._id), shopId: String(reseller._id) });

      expect(res.status).toBe(201);
      const saved = await Payment.findOne({ publicToken: res.body.data.token }).exec();
      expect(String(saved!.resellerId)).toBe(String(reseller._id));
    });

    it('marks the payment failed and returns 502 when Chargily checkout creation throws', async () => {
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      chargilyService.createCheckout.mockRejectedValue(new Error('network error'));

      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/checkout')
        .send({ planId: String(plan._id) });

      expect(res.status).toBe(502);
      const saved = await Payment.findOne({ planId: plan._id }).exec();
      expect(saved!.status).toBe('failed');
    });
  });

  describe('GET /chargily/status/:token', () => {
    it('returns 404 for an unknown token', async () => {
      const res = await request(buildApp()).get('/api/v1/payments/chargily/status/does-not-exist');
      expect(res.status).toBe(404);
    });

    it('returns pending status without a code before the webhook lands', async () => {
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const payment = await Payment.create({
        provider: 'chargily',
        publicToken: 'tok_pending_1',
        status: 'pending',
        planId: plan._id,
        amount: 500,
        currency: 'dzd',
      });
      // Force createdAt to "now" so the >15s reconciliation window doesn't fire.
      payment.createdAt = new Date();
      await payment.save();

      const res = await request(buildApp()).get(`/api/v1/payments/chargily/status/${payment.publicToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.code).toBeUndefined();
    });

    it('reveals the decrypted code once the payment is paid', async () => {
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const { encryptSecret } = require('../utils/crypto');
      const payment = await Payment.create({
        provider: 'chargily',
        publicToken: 'tok_paid_1',
        status: 'paid',
        planId: plan._id,
        amount: 500,
        currency: 'dzd',
        codeEnc: encryptSecret('DZPAY-ABCD-1234'),
      });

      const res = await request(buildApp()).get(`/api/v1/payments/chargily/status/${payment.publicToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(res.body.data.code).toBe('DZPAY-ABCD-1234');
    });
  });

  describe('POST /chargily/webhook', () => {
    // supertest/superagent re-encodes a Buffer body as JSON when Content-Type is
    // application/json (it doesn't special-case Buffers the way raw fetch/axios
    // would), which would corrupt the payload before it even reaches Express.
    // Sending the JSON string directly avoids that and still round-trips through
    // express.raw() into a Buffer on the server side, exactly like a real
    // Chargily webhook POST.
    function rawBodyOf(obj: unknown): string {
      return JSON.stringify(obj);
    }

    it('rejects a request whose body was not parsed as a raw Buffer (defensive check)', async () => {
      // Build an app WITHOUT the express.raw() middleware to simulate misconfiguration.
      const app = express();
      app.use(express.json());
      app.use('/api/v1/payments', paymentsRouter);

      const res = await request(app)
        .post('/api/v1/payments/chargily/webhook')
        .set('signature', 'whatever')
        .send({ type: 'checkout.paid' });
      expect(res.status).toBe(400);
    });

    it('rejects a webhook with an invalid signature', async () => {
      chargilyService.verifyWebhookSignature.mockReturnValue(false);
      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/webhook')
        .set('signature', 'bad-signature')
        .set('Content-Type', 'application/json')
        .send(rawBodyOf({ type: 'checkout.paid', data: { id: 'chk_1' } }));
      expect(res.status).toBe(403);
    });

    it('acks with 200 for an unknown checkoutId (no matching Payment)', async () => {
      chargilyService.verifyWebhookSignature.mockReturnValue(true);
      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/webhook')
        .set('signature', 'valid')
        .set('Content-Type', 'application/json')
        .send(rawBodyOf({ type: 'checkout.paid', data: { id: 'chk_unknown' } }));
      expect(res.status).toBe(200);
    });

    it('fulfills a paid checkout: generates a code, marks Payment paid, links ActivationCode', async () => {
      chargilyService.verifyWebhookSignature.mockReturnValue(true);
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const payment = await Payment.create({
        provider: 'chargily',
        publicToken: 'tok_webhook_1',
        checkoutId: 'chk_webhook_1',
        status: 'pending',
        planId: plan._id,
        amount: 500,
        currency: 'dzd',
      });

      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/webhook')
        .set('signature', 'valid')
        .set('Content-Type', 'application/json')
        .send(
          rawBodyOf({
            type: 'checkout.paid',
            data: { id: 'chk_webhook_1', payment_method: 'edahabia' },
          }),
        );

      expect(res.status).toBe(200);

      const updated = await Payment.findById(payment._id).select('+codeEnc').exec();
      expect(updated!.status).toBe('paid');
      expect(updated!.paymentMethod).toBe('edahabia');
      expect(updated!.activationCodeId).toBeTruthy();
      expect(updated!.codeEnc).toBeTruthy();
      expect(updated!.fulfilledAt).toBeTruthy();

      const code = await ActivationCode.findById(updated!.activationCodeId).exec();
      expect(code).toBeTruthy();
      expect(String(code!.planId)).toBe(String(plan._id));
      expect(code!.status).toBe('UNUSED');
      expect(code!.prefix).toBe('DZPAY');
    });

    it('is idempotent: a second checkout.paid webhook for an already-paid payment does not mint a second code', async () => {
      chargilyService.verifyWebhookSignature.mockReturnValue(true);
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const { encryptSecret } = require('../utils/crypto');
      const payment = await Payment.create({
        provider: 'chargily',
        publicToken: 'tok_webhook_2',
        checkoutId: 'chk_webhook_2',
        status: 'paid',
        planId: plan._id,
        amount: 500,
        currency: 'dzd',
        codeEnc: encryptSecret('DZPAY-EXISTING-CODE'),
        activationCodeId: undefined,
      });

      const countBefore = await ActivationCode.countDocuments({});

      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/webhook')
        .set('signature', 'valid')
        .set('Content-Type', 'application/json')
        .send(rawBodyOf({ type: 'checkout.paid', data: { id: 'chk_webhook_2' } }));

      expect(res.status).toBe(200);
      const countAfter = await ActivationCode.countDocuments({});
      expect(countAfter).toBe(countBefore);
      const unchanged = await Payment.findById(payment._id).select('+codeEnc').exec();
      expect(unchanged!.status).toBe('paid');
    });

    it('marks the payment failed on a checkout.failed event', async () => {
      chargilyService.verifyWebhookSignature.mockReturnValue(true);
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const payment = await Payment.create({
        provider: 'chargily',
        publicToken: 'tok_webhook_3',
        checkoutId: 'chk_webhook_3',
        status: 'pending',
        planId: plan._id,
        amount: 500,
        currency: 'dzd',
      });

      const res = await request(buildApp())
        .post('/api/v1/payments/chargily/webhook')
        .set('signature', 'valid')
        .set('Content-Type', 'application/json')
        .send(rawBodyOf({ type: 'checkout.failed', data: { id: 'chk_webhook_3' } }));

      expect(res.status).toBe(200);
      const updated = await Payment.findById(payment._id).exec();
      expect(updated!.status).toBe('failed');
    });

    describe('money validation (P-4)', () => {
      it('refuses to fulfil when the paid checkout reports a lower amount (P-4)', async () => {
        chargilyService.verifyWebhookSignature.mockReturnValue(true);
        const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
        const payment = await Payment.create({
          provider: 'chargily',
          publicToken: 'tok_mismatch_amount',
          checkoutId: 'chk_mismatch_amount',
          status: 'pending',
          planId: plan._id,
          amount: 500,
          currency: 'dzd',
        });

        const res = await request(buildApp())
          .post('/api/v1/payments/chargily/webhook')
          .set('signature', 'valid')
          .set('Content-Type', 'application/json')
          .send(
            rawBodyOf({
              type: 'checkout.paid',
              data: { id: 'chk_mismatch_amount', amount: 100, currency: 'dzd', payment_method: 'edahabia' },
            }),
          );

        // Non-2xx: the gateway must not be silently ACKed for money we did not validate.
        expect(res.status).toBe(500);

        const updated = await Payment.findById(payment._id).select('+codeEnc').exec();
        expect(updated!.status).toBe('pending');
        expect(updated!.activationCodeId).toBeFalsy();
        expect(updated!.codeEnc).toBeFalsy();
        expect(updated!.failureReason).toMatch(/mismatch/i);
        expect(updated!.failureReason).toMatch(/amount gateway=100 payment=500/);
        expect(await ActivationCode.countDocuments({ planId: plan._id })).toBe(0);
        expect(subscriptionService.generateCodes).not.toHaveBeenCalled();
      });

      it('refuses to fulfil when the checkout reports a different currency (P-4)', async () => {
        chargilyService.verifyWebhookSignature.mockReturnValue(true);
        const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
        const payment = await Payment.create({
          provider: 'chargily',
          publicToken: 'tok_mismatch_currency',
          checkoutId: 'chk_mismatch_currency',
          status: 'pending',
          planId: plan._id,
          amount: 500,
          currency: 'dzd',
        });

        const res = await request(buildApp())
          .post('/api/v1/payments/chargily/webhook')
          .set('signature', 'valid')
          .set('Content-Type', 'application/json')
          .send(
            rawBodyOf({
              type: 'checkout.paid',
              data: { id: 'chk_mismatch_currency', amount: 500, currency: 'eur' },
            }),
          );

        expect(res.status).toBe(500);
        const updated = await Payment.findById(payment._id).select('+codeEnc').exec();
        expect(updated!.status).toBe('pending');
        expect(updated!.codeEnc).toBeFalsy();
        expect(updated!.failureReason).toMatch(/currency gateway=eur payment=dzd/);
        expect(await ActivationCode.countDocuments({ planId: plan._id })).toBe(0);
      });

      it('refuses to fulfil when the checkout echoes a different payment token (P-4)', async () => {
        chargilyService.verifyWebhookSignature.mockReturnValue(true);
        const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
        const payment = await Payment.create({
          provider: 'chargily',
          publicToken: 'tok_mismatch_token',
          checkoutId: 'chk_mismatch_token',
          status: 'pending',
          planId: plan._id,
          amount: 500,
          currency: 'dzd',
        });

        const res = await request(buildApp())
          .post('/api/v1/payments/chargily/webhook')
          .set('signature', 'valid')
          .set('Content-Type', 'application/json')
          .send(
            rawBodyOf({
              type: 'checkout.paid',
              // Chargily echoes our creation metadata as an array of single-key objects.
              data: {
                id: 'chk_mismatch_token',
                amount: 500,
                currency: 'dzd',
                metadata: [{ paymentToken: 'someone-elses-token' }, { planId: String(plan._id) }],
              },
            }),
          );

        expect(res.status).toBe(500);
        const updated = await Payment.findById(payment._id).select('+codeEnc').exec();
        expect(updated!.status).toBe('pending');
        expect(updated!.codeEnc).toBeFalsy();
        expect(updated!.failureReason).toMatch(/token gateway=someone-elses-token/);
        expect(await ActivationCode.countDocuments({ planId: plan._id })).toBe(0);
      });

      it('still fulfils when amount, currency and echoed metadata all agree (no false positive)', async () => {
        chargilyService.verifyWebhookSignature.mockReturnValue(true);
        const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
        const payment = await Payment.create({
          provider: 'chargily',
          publicToken: 'tok_match_all',
          checkoutId: 'chk_match_all',
          status: 'pending',
          planId: plan._id,
          amount: 500,
          currency: 'dzd',
        });

        const res = await request(buildApp())
          .post('/api/v1/payments/chargily/webhook')
          .set('signature', 'valid')
          .set('Content-Type', 'application/json')
          .send(
            rawBodyOf({
              type: 'checkout.paid',
              data: {
                id: 'chk_match_all',
                amount: 500,
                currency: 'DZD',
                payment_method: 'edahabia',
                metadata: [{ paymentToken: 'tok_match_all' }, { planId: String(plan._id) }],
              },
            }),
          );

        expect(res.status).toBe(200);
        const updated = await Payment.findById(payment._id).select('+codeEnc').exec();
        expect(updated!.status).toBe('paid');
        expect(updated!.activationCodeId).toBeTruthy();
        expect(updated!.failureReason).toBeFalsy();
        expect(await ActivationCode.countDocuments({ planId: plan._id })).toBe(1);
      });
    });

    /** Backdate a field through the driver so the schema's timestamps plugin
     * cannot rewrite it (needed to reach the poll's >15s reconciliation window
     * and the stale-claim takeover). */
    async function backdate(id: unknown, field: string, ms: number) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mongoose = require('mongoose');
      await Payment.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(String(id)) },
        { $set: { [field]: new Date(Date.now() - ms) } },
      );
    }

    describe('fulfilment claim (P-1) and failure semantics (P-2)', () => {
      it('mints exactly one code when two triggers fulfil the same payment concurrently', async () => {
        chargilyService.verifyWebhookSignature.mockReturnValue(true);
        const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
        const payment = await Payment.create({
          provider: 'chargily',
          publicToken: 'tok_race_1',
          checkoutId: 'chk_race_1',
          status: 'pending',
          planId: plan._id,
          amount: 500,
          currency: 'dzd',
        });

        const app = buildApp();
        const body = rawBodyOf({
          type: 'checkout.paid',
          data: { id: 'chk_race_1', payment_method: 'edahabia' },
        });
        const fire = () =>
          request(app)
            .post('/api/v1/payments/chargily/webhook')
            .set('signature', 'valid')
            .set('Content-Type', 'application/json')
            .send(body);

        // Hold the first fulfilment open long enough for the second trigger to
        // arrive while it is mid-flight — the claim, not timing luck, must decide.
        const realGenerateCodes = jest.requireActual('../services/subscription-service').generateCodes;
        subscriptionService.generateCodes.mockImplementation(async (opts: unknown) => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return realGenerateCodes(opts);
        });

        // Two independent triggers (as in production: webhook + success-page
        // poll) racing on the same pending payment.
        const [first, second] = await Promise.all([fire(), fire()]);

        // Exactly one winner is ACKed; the loser is answered 500 so the gateway
        // retries instead of silently dropping the fulfilment.
        expect([first.status, second.status].sort()).toEqual([200, 500]);

        const codes = await ActivationCode.find({ planId: plan._id }).exec();
        expect(codes).toHaveLength(1);

        const updated = await Payment.findById(payment._id).select('+codeEnc').exec();
        expect(updated!.status).toBe('paid');
        expect(updated!.fulfilledAt).toBeTruthy();
        expect(updated!.codeEnc).toBeTruthy();
        expect(String(updated!.activationCodeId)).toBe(String(codes[0]._id));
        expect(subscriptionService.generateCodes).toHaveBeenCalledTimes(1);
      });

      it('takes over a stale processing claim so a crashed fulfilment cannot strand the payment', async () => {
        chargilyService.verifyWebhookSignature.mockReturnValue(true);
        chargilyService.retrieveCheckout.mockResolvedValue({ status: 'paid' });
        const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
        const payment = await Payment.create({
          provider: 'chargily',
          publicToken: 'tok_stale_1',
          checkoutId: 'chk_stale_1',
          status: 'processing', // winner died here, before writing the code
          planId: plan._id,
          amount: 500,
          currency: 'dzd',
        });
        await backdate(payment._id, 'createdAt', 60_000);
        await backdate(payment._id, 'updatedAt', 10 * 60_000);

        const res = await request(buildApp()).get(
          `/api/v1/payments/chargily/status/${payment.publicToken}`,
        );

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('paid');
        expect(typeof res.body.data.code).toBe('string');
        const updated = await Payment.findById(payment._id).exec();
        expect(updated!.status).toBe('paid');
        expect(await ActivationCode.countDocuments({ planId: plan._id })).toBe(1);
      });

      it('does not ACK and never records a terminal failure when code generation fails, and a later poll can still recover it', async () => {
        chargilyService.verifyWebhookSignature.mockReturnValue(true);
        const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
        const payment = await Payment.create({
          provider: 'chargily',
          publicToken: 'tok_codefail_1',
          checkoutId: 'chk_codefail_1',
          status: 'pending',
          planId: plan._id,
          amount: 500,
          currency: 'dzd',
        });
        subscriptionService.generateCodes.mockResolvedValueOnce({ ok: false, error: 'Plan not found' });

        const res = await request(buildApp())
          .post('/api/v1/payments/chargily/webhook')
          .set('signature', 'valid')
          .set('Content-Type', 'application/json')
          .send(rawBodyOf({ type: 'checkout.paid', data: { id: 'chk_codefail_1' } }));

        // (b) non-2xx so Chargily keeps retrying.
        expect(res.status).toBe(500);

        // (a) money is captured: the payment must stay recoverable, not 'failed'.
        const afterFailure = await Payment.findById(payment._id).select('+codeEnc').exec();
        expect(afterFailure!.status).toBe('pending');
        expect(afterFailure!.activationCodeId).toBeFalsy();
        expect(afterFailure!.codeEnc).toBeFalsy();
        expect(afterFailure!.failureReason).toMatch(/Code generation failed/);
        expect(await ActivationCode.countDocuments({ planId: plan._id })).toBe(0);

        // (c) a later status poll recovers it — Chargily now reports it paid.
        chargilyService.retrieveCheckout.mockResolvedValue({ status: 'paid' });
        await backdate(payment._id, 'createdAt', 60_000);

        const statusRes = await request(buildApp()).get(
          `/api/v1/payments/chargily/status/${payment.publicToken}`,
        );
        expect(statusRes.status).toBe(200);
        expect(statusRes.body.data.status).toBe('paid');
        expect(typeof statusRes.body.data.code).toBe('string');

        const recovered = await Payment.findById(payment._id).select('+codeEnc').exec();
        expect(recovered!.status).toBe('paid');
        expect(recovered!.activationCodeId).toBeTruthy();
        expect(recovered!.failureReason).toBeFalsy();
        expect(await ActivationCode.countDocuments({ planId: plan._id })).toBe(1);
      });
    });
  });
});
