import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Reseller from '../models/Reseller';
import Plan from '../models/Plan';
import ActivationCode from '../models/ActivationCode';
import Subscription from '../models/Subscription';
import { redeemCode } from '../services/subscription-service';

// Reseller portal routes are protected by requireReseller — mock it with a
// stable reseller id so requests across one test share the same owner.
const RESELLER_ID = new mongoose.Types.ObjectId();
jest.mock('../middleware/requireReseller', () => ({
  requireReseller: (req: any, _res: any, next: any) => {
    req.reseller = { _id: RESELLER_ID, name: 'محل الاختبار', prefix: 'DZHF', status: 'Active' };
    next();
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const resellerRouter = require('../routes/reseller');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/reseller', resellerRouter);
  return app;
}

async function makePlan(overrides: Partial<{ allowCustomDuration: boolean; durationDays: number }> = {}) {
  return Plan.create({
    name: 'شهري',
    durationDays: overrides.durationDays ?? 30,
    maxDevices: 1,
    price: 500,
    currency: 'DZD',
    status: 'Active',
    allowCustomDuration: overrides.allowCustomDuration ?? false,
  });
}

async function makeReseller(planId: string, creditQty = 5) {
  return Reseller.create({
    _id: RESELLER_ID,
    name: 'محل الاختبار',
    city: 'الجزائر',
    status: 'Active',
    credit: [{ planId, quantity: creditQty }],
  });
}

describe('Reseller code generation with customer info + custom duration (مدة مخصصة)', () => {
  beforeEach(async () => {
    await ActivationCode.deleteMany({});
    await Reseller.deleteMany({});
    await Plan.deleteMany({});
    await Subscription.deleteMany({});
  });

  it('persists customer name/phone and a custom duration on generated codes', async () => {
    const plan = await makePlan({ allowCustomDuration: true });
    await makeReseller(String(plan._id), 3);
    const app = buildApp();

    const res = await request(app).post('/api/v1/reseller/codes/generate').send({
      planId: String(plan._id),
      quantity: 2,
      customerName: 'محمد الأمين',
      customerPhone: '0550123456',
      customDays: 45,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.codes).toHaveLength(2);

    const codes = await ActivationCode.find({ resellerId: RESELLER_ID }).lean().exec();
    expect(codes).toHaveLength(2);
    for (const c of codes) {
      expect(c.customerName).toBe('محمد الأمين');
      expect(c.customerPhone).toBe('0550123456');
      expect(c.customDurationDays).toBe(45);
    }
  });

  it('rejects custom days on a plan that does not allow custom durations', async () => {
    const plan = await makePlan({ allowCustomDuration: false });
    await makeReseller(String(plan._id), 3);
    const app = buildApp();

    const res = await request(app).post('/api/v1/reseller/codes/generate').send({
      planId: String(plan._id),
      quantity: 1,
      customDays: 45,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CUSTOM_DURATION_NOT_ALLOWED');
    // Credit must NOT be consumed on rejection.
    const reseller = await Reseller.findById(RESELLER_ID).lean().exec();
    expect((reseller!.credit as any[]).find((c) => String(c.planId) === String(plan._id)).quantity).toBe(3);
  });

  it('validates custom days range (1–730)', async () => {
    const plan = await makePlan({ allowCustomDuration: true });
    await makeReseller(String(plan._id), 3);
    const app = buildApp();

    const res = await request(app).post('/api/v1/reseller/codes/generate').send({
      planId: String(plan._id),
      quantity: 1,
      customDays: 9999,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('customDays');
  });

  it('returns a statement with summary and ledger rows', async () => {
    const plan = await makePlan({ allowCustomDuration: true });
    await makeReseller(String(plan._id), 3);
    const app = buildApp();

    await request(app).post('/api/v1/reseller/codes/generate').send({
      planId: String(plan._id),
      quantity: 2,
      customDays: 45,
    });

    const res = await request(app).get('/api/v1/reseller/statement');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary.consumed).toBe(2);
    expect(res.body.data.rows.length).toBeGreaterThan(0);
    expect(res.body.data.rows.some((r: any) => r.type === 'CONSUME')).toBe(true);
  });

  it('redeems a code with custom duration into a matching subscription', async () => {
    const plan = await makePlan({ allowCustomDuration: true });
    await makeReseller(String(plan._id), 1);
    const app = buildApp();

    const gen = await request(app).post('/api/v1/reseller/codes/generate').send({
      planId: String(plan._id),
      quantity: 1,
      customDays: 45,
    });
    const plainCode = gen.body.data.codes[0];

    const userId = new mongoose.Types.ObjectId();
    const result = await redeemCode(String(userId), plainCode);

    expect(result.success).toBe(true);
    const sub = await Subscription.findOne({ userId }).lean().exec();
    const expectedMs = 45 * 24 * 60 * 60 * 1000;
    const diff = Math.abs(new Date(sub!.expiresAt).getTime() - (Date.now() + expectedMs));
    expect(diff).toBeLessThan(60_000); // allow clock drift
  });
});
