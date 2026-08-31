import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Reseller from '../models/Reseller';
import Plan from '../models/Plan';
import ActivationCode from '../models/ActivationCode';
import Subscription from '../models/Subscription';
import User from '../models/User';
import { generateCodes } from '../services/subscription-service';

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

async function makePlan() {
  return Plan.create({ name: 'شهري', durationDays: 30, maxDevices: 1, price: 500, currency: 'DZD', status: 'Active' });
}

async function makeReseller(planId: string) {
  return Reseller.create({
    _id: RESELLER_ID,
    name: 'محل الاختبار',
    city: 'الجزائر',
    status: 'Active',
    credit: [{ planId, quantity: 50 }],
  });
}

async function mint(resellerId: string, planId: string, qty: number, customer: { customerName?: string; customerPhone?: string }) {
  const result = await generateCodes({
    planId: String(planId),
    quantity: qty,
    prefix: 'DZHF',
    resellerId,
    customerName: customer.customerName || null,
    customerPhone: customer.customerPhone || null,
  });
  return result;
}

describe('Reseller client list (قائمة عملاء الموزع)', () => {
  beforeEach(async () => {
    await ActivationCode.deleteMany({});
    await Reseller.deleteMany({});
    await Plan.deleteMany({});
    await Subscription.deleteMany({});
    await User.deleteMany({});
  });

  it('groups codes by customer and excludes anonymous codes', async () => {
    const plan = await makePlan();
    await makeReseller(String(plan._id));
    await mint(String(RESELLER_ID), String(plan._id), 2, { customerName: 'محمد الأمين', customerPhone: '0550123456' });
    await mint(String(RESELLER_ID), String(plan._id), 1, { customerName: 'محمد الأمين', customerPhone: '0550123456' }); // same customer
    await mint(String(RESELLER_ID), String(plan._id), 1, { customerName: 'خالد', customerPhone: '0661122334' });
    await mint(String(RESELLER_ID), String(plan._id), 1, {}); // anonymous — must NOT appear

    const app = buildApp();
    const res = await request(app).get('/api/v1/reseller/clients');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const clients = res.body.data.clients;
    expect(clients).toHaveLength(2);
    const mohammed = clients.find((c: any) => c.phone === '0550123456');
    expect(mohammed).toBeDefined();
    expect(mohammed.name).toBe('محمد الأمين');
    expect(mohammed.codeCount).toBe(3);
    expect(res.body.data.summary.totalCodes).toBe(4);
    expect(res.body.data.summary.totalClients).toBe(2);
  });

  it('shows subscription expiry and marks expiring-soon clients first', async () => {
    const plan = await makePlan();
    await makeReseller(String(plan._id));
    await mint(String(RESELLER_ID), String(plan._id), 1, { customerName: 'علي', customerPhone: '0771122334' });
    const codeDoc = await ActivationCode.findOne({ resellerId: RESELLER_ID }).exec();
    // Activate it + create a subscription expiring in 3 days.
    codeDoc!.status = 'ACTIVATED';
    codeDoc!.activatedAt = new Date();
    await codeDoc!.save();
    await Subscription.create({
      userId: new mongoose.Types.ObjectId(),
      planId: plan._id,
      activationCodeId: codeDoc!._id,
      status: 'ACTIVE',
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });

    const app = buildApp();
    const res = await request(app).get('/api/v1/reseller/clients');
    const client = res.body.data.clients[0];
    expect(client.name).toBe('علي');
    expect(client.expiringSoon).toBe(true);
    expect(client.nextExpiry).toBeTruthy();
    expect(client.codes[0].status).toBe('ACTIVATED');
    expect(client.codes[0].expiresAt).toBeTruthy();
    expect(res.body.data.summary.expiringSoon).toBe(1);
  });

  it('filters clients by name or phone search', async () => {
    const plan = await makePlan();
    await makeReseller(String(plan._id));
    await mint(String(RESELLER_ID), String(plan._id), 1, { customerName: 'محمد الأمين', customerPhone: '0550123456' });
    await mint(String(RESELLER_ID), String(plan._id), 1, { customerName: 'خالد', customerPhone: '0661122334' });

    const app = buildApp();
    const byName = await request(app).get('/api/v1/reseller/clients').query({ search: 'خالد' });
    expect(byName.body.data.clients).toHaveLength(1);
    expect(byName.body.data.clients[0].name).toBe('خالد');

    const byPhone = await request(app).get('/api/v1/reseller/clients').query({ search: '0550123456' });
    expect(byPhone.body.data.clients).toHaveLength(1);
    expect(byPhone.body.data.clients[0].phone).toBe('0550123456');
  });
});
