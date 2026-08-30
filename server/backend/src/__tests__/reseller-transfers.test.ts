import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Reseller from '../models/Reseller';
import Plan from '../models/Plan';
import CreditTransaction from '../models/CreditTransaction';

// The reseller router mounts requireReseller at the top — mock it with a
// mutable current-reseller so each test controls who is logged in.
let currentReseller: any = null;
jest.mock('../middleware/requireReseller', () => ({
  requireReseller: (req: any, _res: any, next: any) => {
    req.reseller = currentReseller;
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

async function makePlan(name = 'شهري', durationDays = 30) {
  return Plan.create({ name, durationDays, maxDevices: 1, price: 1000, currency: 'DZD', status: 'Active' });
}

async function makeReseller(username: string, planId: mongoose.Types.ObjectId, creditQty = 10) {
  const r = await Reseller.create({
    name: `محل ${username}`,
    city: 'الجزائر',
    status: 'Active',
    username,
    prefix: username.toUpperCase().slice(0, 3),
    credit: [{ planId, quantity: creditQty }],
  });
  return r.toObject();
}

describe('Reseller credit transfers (تحويل رصيد بين الموزعين)', () => {
  beforeEach(async () => {
    currentReseller = null;
    await CreditTransaction.deleteMany({});
    await Reseller.deleteMany({});
  });

  it('transfers plan credit from one reseller to another with ledger rows on both sides', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const sender = await makeReseller('sender', plan._id, 10);
    const recipient = await makeReseller('receiver', plan._id, 2);
    currentReseller = sender;

    const res = await request(app)
      .post('/api/v1/reseller/transfers')
      .send({ toUsername: 'receiver', planId: String(plan._id), quantity: 3 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ quantity: 3, senderBalanceAfter: 7, recipientBalanceAfter: 5 });

    const senderAfter = await Reseller.findById(sender._id).lean().exec();
    const recipientAfter = await Reseller.findById(recipient._id).lean().exec();
    expect((senderAfter!.credit as any[]).find((c) => String(c.planId) === String(plan._id)).quantity).toBe(7);
    expect((recipientAfter!.credit as any[]).find((c) => String(c.planId) === String(plan._id)).quantity).toBe(5);

    const txns = await CreditTransaction.find({}).sort({ createdAt: 1 }).lean().exec();
    expect(txns).toHaveLength(2);
    // Order between the two ledger rows is not deterministic (same-ms writes) —
    // match each row by type instead of index.
    const out = txns.find((t: any) => t.type === 'TRANSFER_OUT');
    const inn = txns.find((t: any) => t.type === 'TRANSFER_IN');
    expect(out).toMatchObject({ type: 'TRANSFER_OUT', quantity: -3, resellerId: sender._id, counterpartyId: recipient._id });
    expect(inn).toMatchObject({ type: 'TRANSFER_IN', quantity: 3, resellerId: recipient._id, counterpartyId: sender._id });
  });

  it('creates the recipient credit entry when they had none for that plan', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const sender = await makeReseller('sender2', plan._id, 10);
    const recipient = await Reseller.create({
      name: 'محل جديد',
      status: 'Active',
      username: 'newshop',
      prefix: 'NEW',
      credit: [],
    });
    currentReseller = sender;

    const res = await request(app)
      .post('/api/v1/reseller/transfers')
      .send({ toUsername: 'newshop', planId: String(plan._id), quantity: 2 });

    expect(res.status).toBe(201);
    const recipientAfter = await Reseller.findById(recipient._id).lean().exec();
    expect((recipientAfter!.credit as any[]).find((c) => String(c.planId) === String(plan._id)).quantity).toBe(2);
  });

  it('rejects transfers with insufficient credit without mutating balances', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const sender = await makeReseller('sender3', plan._id, 1);
    const recipient = await makeReseller('receiver3', plan._id, 2);
    currentReseller = sender;

    const res = await request(app)
      .post('/api/v1/reseller/transfers')
      .send({ toUsername: 'receiver3', planId: String(plan._id), quantity: 5 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSUFFICIENT_CREDIT');
    const senderAfter = await Reseller.findById(sender._id).lean().exec();
    expect((senderAfter!.credit as any[]).find((c) => String(c.planId) === String(plan._id)).quantity).toBe(1);
  });

  it('rejects self-transfer and unknown recipients', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const sender = await makeReseller('sender4', plan._id, 5);
    currentReseller = sender;

    const selfRes = await request(app)
      .post('/api/v1/reseller/transfers')
      .send({ toUsername: 'sender4', planId: String(plan._id), quantity: 1 });
    expect(selfRes.status).toBe(400);

    const missingRes = await request(app)
      .post('/api/v1/reseller/transfers')
      .send({ toUsername: 'nobody', planId: String(plan._id), quantity: 1 });
    expect(missingRes.status).toBe(404);
  });

  it('blocks transfers when the reseller lacks the transfers permission', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const sender = await makeReseller('sender5', plan._id, 5);
    sender.permissions = { transfers: false };
    const recipient = await makeReseller('receiver5', plan._id, 0);
    currentReseller = sender;

    const res = await request(app)
      .post('/api/v1/reseller/transfers')
      .send({ toUsername: 'receiver5', planId: String(plan._id), quantity: 1 });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });

  it('lists transfer history for the reseller', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const sender = await makeReseller('sender6', plan._id, 10);
    const recipient = await makeReseller('receiver6', plan._id, 2);
    currentReseller = sender;
    await request(app)
      .post('/api/v1/reseller/transfers')
      .send({ toUsername: 'receiver6', planId: String(plan._id), quantity: 3 });

    currentReseller = recipient;
    const res = await request(app).get('/api/v1/reseller/transfers');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ type: 'TRANSFER_IN', quantity: 3 });
  });
});
