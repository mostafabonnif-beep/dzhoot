import request from 'supertest';
import express from 'express';
import Plan from '../models/Plan';
import Payment from '../models/Payment';
import ActivationCode from '../models/ActivationCode';

// Mock the CinetPay API wrapper — no real network calls in tests.
jest.mock('../services/cinetpay-service', () => ({
  isCinetpayConfigured: jest.fn(() => true),
  createCinetpayCheckout: jest.fn(),
  checkCinetpayTransaction: jest.fn(),
  mapCinetpayStatus: jest.requireActual('../services/cinetpay-service').mapCinetpayStatus,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cinetpayService = require('../services/cinetpay-service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const paymentsRouter = require('../routes/payments');

function buildApp() {
  const app = express();
  // Mirror server.js: the webhook receives CinetPay's form-urlencoded POST.
  app.use(
    '/api/v1/payments/cinetpay/webhook',
    express.urlencoded({ extended: false, limit: '1mb' }),
  );
  app.use(express.json());
  app.use('/api/v1/payments', paymentsRouter);
  return app;
}

describe('CinetPay payment routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cinetpayService.isCinetpayConfigured.mockReturnValue(true);
  });

  describe('GET /cinetpay/config', () => {
    it('reports enabled=true when configured', async () => {
      const res = await request(buildApp()).get('/api/v1/payments/cinetpay/config');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { enabled: true } });
    });

    it('reports enabled=false when not configured', async () => {
      cinetpayService.isCinetpayConfigured.mockReturnValue(false);
      const res = await request(buildApp()).get('/api/v1/payments/cinetpay/config');
      expect(res.body.data.enabled).toBe(false);
    });
  });

  describe('POST /cinetpay/checkout', () => {
    it('returns 503 when CinetPay is not configured', async () => {
      cinetpayService.isCinetpayConfigured.mockReturnValue(false);
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/checkout')
        .send({ planId: String(plan._id) });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('PAYMENTS_NOT_CONFIGURED');
    });

    it('rejects an invalid planId', async () => {
      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/checkout')
        .send({ planId: 'not-an-id' });
      expect(res.status).toBe(400);
    });

    it('rejects a plan priced below the minimum online-payable amount', async () => {
      const plan = await Plan.create({ name: 'رمزي', durationDays: 30, price: 10, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/checkout')
        .send({ planId: String(plan._id) });
      expect(res.status).toBe(400);
    });

    it('creates a Payment record and returns the CinetPay payment URL', async () => {
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      cinetpayService.createCinetpayCheckout.mockResolvedValue({
        payment_token: 'ptok_1',
        payment_url: 'https://checkout.cinetpay.com/payment/tok_cinetpay_1',
      });

      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/checkout')
        .send({ planId: String(plan._id) });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.checkoutUrl).toBe('https://checkout.cinetpay.com/payment/tok_cinetpay_1');
      expect(res.body.data.amount).toBe(500);
      expect(res.body.data.planName).toBe('شهري');

      const saved = await Payment.findOne({ publicToken: res.body.data.token }).exec();
      expect(saved).toBeTruthy();
      expect(saved!.provider).toBe('cinetpay');
      expect(saved!.checkoutId).toBe(res.body.data.token);
      expect(saved!.status).toBe('pending');
      expect(saved!.amount).toBe(500);
    });

    it('marks the payment failed and returns 502 when CinetPay checkout creation throws', async () => {
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      cinetpayService.createCinetpayCheckout.mockRejectedValue(new Error('network error'));

      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/checkout')
        .send({ planId: String(plan._id) });

      expect(res.status).toBe(502);
      const saved = await Payment.findOne({ planId: plan._id }).exec();
      expect(saved!.status).toBe('failed');
    });
  });

  describe('POST /cinetpay/webhook', () => {
    it('returns 400 when the notification carries no transaction id', async () => {
      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/webhook')
        .type('form')
        .send({});
      expect(res.status).toBe(400);
    });

    it('acks unknown transactions with 200 so retries stop', async () => {
      cinetpayService.checkCinetpayTransaction.mockResolvedValue({ status: 'ACCEPTED' });
      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/webhook')
        .type('form')
        .send({ cpm_trans_id: 'no-such-tx' });
      expect(res.status).toBe(200);
    });

    it('fulfills a paid transaction: generates one activation code and stores it encrypted', async () => {
      const plan = await Plan.create({ name: 'سنوي', durationDays: 365, price: 4500, currency: 'DZD', maxDevices: 2, maxConcurrentStreams: 2 });
      const payment = await Payment.create({
        provider: 'cinetpay',
        publicToken: 'tok_cinetpay_wh_1',
        checkoutId: 'tok_cinetpay_wh_1',
        status: 'pending',
        planId: plan._id,
        amount: 4500,
        currency: 'DZD',
      });

      cinetpayService.checkCinetpayTransaction.mockResolvedValue({
        status: 'ACCEPTED',
        paymentMethod: 'MTN_CI',
      });

      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/webhook')
        .type('form')
        .send({ cpm_trans_id: 'tok_cinetpay_wh_1', cpm_result: '00' });

      expect(res.status).toBe(200);

      const saved = await Payment.findById(payment._id).select('+codeEnc').exec();
      expect(saved!.status).toBe('paid');
      expect(saved!.fulfilledAt).toBeTruthy();
      expect(saved!.activationCodeId).toBeTruthy();
      expect(saved!.codeEnc).toBeTruthy();

      // The code can be revealed via the status endpoint exactly once encrypted.
      const statusRes = await request(buildApp()).get(`/api/v1/payments/cinetpay/status/${saved!.publicToken}`);
      expect(statusRes.body.data.status).toBe('paid');
      expect(typeof statusRes.body.data.code).toBe('string');
      expect(statusRes.body.data.code).toMatch(/^DZPAY/);

      const codeDoc = await ActivationCode.findById(saved!.activationCodeId).exec();
      expect(codeDoc).toBeTruthy();
    });

    it('never fulfills twice — a second webhook for a paid payment is a no-op', async () => {
      const plan = await Plan.create({ name: 'سنوي', durationDays: 365, price: 4500, currency: 'DZD', maxDevices: 2, maxConcurrentStreams: 2 });
      const { encryptSecret } = require('../utils/crypto');
      await Payment.create({
        provider: 'cinetpay',
        publicToken: 'tok_cinetpay_wh_2',
        checkoutId: 'tok_cinetpay_wh_2',
        status: 'paid',
        planId: plan._id,
        amount: 4500,
        currency: 'DZD',
        codeEnc: encryptSecret('DZPAY-EXISTING-0001'),
        activationCodeId: new (require('mongoose').Types.ObjectId)(),
      });

      cinetpayService.checkCinetpayTransaction.mockResolvedValue({ status: 'ACCEPTED' });
      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/webhook')
        .type('form')
        .send({ cpm_trans_id: 'tok_cinetpay_wh_2' });

      expect(res.status).toBe(200);
      const codes = await ActivationCode.countDocuments();
      expect(codes).toBe(0);
    });

    it('marks the payment failed when the check reports REFUSED', async () => {
      const plan = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
      const payment = await Payment.create({
        provider: 'cinetpay',
        publicToken: 'tok_cinetpay_wh_3',
        checkoutId: 'tok_cinetpay_wh_3',
        status: 'pending',
        planId: plan._id,
        amount: 500,
        currency: 'DZD',
      });

      cinetpayService.checkCinetpayTransaction.mockResolvedValue({ status: 'REFUSED' });
      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/webhook')
        .type('form')
        .send({ cpm_trans_id: 'tok_cinetpay_wh_3' });

      expect(res.status).toBe(200);
      const saved = await Payment.findById(payment._id).exec();
      expect(saved!.status).toBe('failed');
    });

    it('returns 500 when the verification check throws so CinetPay retries', async () => {
      await Payment.create({
        provider: 'cinetpay',
        publicToken: 'tok_cinetpay_wh_4',
        checkoutId: 'tok_cinetpay_wh_4',
        status: 'pending',
        planId: new (require('mongoose').Types.ObjectId)(),
        amount: 500,
        currency: 'DZD',
      });
      cinetpayService.checkCinetpayTransaction.mockRejectedValue(new Error('gateway down'));

      const res = await request(buildApp())
        .post('/api/v1/payments/cinetpay/webhook')
        .type('form')
        .send({ cpm_trans_id: 'tok_cinetpay_wh_4' });
      expect(res.status).toBe(500);
    });
  });
});
