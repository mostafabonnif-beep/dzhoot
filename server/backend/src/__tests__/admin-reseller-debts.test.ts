import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Reseller from '../models/Reseller';
import Plan from '../models/Plan';
import ResellerCreditDebt from '../models/ResellerCreditDebt';

// Both admin routers require requireAuth/requireAdmin — mock them with a stable admin id.
const ADMIN_ID = new mongoose.Types.ObjectId();
jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: ADMIN_ID, role: 'Admin' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const resellersRouter = require('../routes/admin-resellers');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const debtsRouter = require('../routes/admin-reseller-debts');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/resellers', resellersRouter);
  app.use('/api/v1/admin/reseller-debts', debtsRouter);
  return app;
}

async function makePlan() {
  return Plan.create({ name: 'شهري', durationDays: 30, maxDevices: 1, price: 1000, currency: 'DZD', status: 'Active' });
}

async function makeReseller(planId: mongoose.Types.ObjectId, wholesalePrice = 700) {
  return Reseller.create({
    name: 'محل الديون',
    city: 'الجزائر',
    status: 'Active',
    prices: [{ planId, price: wholesalePrice }],
    credit: [],
  });
}

describe('Admin reseller credit debts (ديون المحلات)', () => {
  beforeEach(async () => {
    await ResellerCreditDebt.deleteMany({});
    await Reseller.deleteMany({ name: 'محل الديون' });
  });

  it('auto-creates a debt when credit is granted unpaid (amount = qty × wholesale price)', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const reseller = await makeReseller(plan._id, 700);

    const res = await request(app)
      .put(`/api/v1/admin/resellers/${String(reseller._id)}`)
      .send({ name: reseller.name, credit: [{ planId: String(plan._id), quantity: 10 }] });
    expect(res.status).toBe(200);

    const debts = await ResellerCreditDebt.find({ resellerId: reseller._id }).lean().exec();
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ amount: 7000, status: 'UNPAID', autoFromGrant: true, paidAmount: 0 });
  });

  it('does NOT create a debt when the grant is marked paid (creditPaid: true)', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const reseller = await makeReseller(plan._id, 700);

    await request(app)
      .put(`/api/v1/admin/resellers/${String(reseller._id)}`)
      .send({ name: reseller.name, credit: [{ planId: String(plan._id), quantity: 5 }], creditPaid: true });

    const debts = await ResellerCreditDebt.find({ resellerId: reseller._id }).lean().exec();
    expect(debts).toHaveLength(0);
  });

  it('lists debts with an outstanding summary and settles them', async () => {
    const app = buildApp();
    const reseller = await makeReseller(new mongoose.Types.ObjectId());
    await ResellerCreditDebt.create({
      adminId: ADMIN_ID,
      resellerId: reseller._id,
      amount: 3000,
      status: 'UNPAID',
      note: 'منح رصيد',
    });

    const list = await request(app).get('/api/v1/admin/reseller-debts');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ resellerName: 'محل الديون', amount: 3000, remaining: 3000, status: 'UNPAID' });
    expect(list.body.summary).toMatchObject({ outstanding: 3000, unpaidCount: 1 });

    const settle = await request(app)
      .patch(`/api/v1/admin/reseller-debts/${list.body.data[0]._id}`)
      .send({ status: 'PAID' });
    expect(settle.status).toBe(200);
    expect(settle.body.data.status).toBe('PAID');

    const after = await request(app).get('/api/v1/admin/reseller-debts');
    expect(after.body.summary).toMatchObject({ outstanding: 0, unpaidCount: 0 });
  });

  it('scopes debts to the admin (another admin cannot see them)', async () => {
    const app = buildApp();
    const other = await ResellerCreditDebt.create({
      adminId: new mongoose.Types.ObjectId(),
      resellerId: new mongoose.Types.ObjectId(),
      amount: 9999,
    });
    const res = await request(app).get('/api/v1/admin/reseller-debts');
    expect(res.body.data).toHaveLength(0);
    expect(res.body.summary.outstanding).toBe(0);
    await ResellerCreditDebt.deleteOne({ _id: other._id });
  });

  it('supports manual debt creation and deletion', async () => {
    const app = buildApp();
    const reseller = await makeReseller(new mongoose.Types.ObjectId());

    const create = await request(app)
      .post('/api/v1/admin/reseller-debts')
      .send({ resellerId: String(reseller._id), amount: 1200, note: 'يدوي' });
    expect(create.status).toBe(201);

    const list = await request(app).get('/api/v1/admin/reseller-debts');
    expect(list.body.data).toHaveLength(1);

    const del = await request(app).delete(`/api/v1/admin/reseller-debts/${list.body.data[0]._id}`);
    expect(del.status).toBe(200);
    expect(await ResellerCreditDebt.countDocuments({})).toBe(0);
  });
});
