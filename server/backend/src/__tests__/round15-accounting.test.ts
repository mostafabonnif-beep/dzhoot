import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Plan from '../models/Plan';
import Reseller from '../models/Reseller';
import CreditTransaction from '../models/CreditTransaction';
import ActivationCode from '../models/ActivationCode';
import CodeBatch from '../models/CodeBatch';
import ResellerDebt from '../models/ResellerDebt';
import { recordCreditTx } from '../services/subscription-service';

/* ------------------------------------------------------------------ */
/* Round 15 regression tests: honest money accounting + panel fixes.  */
/* ------------------------------------------------------------------ */

// --- Reseller portal (mock requireReseller) ---
const RESELLER_ID = new mongoose.Types.ObjectId();
jest.mock('../middleware/requireReseller', () => ({
  requireReseller: (req: any, _res: any, next: any) => {
    req.reseller = { _id: RESELLER_ID, name: 'محل الاختبار', status: 'Active' };
    next();
  },
}));

// --- Admin routes (mock auth) ---
jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-id', role: 'Admin' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/epg-service', () => ({
  epgService: {
    getStats: jest.fn().mockResolvedValue({
      totalPrograms: 0,
      channelsWithEpg: 0,
      totalSystemChannels: 0,
      lastRefreshedAt: null,
      nextRefreshAt: null,
      sourcesDiscovered: 0,
      refreshInProgress: false,
      lastRefreshDurationMs: 0,
      lastRefreshProgramCount: 0,
      lastRefreshErrorCount: 0,
      lastRefreshErrorSources: [],
    }),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const resellerRouter = require('../routes/reseller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminRouter = require('../routes/admin');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminPlansRouter = require('../routes/admin-plans');

function resellerApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/reseller', resellerRouter);
  return app;
}

function adminApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
}

function plansApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/plans', adminPlansRouter);
  return app;
}

async function makePlan(overrides: Record<string, unknown> = {}) {
  return Plan.create({
    name: 'شهري',
    durationDays: 30,
    maxDevices: 1,
    maxConcurrentStreams: 1,
    price: 1000,
    currency: 'DZD',
    status: 'Active',
    ...overrides,
  });
}

describe('Round 15 — reseller /me net credit (netQty)', () => {
  beforeEach(async () => {
    await CreditTransaction.deleteMany({});
    await Reseller.deleteMany({});
    await ActivationCode.deleteMany({});
  });

  it('returns are credited back, clawbacks do not inflate purchases', async () => {
    const plan = await makePlan();
    const reseller = await Reseller.create({
      _id: RESELLER_ID,
      name: 'محل الاختبار',
      city: 'الجزائر',
      status: 'Active',
      credit: [{ planId: plan._id, quantity: 100 }],
      prices: [{ planId: plan._id, price: 1000 }],
    });

    // Real ledger: 100 granted @1000, 40 consumed, 10 returned (expiry),
    // then an admin clawback of 20 (negative GRANT).
    await recordCreditTx({ resellerId: String(reseller._id), planId: String(plan._id), type: 'GRANT', quantity: 100, balanceAfter: 100, unitPrice: 1000, note: 'شراء' });
    await recordCreditTx({ resellerId: String(reseller._id), planId: String(plan._id), type: 'CONSUME', quantity: -40, balanceAfter: 60, unitPrice: 1000, note: 'توليد' });
    await recordCreditTx({ resellerId: String(reseller._id), planId: String(plan._id), type: 'RETURN', quantity: 10, balanceAfter: 70, unitPrice: 1000, note: 'انتهاء' });
    await recordCreditTx({ resellerId: String(reseller._id), planId: String(plan._id), type: 'GRANT', quantity: -20, balanceAfter: 50, unitPrice: 1000, note: 'خصم رصيد' });

    const res = await request(resellerApp()).get('/api/v1/reseller/me');
    expect(res.status).toBe(200);
    const account = res.body.data.account;
    // netQty = granted(100-20) - consumed(40) + returned(10) = 50
    expect(account.netQty).toBe(50);
    // purchasedValue counts only positive top-ups: 100 × 1000, NOT the clawback.
    expect(account.purchasedValue).toBe(100000);
  });
});

describe('Round 15 — debts: server-side sort + validation', () => {
  beforeEach(async () => {
    await ResellerDebt.deleteMany({});
  });

  it('sorts UNPAID first, then PARTIAL, then PAID (server order)', async () => {
    await ResellerDebt.create({ resellerId: RESELLER_ID, customerName: 'مدفوع', amount: 500, status: 'PAID', paidAmount: 500, createdAt: new Date('2026-01-03') });
    await ResellerDebt.create({ resellerId: RESELLER_ID, customerName: 'جزئي', amount: 800, status: 'PARTIAL', paidAmount: 300, createdAt: new Date('2026-01-02') });
    await ResellerDebt.create({ resellerId: RESELLER_ID, customerName: 'غير مدفوع', amount: 2000, status: 'UNPAID', createdAt: new Date('2026-01-01') });

    const res = await request(resellerApp()).get('/api/v1/reseller/debts');
    expect(res.status).toBe(200);
    expect(res.body.data.map((d: any) => d.status)).toEqual(['UNPAID', 'PARTIAL', 'PAID']);
    expect(res.body.summary.totalDebts).toBe(3);
    expect(res.body.summary.outstanding).toBe(2500); // 2000 + (800-300)
  });

  it('rejects a zero-amount debt and a negative quantity', async () => {
    const app = resellerApp();
    const zero = await request(app).post('/api/v1/reseller/debts').send({ customerName: 'فلان', amount: 0 });
    expect(zero.status).toBe(400);

    const neg = await request(app).post('/api/v1/reseller/debts').send({ customerName: 'فلان', amount: 1000, quantity: -3 });
    expect(neg.status).toBe(400);
  });
});

describe('Round 15 — business summary: real operator revenue', () => {
  beforeEach(async () => {
    await Plan.deleteMany({});
    await Reseller.deleteMany({});
    await CreditTransaction.deleteMany({});
    await ActivationCode.deleteMany({});
    await CodeBatch.deleteMany({});
  });

  it('revenue = credit top-ups + batch deliveries + admin-issued activations only', async () => {
    const plan = await makePlan();
    const reseller = await Reseller.create({
      name: 'dzsat',
      city: 'الجزائر',
      status: 'Active',
      credit: [{ planId: plan._id, quantity: 0 }],
      prices: [{ planId: plan._id, price: 1000 }],
    });

    // 1) Reseller credit top-up: 5 codes @1000 → 5000 revenue.
    await recordCreditTx({ resellerId: String(reseller._id), planId: String(plan._id), type: 'GRANT', quantity: 5, balanceAfter: 5, unitPrice: 1000, note: 'شراء رصيد' });
    // 2) Clawback -2: reduces credit, must NOT add money.
    await recordCreditTx({ resellerId: String(reseller._id), planId: String(plan._id), type: 'GRANT', quantity: -2, balanceAfter: 3, unitPrice: 1000, note: 'خصم' });
    // 3) Wholesale batch delivery: 3 codes @1000 → 3000 revenue.
    await CodeBatch.create({
      resellerId: reseller._id,
      planId: plan._id,
      batchNumber: 1,
      quantity: 3,
      wholesalePrice: 1000,
      wholesaleTotal: 3000,
      receiptDate: new Date(),
      status: 'delivered',
    });
    // 4) Admin-issued activation (no reseller) → 1000 revenue.
    await ActivationCode.create({ prefix: 'DZ', codeHash: 'admin1', codeEnc: 'enc', codeLast4: '9001', planId: plan._id, status: 'ACTIVATED', activatedAt: new Date() });
    // 5) Reseller-issued activation → operator already got paid via the
    //    top-up; counting it again would double-count. NOT revenue.
    await ActivationCode.create({ prefix: 'DZ', codeHash: 'res1', codeEnc: 'enc', codeLast4: '9002', planId: plan._id, resellerId: reseller._id, status: 'ACTIVATED', activatedAt: new Date() });

    const res = await request(adminApp()).get('/admin/business/summary');
    expect(res.status).toBe(200);
    const { summary, byReseller } = res.body.data;

    expect(summary.revenueThisMonth).toBe(9000); // 5000 + 3000 + 1000
    expect(summary.revenueTotal).toBe(9000);
    expect(summary.revenueBreakdown).toMatchObject({
      creditPurchasesThisMonth: 5000, // clawback excluded
      creditPurchasesTotal: 5000,
      batchDeliveriesThisMonth: 3000,
      batchDeliveriesTotal: 3000,
      activationsThisMonth: 1000, // admin-issued only
      activationsTotal: 1000,
    });
    // Activations card still counts every activation (2).
    expect(summary.activatedThisMonth).toBe(2);

    // The shop's purchases = top-up (5000) + delivery (3000), no clawback.
    const row = byReseller.find((r: any) => r.name === 'dzsat');
    expect(row).toBeDefined();
    expect(row.purchases).toBe(8000);
  });
});

describe('Round 15 — plans: maxConcurrentStreams persisted', () => {
  beforeEach(async () => {
    await Plan.deleteMany({});
  });

  it('stores maxConcurrentStreams on create and update', async () => {
    const create = await request(plansApp()).post('/admin/plans').send({
      name: 'باقة 4 شاشات',
      durationDays: 30,
      maxDevices: 4,
      maxConcurrentStreams: 4,
      price: 2000,
      currency: 'DZD',
    });
    expect(create.status).toBe(201);
    expect(create.body.data.maxConcurrentStreams).toBe(4);

    const planId = create.body.data._id;
    const patch = await request(plansApp()).patch(`/admin/plans/${planId}`).send({ maxConcurrentStreams: 6 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.maxConcurrentStreams).toBe(6);

    const stored = await Plan.findById(planId).lean().exec();
    expect(stored?.maxConcurrentStreams).toBe(6);
  });

  it('rejects invalid maxConcurrentStreams', async () => {
    const res = await request(plansApp()).post('/admin/plans').send({
      name: 'سيئة',
      durationDays: 30,
      maxDevices: 1,
      maxConcurrentStreams: 0,
      price: 500,
    });
    expect(res.status).toBe(400);
  });
});

describe('Round 15 — notifications: delivery stats stay honest while status stays SENT', () => {
  it('pushOutcome reports push failure without changing the in-app SENT status', async () => {
    const { pushOutcome } = require('../services/fcm-service');

    expect(pushOutcome({ configured: false, attempted: 0, sent: 0, failed: 0, skipped: 'FCM is not configured' })).toEqual({
      pushDelivered: false,
      reason: 'FCM is not configured',
    });
    expect(pushOutcome({ configured: true, attempted: 0, sent: 0, failed: 0 })).toEqual({
      pushDelivered: false,
      reason: 'No registered devices with push tokens',
    });
    expect(pushOutcome({ configured: true, attempted: 3, sent: 2, failed: 1 })).toEqual({
      pushDelivered: true,
      reason: '',
    });
    expect(pushOutcome({ configured: true, attempted: 3, sent: 0, failed: 3 })).toEqual({
      pushDelivered: false,
      reason: 'All 3 push attempts failed (in-app delivery still works)',
    });
  });
});
