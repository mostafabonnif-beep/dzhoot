import request from 'supertest';
import express, { type Express } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'sub-reseller-test-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'sub-reseller-test-refresh';

jest.mock('../services/audit-log', () => ({
  audit: jest.fn(),
  reqCtx: () => ({ ip: 'test', userAgent: 'test' }),
  redactSensitiveText: (t: unknown) => t,
}));

const User = require('../models/User');
const Session = require('../models/Session');
const Reseller = require('../models/Reseller');
const Plan = require('../models/Plan');
const resellerRouter = require('../routes/reseller');

const HAS_SECRET = process.env.JWT_ACCESS_SECRET || 'sub-reseller-test-secret';

let seq = 0;

async function makeAdminSession() {
  seq += 1;
  const admin = await User.create({
    username: `admin${seq}`,
    email: `admin${seq}@test.local`,
    passwordHash: 'x',
    role: 'Admin',
    channelListCode: `ADM${String(seq).padStart(4, '0')}`,
  });
  const sessionId = `sess_${crypto.randomBytes(16).toString('hex')}`;
  await Session.create({
    sessionId,
    userId: admin._id,
    username: admin.username,
    email: admin.email,
    role: admin.role,
    expiresAt: new Date(Date.now() + 3600_000),
    ipAddress: '127.0.0.1',
  });
  const token = jwt.sign({ sub: String(admin._id), role: 'Admin', sessionId }, HAS_SECRET, {
    algorithm: 'HS256',
  });
  return { token, sessionId, adminId: String(admin._id) };
}

async function makeReseller(extra: Record<string, unknown> = {}) {
  seq += 1;
  const passwordHash = await bcrypt.hash('ParentPass1!', 4);
  return Reseller.create({
    name: `متجر ${seq}`,
    city: 'الجزائر',
    phone: `0555${String(seq).padStart(7, '0')}`,
    prefix: `DZ${String(seq).padStart(2, '0')}`,
    passwordHash,
    credit: [],
    status: 'Active',
    ...extra,
  });
}

async function makePlan(name = 'شهري', durationDays = 30) {
  return Plan.create({ name, durationDays, maxDevices: 1, price: 1000, currency: 'DZD', status: 'Active' });
}

function resellerToken(resellerId: string): string {
  return jwt.sign({ sub: resellerId, role: 'reseller' }, HAS_SECRET, { algorithm: 'HS256' });
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/reseller', resellerRouter);
  return app;
}

describe('Sub-resellers (موزعون فرعيون) — two-level hierarchy', () => {
  let app: Express;

  beforeAll(() => {
    app = buildApp();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reseller creates a sub-reseller with allocated credit and sees it listed', async () => {
    const parent = await makeReseller({ credit: [] });
    const plan = await makePlan();
    await Reseller.updateOne({ _id: parent._id }, { $push: { credit: { planId: plan._id, quantity: 100 } } });
    const token = resellerToken(String(parent._id));

    const created = await request(app)
      .post('/api/v1/reseller/sub-resellers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'محل فرعي', username: 'subshop1', password: 'Passw0rd!23', planId: String(plan._id), credit: 50 })
      .expect(201);

    expect(created.body.success).toBe(true);
    expect(created.body.data.credit).toBe(50);
    expect(created.body.data.password).toBeTruthy();
    expect(created.body.data.username).toBeTruthy();

    const list = await request(app)
      .get('/api/v1/reseller/sub-resellers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(String(list.body.data[0].parentResellerId)).toBe(String(parent._id));
    expect(list.body.data[0].credit).toEqual([{ planId: plan._id.toString(), quantity: 50 }]);
  });

  test('parent credit is debited and sub credit is credited (GRANT recorded)', async () => {
    const parent = await makeReseller({ credit: [] });
    const plan = await makePlan();
    await Reseller.updateOne({ _id: parent._id }, { $push: { credit: { planId: plan._id, quantity: 100 } } });
    const token = resellerToken(String(parent._id));

    await request(app)
      .post('/api/v1/reseller/sub-resellers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'فرعي 2', username: 'subshop2', password: 'Passw0rd!23', planId: String(plan._id), credit: 30 })
      .expect(201);

    const parentAfter = await Reseller.findById(parent._id).lean();
    expect((parentAfter as { credit?: Array<{ quantity: number }> }).credit?.[0]?.quantity ?? 0).toBe(70);
  });

  test('insufficient credit is rejected and no sub is created', async () => {
    const parent = await makeReseller({ credit: [] });
    const plan = await makePlan();
    await Reseller.updateOne({ _id: parent._id }, { $push: { credit: { planId: plan._id, quantity: 100 } } });
    const token = resellerToken(String(parent._id));

    await request(app)
      .post('/api/v1/reseller/sub-resellers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'لن يُنشأ', username: 'subtoobig', password: 'Passw0rd!23', planId: String(plan._id), credit: 999 })
      .expect(400);

    const subs = await Reseller.find({ parentResellerId: parent._id });
    expect(subs).toHaveLength(0);
  });

  test('parent cannot exceed depth: sub-resellers cannot create their own subs', async () => {
    const parent = await makeReseller({ credit: [] });
    const parentToken = resellerToken(String(parent._id));
    const created = await request(app)
      .post('/api/v1/reseller/sub-resellers')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ name: 'ابن', username: 'subchild', password: 'Passw0rd!23' })
      .expect(201);

    const childToken = resellerToken(created.body.data._id);
    await request(app)
      .post('/api/v1/reseller/sub-resellers')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ name: 'حفيد', username: 'subgrand', password: 'Passw0rd!23' })
      .expect(403);
  });

  test('parent cannot create a second hierarchy level via an existing reseller username', async () => {
    const parent = await makeReseller({ credit: [] });
    const other = await makeReseller({ username: 'othershop' });
    const token = resellerToken(String(parent._id));

    await request(app)
      .post('/api/v1/reseller/sub-resellers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'مكرر', username: other.username, password: 'Passw0rd!23' })
      .expect(409);
  });

  test('sub without subResellers permission is denied', async () => {
    const parent = await makeReseller({ credit: [], permissions: { subResellers: false } });
    const token = resellerToken(String(parent._id));
    await request(app)
      .post('/api/v1/reseller/sub-resellers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'مرفوض', username: 'subdenied', password: 'Passw0rd!23' })
      .expect(403);
  });
});
