import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Plan from '../models/Plan';
import Reseller from '../models/Reseller';
import CodeBatch from '../models/CodeBatch';

/* ------------------------------------------------------------------ */
/* Admin code-batch delivery numbering: two admins delivering to the   */
/* same shop concurrently must not produce a 500.                      */
/* ------------------------------------------------------------------ */

jest.mock('../routes/auth', () => ({
  requireAuth: (req: { user?: { id: string; role: string } }, _res: unknown, next: () => void) => {
    req.user = { id: new mongoose.Types.ObjectId().toString(), role: 'Admin' };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../services/subscription-service', () => ({
  getCodeExpiryDays: jest.fn(async () => 30),
  generateCodes: jest.fn(async () => ({ ok: true, codes: ['DZHF-TEST-0001'], count: 1 })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminCodeBatchesRouter = require('../routes/admin-code-batches');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const subscriptionService = require('../services/subscription-service');

function batchesApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/code-batches', adminCodeBatchesRouter);
  return app;
}

async function makeShopAndPlan() {
  const reseller = await Reseller.create({ name: 'محل الاختبار', city: 'الجزائر', status: 'Active' });
  const plan = await Plan.create({
    name: 'شهري',
    durationDays: 30,
    price: 500,
    currency: 'DZD',
    maxDevices: 1,
    maxConcurrentStreams: 1,
    status: 'Active',
  });
  return { reseller, plan };
}

describe('admin code-batches — batch number collision handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionService.getCodeExpiryDays.mockResolvedValue(30);
    subscriptionService.generateCodes.mockResolvedValue({ ok: true, codes: ['DZHF-TEST-0001'], count: 1 });
  });

  it('retries with the next batchNumber when the insert hits the unique index (E11000)', async () => {
    const { reseller, plan } = await makeShopAndPlan();
    // دفعة 1 already exists, so the route computes 2 — and the mocked first
    // insert simulates a concurrent admin having just taken 2.
    await CodeBatch.create({
      resellerId: reseller._id,
      planId: plan._id,
      batchNumber: 1,
      quantity: 1,
      receiptDate: new Date(),
      status: 'delivered',
    });

    const createSpy = jest.spyOn(CodeBatch, 'create') as unknown as jest.SpyInstance;
    createSpy.mockImplementationOnce(() => {
      const err = new Error('E11000 duplicate key error collection: codebatches');
      (err as Error & { code?: number }).code = 11000;
      return Promise.reject(err);
    });

    const res = await request(batchesApp())
      .post('/admin/code-batches')
      .send({ resellerId: String(reseller._id), planId: String(plan._id), quantity: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data.batch.batchNumber).toBe(3);
    expect(res.body.data.codes).toEqual(['DZHF-TEST-0001']);

    const batches = await CodeBatch.find({ resellerId: reseller._id }).sort({ batchNumber: 1 }).lean();
    expect(batches.map((b) => b.batchNumber)).toEqual([1, 3]);
  });

  it('still returns 500 for an unrelated insert failure (no masking)', async () => {
    const { reseller, plan } = await makeShopAndPlan();

    const createSpy = jest.spyOn(CodeBatch, 'create') as unknown as jest.SpyInstance;
    createSpy.mockImplementationOnce(() => Promise.reject(new Error('connection lost')));

    const res = await request(batchesApp())
      .post('/admin/code-batches')
      .send({ resellerId: String(reseller._id), planId: String(plan._id), quantity: 1 });

    expect(res.status).toBe(500);
    expect(await CodeBatch.countDocuments({ resellerId: reseller._id })).toBe(0);
  });

  it('two concurrent deliveries to the same shop both succeed with distinct batch numbers', async () => {
    const { reseller, plan } = await makeShopAndPlan();

    const body = { resellerId: String(reseller._id), planId: String(plan._id), quantity: 1 };
    const app = batchesApp();
    const [first, second] = await Promise.all([
      request(app).post('/admin/code-batches').send(body),
      request(app).post('/admin/code-batches').send(body),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const batches = await CodeBatch.find({ resellerId: reseller._id }).sort({ batchNumber: 1 }).lean();
    expect(batches.map((b) => b.batchNumber)).toEqual([1, 2]);
  });
});
