import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import ResellerDebt from '../models/ResellerDebt';

// Reseller portal routes are protected by requireReseller — mock it with a
// stable reseller id so requests across one test share the same owner.
const RESELLER_ID = new mongoose.Types.ObjectId();
jest.mock('../middleware/requireReseller', () => {
  const requireReseller = (req: any, _res: any, next: any) => {
    req.reseller = { _id: RESELLER_ID, name: 'محل الاختبار', status: 'Active' };
    next();
  };
  return { requireReseller, requireResellerOrApiKeyForReads: requireReseller };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const resellerRouter = require('../routes/reseller');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/reseller', resellerRouter);
  return app;
}

describe('Reseller customer debts (ديون الزبائن)', () => {
  beforeEach(async () => {
    await ResellerDebt.deleteMany({});
  });

  it('creates a debt and lists it with a correct outstanding summary', async () => {
    const app = buildApp();

    const create = await request(app).post('/api/v1/reseller/debts').send({
      customerName: 'محمد',
      customerPhone: '0550123456',
      amount: 2000,
      quantity: 1,
      planName: 'شهري',
      note: 'أخذ كود ولم يدفع',
    });
    expect(create.status).toBe(201);
    expect(create.body.success).toBe(true);

    const list = await request(app).get('/api/v1/reseller/debts');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      customerName: 'محمد',
      customerPhone: '0550123456',
      amount: 2000,
      remaining: 2000,
      status: 'UNPAID',
    });
    expect(list.body.summary).toMatchObject({ outstanding: 2000, unpaidCount: 1 });
  });

  it('rejects a debt without a customer name', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/v1/reseller/debts').send({ amount: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/customerName/);
  });

  it('settles a debt (status PAID) and removes it from the outstanding summary', async () => {
    const app = buildApp();
    const debt = await ResellerDebt.create({
      resellerId: RESELLER_ID,
      customerName: 'أحمد',
      amount: 1500,
      status: 'UNPAID',
    });

    const settle = await request(app)
      .patch(`/api/v1/reseller/debts/${String(debt._id)}`)
      .send({ status: 'PAID' });
    expect(settle.status).toBe(200);
    expect(settle.body.data.status).toBe('PAID');
    expect(settle.body.data.remaining).toBe(0);

    const list = await request(app).get('/api/v1/reseller/debts');
    expect(list.body.data[0].status).toBe('PAID');
    expect(list.body.summary).toMatchObject({ outstanding: 0, unpaidCount: 0 });
  });

  it('supports partial payment and scopes debts to the reseller', async () => {
    const app = buildApp();
    // another reseller's debt must be invisible
    await ResellerDebt.create({
      resellerId: new mongoose.Types.ObjectId(),
      customerName: 'غريب',
      amount: 9999,
    });
    const debt = await ResellerDebt.create({
      resellerId: RESELLER_ID,
      customerName: 'سعيد',
      amount: 3000,
    });

    const partial = await request(app)
      .patch(`/api/v1/reseller/debts/${String(debt._id)}`)
      .send({ status: 'PARTIAL', paidAmount: 1000 });
    expect(partial.status).toBe(200);
    expect(partial.body.data).toMatchObject({ status: 'PARTIAL', paidAmount: 1000, remaining: 2000 });

    const list = await request(app).get('/api/v1/reseller/debts');
    expect(list.body.data).toHaveLength(1); // the other reseller's debt is hidden
    expect(list.body.summary).toMatchObject({ outstanding: 2000, unpaidCount: 1 });
  });

  it('deletes a debt', async () => {
    const app = buildApp();
    const debt = await ResellerDebt.create({
      resellerId: RESELLER_ID,
      customerName: 'يوسف',
      amount: 800,
    });
    const del = await request(app).delete(`/api/v1/reseller/debts/${String(debt._id)}`);
    expect(del.status).toBe(200);
    expect(await ResellerDebt.countDocuments({ _id: debt._id })).toBe(0);
  });
});
