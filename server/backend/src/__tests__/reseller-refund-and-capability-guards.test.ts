import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Reseller from '../models/Reseller';
import Plan from '../models/Plan';
import CodeBatch from '../models/CodeBatch';
import ActivationCode from '../models/ActivationCode';

// The reseller router mounts requireReseller at the top — mock it with a
// mutable current-reseller so each test controls who is logged in.
let currentReseller: any = null;
jest.mock('../middleware/requireReseller', () => {
  const requireReseller = (req: any, _res: any, next: any) => {
    req.reseller = currentReseller;
    next();
  };
  return { requireReseller, requireResellerOrApiKeyForReads: requireReseller };
});

// subscription-service is partially mocked so a failure can be injected AFTER
// the codes were minted (a ledger outage) — everything else is the real thing.
let mockLedgerFails = false;
jest.mock('../services/subscription-service', () => {
  const actual = jest.requireActual('../services/subscription-service');
  return {
    ...actual,
    recordCreditTx: (opts: any) => {
      if (mockLedgerFails) return Promise.reject(new Error('ledger unavailable'));
      return actual.recordCreditTx(opts);
    },
  };
});

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

async function makeReseller(username: string, planId: mongoose.Types.ObjectId, creditQty = 10, extra: Record<string, unknown> = {}) {
  const r = await Reseller.create({
    name: `محل ${username}`,
    city: 'الجزائر',
    status: 'Active',
    username,
    prefix: username.toUpperCase().slice(0, 3),
    credit: [{ planId, quantity: creditQty }],
    ...extra,
  });
  return r.toObject();
}

function creditQty(reseller: any, planId: mongoose.Types.ObjectId | string): number {
  const entry = (reseller?.credit || []).find((c: any) => String(c.planId) === String(planId));
  return entry ? entry.quantity : 0;
}

describe('Reseller refund safety (لا استرداد مزدوج ولا أكواد مجانية)', () => {
  beforeEach(() => {
    currentReseller = null;
    mockLedgerFails = false;
  });

  it('refunds the credit exactly once when generation fails before any code is minted', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const reseller = await makeReseller('rollbackgen', plan._id, 4);
    currentReseller = reseller;

    const spy = jest.spyOn(CodeBatch, 'create').mockRejectedValueOnce(new Error('batch insert failed'));
    const res = await request(app)
      .post('/api/v1/reseller/codes/generate')
      .send({ planId: String(plan._id), quantity: 2 });
    spy.mockRestore();

    expect(res.status).toBe(500);
    // Exactly one refund: the starting credit is restored, never doubled.
    const after = await Reseller.findById(reseller._id).lean().exec();
    expect(creditQty(after, plan._id)).toBe(4);
    expect(await CodeBatch.countDocuments({ resellerId: reseller._id })).toBe(0);
    expect(await ActivationCode.countDocuments({ resellerId: reseller._id })).toBe(0);
  });

  it('refunds the credit when the batch-number lookup fails (no credit lost, no double refund)', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const reseller = await makeReseller('rollbacklookup', plan._id, 4);
    currentReseller = reseller;

    const chain: any = {
      sort: () => chain,
      select: () => chain,
      lean: () => chain,
      exec: () => Promise.reject(new Error('lookup failed')),
    };
    const spy = jest.spyOn(CodeBatch, 'findOne').mockReturnValueOnce(chain);
    const res = await request(app)
      .post('/api/v1/reseller/codes/generate')
      .send({ planId: String(plan._id), quantity: 2 });
    spy.mockRestore();

    expect(res.status).toBe(500);
    const after = await Reseller.findById(reseller._id).lean().exec();
    expect(creditQty(after, plan._id)).toBe(4);
  });

  it('never refunds a generation that actually succeeded (no free codes on a later failure)', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const reseller = await makeReseller('mintledger', plan._id, 3);
    currentReseller = reseller;

    // The codes are minted, then the ledger write fails → the request errors,
    // but the credit was genuinely spent and MUST NOT come back.
    mockLedgerFails = true;
    const res = await request(app)
      .post('/api/v1/reseller/codes/generate')
      .send({ planId: String(plan._id), quantity: 2 });
    mockLedgerFails = false;

    expect(res.status).toBe(500);
    expect(await ActivationCode.countDocuments({ resellerId: reseller._id })).toBe(2);
    const after = await Reseller.findById(reseller._id).lean().exec();
    expect(creditQty(after, plan._id)).toBe(1);
  });

  it('refunds the parent credit exactly once when creating a sub-reseller fails', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const parent = await makeReseller('parentroll', plan._id, 5);
    currentReseller = parent;

    const spy = jest.spyOn(Reseller, 'create').mockRejectedValueOnce(new Error('write failed'));
    const res = await request(app)
      .post('/api/v1/reseller/sub-resellers')
      .send({ name: 'فرعي فاشل', planId: String(plan._id), credit: 2 });
    spy.mockRestore();

    expect(res.status).toBe(500);
    // Exactly one refund: 5 → 3 (deducted) → 5, never 7.
    const after = await Reseller.findById(parent._id).lean().exec();
    expect(creditQty(after, plan._id)).toBe(5);
    expect(await Reseller.countDocuments({ parentResellerId: parent._id })).toBe(0);
  });

  it('does not refund the parent when the sub-reseller was actually created', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const parent = await makeReseller('parentsolid', plan._id, 5);
    currentReseller = parent;

    const res = await request(app)
      .post('/api/v1/reseller/sub-resellers')
      .send({ name: 'فرعي ناجح', username: 'subok1', password: 'Passw0rd!23', planId: String(plan._id), credit: 2 });

    expect(res.status).toBe(201);
    const after = await Reseller.findById(parent._id).lean().exec();
    expect(creditQty(after, plan._id)).toBe(3);
  });
});

describe('Reseller batch capability guards (صلاحيات الدفعات)', () => {
  beforeEach(() => {
    currentReseller = null;
  });

  async function makeBatchWithCodes(username: string, permissions?: Record<string, boolean>) {
    const plan = await makePlan();
    const reseller = await makeReseller(username, plan._id, 3, permissions ? { permissions } : {});
    const batch = await CodeBatch.create({
      resellerId: reseller._id,
      planId: plan._id,
      batchNumber: 1,
      quantity: 2,
      receiptDate: new Date(),
      notes: 'test',
      status: 'delivered',
    });
    await ActivationCode.create([
      {
        codeHash: `hash-${username}-1`,
        codeLast4: '1111',
        prefix: reseller.prefix,
        codeEnc: null,
        planId: plan._id,
        status: 'UNUSED',
        resellerId: reseller._id,
        batchId: batch._id,
        customerName: 'زبون تجريبي',
        customerPhone: '0555000000',
      },
      {
        codeHash: `hash-${username}-2`,
        codeLast4: '2222',
        prefix: reseller.prefix,
        codeEnc: null,
        planId: plan._id,
        status: 'UNUSED',
        resellerId: reseller._id,
        batchId: batch._id,
      },
    ]);
    return { reseller, batch, plan };
  }

  it('denies the plaintext code inventory without viewHistory', async () => {
    const app = buildApp();
    const { reseller, batch } = await makeBatchWithCodes('noview', { viewHistory: false, exportM3U: false });
    currentReseller = reseller;

    const denied = await request(app).get(`/api/v1/reseller/batches/${String(batch._id)}/codes`);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ success: false, code: 'PERMISSION_DENIED', permission: 'viewHistory' });

    // The same inventory is still available with the capability on.
    currentReseller = { ...reseller, permissions: { ...reseller.permissions, viewHistory: true } };
    const allowed = await request(app).get(`/api/v1/reseller/batches/${String(batch._id)}/codes`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toHaveLength(2);
  });

  it('denies the printable export without exportM3U', async () => {
    const app = buildApp();
    const { reseller, batch } = await makeBatchWithCodes('noexport', { viewHistory: false, exportM3U: false });
    currentReseller = reseller;

    const denied = await request(app).get(`/api/v1/reseller/batches/${String(batch._id)}/export`);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ success: false, code: 'PERMISSION_DENIED', permission: 'exportM3U' });

    currentReseller = { ...reseller, permissions: { ...reseller.permissions, exportM3U: true } };
    const allowed = await request(app).get(`/api/v1/reseller/batches/${String(batch._id)}/export`);
    expect(allowed.status).toBe(200);
  });

  it('keeps owner isolation for both endpoints', async () => {
    const app = buildApp();
    const { batch } = await makeBatchWithCodes('owner1');
    const stranger = await makeReseller('stranger1', new mongoose.Types.ObjectId(), 1);
    currentReseller = stranger;

    const codes = await request(app).get(`/api/v1/reseller/batches/${String(batch._id)}/codes`);
    expect(codes.status).toBe(404);
    const exp = await request(app).get(`/api/v1/reseller/batches/${String(batch._id)}/export`);
    expect(exp.status).toBe(404);
  });
});

describe('Transfer recipient enumeration (منع تعداد الموزعين)', () => {
  beforeEach(() => {
    currentReseller = null;
  });

  it('answers identically for an unknown username and an inactive shop', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const sender = await makeReseller('senderenum', plan._id, 5);
    await Reseller.create({
      name: 'محل مغلق',
      city: 'وهران',
      status: 'Inactive',
      username: 'closedshop',
      prefix: 'CLS',
      credit: [],
    });
    currentReseller = sender;

    const missing = await request(app)
      .post('/api/v1/reseller/transfers')
      .send({ toUsername: 'ghostshop', planId: String(plan._id), quantity: 1 });
    const inactive = await request(app)
      .post('/api/v1/reseller/transfers')
      .send({ toUsername: 'closedshop', planId: String(plan._id), quantity: 1 });

    expect(inactive.status).toBe(missing.status);
    expect(inactive.body).toEqual(missing.body);
    expect(JSON.stringify(inactive.body)).toBe(JSON.stringify(missing.body));

    // Neither refusal may touch the sender's credit.
    const after = await Reseller.findById(sender._id).lean().exec();
    expect(creditQty(after, plan._id)).toBe(5);
  });

  it('still transfers to an active shop', async () => {
    const app = buildApp();
    const plan = await makePlan();
    const sender = await makeReseller('senderok', plan._id, 5);
    const recipient = await makeReseller('receiverok', plan._id, 1);
    currentReseller = sender;

    const res = await request(app)
      .post('/api/v1/reseller/transfers')
      .send({ toUsername: 'receiverok', planId: String(plan._id), quantity: 2 });

    expect(res.status).toBe(201);
    const senderAfter = await Reseller.findById(sender._id).lean().exec();
    const recipientAfter = await Reseller.findById(recipient._id).lean().exec();
    expect(creditQty(senderAfter, plan._id)).toBe(3);
    expect(creditQty(recipientAfter, plan._id)).toBe(3);
  });
});
