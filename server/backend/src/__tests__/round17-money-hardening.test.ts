import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Plan from '../models/Plan';
import Reseller from '../models/Reseller';
import ActivationCode from '../models/ActivationCode';
import CodeBatch from '../models/CodeBatch';
import Subscription from '../models/Subscription';
import User from '../models/User';
import Notification from '../models/Notification';
import { redeemCode, returnUnusedCreditForReseller, expireStaleCodesAndReturnCredit } from '../services/subscription-service';
import { hashActivationCode, normalizeActivationCode } from '../utils/code-generator';

/* ------------------------------------------------------------------ */
/* Round 17 regression tests: money hardening + panel fixes.          */
/* ------------------------------------------------------------------ */

const RESELLER_ID = new mongoose.Types.ObjectId();
jest.mock('../middleware/requireReseller', () => {
  const requireReseller = (req: any, _res: any, next: any) => {
    req.reseller = { _id: RESELLER_ID, name: 'محل الاختبار', status: 'Active' };
    next();
  };
  return { requireReseller, requireResellerOrApiKeyForReads: requireReseller };
});

jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: new mongoose.Types.ObjectId().toString(), role: 'Admin' };
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

jest.mock('../services/fcm-service', () => ({
  sendNotificationToDevices: jest.fn().mockResolvedValue({ successCount: 0, failedTokens: 0, error: 'not configured' }),
  pushOutcome: jest.fn().mockReturnValue({ pushDelivered: false, reason: 'no-fcm' }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminRouter = require('../routes/admin');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminPlansRouter = require('../routes/admin-plans');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminSettingsRouter = require('../routes/admin-app-settings');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminNotificationsRouter = require('../routes/admin-notifications');

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

function settingsApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/app-settings', adminSettingsRouter);
  return app;
}

function notificationsApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/notifications', adminNotificationsRouter);
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Round 17 — atomic code redemption (no double subscription)', () => {
  beforeEach(async () => {
    await ActivationCode.deleteMany({});
    await Subscription.deleteMany({});
    await User.deleteMany({});
    await Plan.deleteMany({});
  });

  it('a code stuck in ACTIVATING (concurrent redeem in flight) is refused, no subscription minted', async () => {
    const plan = await makePlan();
    const user = await User.create({ username: 'customer1', password: 'password123', email: 'c1@example.com', channelListCode: 'c1', role: 'User' });
    // Simulate the loser of the atomic claim: another request already flipped the code.
    await ActivationCode.create({ prefix: 'DZHF', codeHash: hashActivationCode(normalizeActivationCode('DZHF-ACTIVATING-1111')), codeEnc: 'enc', codeLast4: '1111', planId: plan._id, status: 'ACTIVATING' });

    const result = await redeemCode(String(user._id), 'DZHF-ACTIVATING-1111');
    expect(result.success).toBe(false);
    expect((result as { code?: string }).code).toBe('CODE_ALREADY_USED');
    // No subscription may exist — the loser must not mint one.
    const subs = await Subscription.countDocuments({ userId: user._id });
    expect(subs).toBe(0);
  });

  it('a normal UNUSED redemption still works end-to-end', async () => {
    const plan = await makePlan();
    const user = await User.create({ username: 'customer2', password: 'password123', email: 'c2@example.com', channelListCode: 'c2', role: 'User' });
    const code = await ActivationCode.create({ prefix: 'DZHF', codeHash: hashActivationCode(normalizeActivationCode('DZHF-UNUSED-2222')), codeEnc: 'enc', codeLast4: '2222', planId: plan._id, status: 'UNUSED' });

    const result = await redeemCode(String(user._id), 'DZHF-UNUSED-2222');
    expect(result.success).toBe(true);
    expect(String((result as any).subscription.planId)).toBe(String(plan._id));
    const fresh = await ActivationCode.findById(code._id).lean().exec();
    expect(fresh!.status).toBe('ACTIVATED');
    expect(fresh!.activatedAt).toBeTruthy();
  });

  it('expireStaleCodesAndReturnCredit resets stale ACTIVATING codes back to UNUSED', async () => {
    const plan = await makePlan();
    const reseller = await Reseller.create({
      _id: RESELLER_ID,
      name: 'محل الاختبار',
      status: 'Active',
      credit: [{ planId: plan._id, quantity: 5 }],
      prices: [{ planId: plan._id, price: 1000 }],
    });
    const stuck = await ActivationCode.create({
      prefix: 'DZ', codeHash: 'h-stuck', codeEnc: 'enc', codeLast4: '3333', planId: plan._id,
      resellerId: reseller._id, status: 'ACTIVATING',
    });
    // Backdate updatedAt past the 15-min recovery window (timestamps:true
    // would otherwise overwrite it on save).
    await ActivationCode.updateOne({ _id: stuck._id }, { $set: { updatedAt: new Date(Date.now() - 30 * 60 * 1000) } }, { timestamps: false }).exec();

    const res = await expireStaleCodesAndReturnCredit();
    expect(res.expired).toBe(0); // not past expiry — just recovered

    const fresh = await ActivationCode.findOne({ codeHash: 'h-stuck' }).lean().exec();
    expect(fresh!.status).toBe('UNUSED');
  });
});

describe('Round 17 — credit return never revokes a concurrently-activated code', () => {
  beforeEach(async () => {
    await ActivationCode.deleteMany({});
    await Reseller.deleteMany({});
    await Plan.deleteMany({});
  });

  it('returnUnusedCreditForReseller revokes & credits only codes still UNUSED', async () => {
    const plan = await makePlan();
    const reseller = await Reseller.create({
      _id: RESELLER_ID,
      name: 'محل الاختبار',
      status: 'Active',
      credit: [{ planId: plan._id, quantity: 0 }],
      prices: [{ planId: plan._id, price: 1000 }],
    });
    // Two UNUSED codes + one that was ACTIVATED in the same instant.
    await ActivationCode.create({ prefix: 'DZ', codeHash: 'h-u1', codeEnc: 'enc', codeLast4: '4001', planId: plan._id, resellerId: reseller._id, status: 'UNUSED' });
    await ActivationCode.create({ prefix: 'DZ', codeHash: 'h-u2', codeEnc: 'enc', codeLast4: '4002', planId: plan._id, resellerId: reseller._id, status: 'UNUSED' });
    await ActivationCode.create({ prefix: 'DZ', codeHash: 'h-a1', codeEnc: 'enc', codeLast4: '4003', planId: plan._id, resellerId: reseller._id, status: 'ACTIVATED', activatedAt: new Date() });

    const res = await returnUnusedCreditForReseller(String(reseller._id), { note: 'استرجاع' });
    expect(res.ok).toBe(true);
    expect(res.revoked).toBe(2); // NOT 3 — the activated code survives
    expect(res.restored[0].quantity).toBe(2);

    const activated = await ActivationCode.findOne({ codeHash: 'h-a1' }).lean().exec();
    expect(activated!.status).toBe('ACTIVATED'); // untouched

    const fresh = await Reseller.findById(reseller._id).lean().exec();
    expect(fresh!.credit?.[0]?.quantity).toBe(2); // credit restored for 2, not 3
  });

  it('expireStaleCodesAndReturnCredit never expires or credits an ACTIVATED code', async () => {
    const plan = await makePlan();
    const reseller = await Reseller.create({
      _id: RESELLER_ID,
      name: 'محل الاختبار',
      status: 'Active',
      credit: [{ planId: plan._id, quantity: 0 }],
      prices: [{ planId: plan._id, price: 1000 }],
    });
    const past = new Date(Date.now() - 10 * DAY_MS);
    await ActivationCode.create({ prefix: 'DZ', codeHash: 'h-e1', codeEnc: 'enc', codeLast4: '5001', planId: plan._id, resellerId: reseller._id, status: 'UNUSED', codeExpiresAt: past });
    await ActivationCode.create({ prefix: 'DZ', codeHash: 'h-e2', codeEnc: 'enc', codeLast4: '5002', planId: plan._id, resellerId: reseller._id, status: 'ACTIVATED', activatedAt: past, codeExpiresAt: past });

    const res = await expireStaleCodesAndReturnCredit();
    expect(res.expired).toBe(1); // only the UNUSED one
    expect(res.creditReturned).toHaveLength(1);
    expect(res.creditReturned[0].quantity).toBe(1);

    const activated = await ActivationCode.findOne({ codeHash: 'h-e2' }).lean().exec();
    expect(activated!.status).toBe('ACTIVATED');
  });
});

describe('Round 17 — panel input validation & secret hygiene', () => {
  beforeEach(async () => {
    await Plan.deleteMany({});
    await ActivationCode.deleteMany({});
  });

  it('admin-plans rejects a negative price with 400 (POST and PATCH)', async () => {
    const createRes = await request(plansApp()).post('/admin/plans').send({ name: 'باقة', durationDays: 30, price: -500 });
    expect(createRes.status).toBe(400);

    const plan = await makePlan();
    const patchRes = await request(plansApp()).patch(`/admin/plans/${plan._id}`).send({ price: -1 });
    expect(patchRes.status).toBe(400);
  });

  it('admin-plans clamps an absurd pageSize instead of 500ing', async () => {
    const res = await request(plansApp()).get('/admin/plans?page=-1&pageSize=-5');
    expect(res.status).toBe(200);
  });

  it('admin channel delete with a malformed id returns 400, not 500', async () => {
    const res = await request(adminApp()).delete('/admin/channels/not-an-objectid');
    expect(res.status).toBe(400);
  });

  it('settings export never includes SMTP or Telegram secrets', async () => {
    const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
    await AppSetting.create({ key: 'brevo_user', value: 'smtp@example.com' });
    await AppSetting.create({ key: 'brevo_password', value: 'super-secret-pass' });
    await AppSetting.create({ key: 'alert_telegram_bot_token', value: 'telegram-secret-token' });

    const res = await request(settingsApp()).get('/admin/app-settings/export');
    expect(res.status).toBe(200);
    const payload = JSON.parse(res.text);
    expect(payload.settings.brevo_password).toBeUndefined();
    expect(payload.settings.alert_telegram_bot_token).toBeUndefined();
    expect(payload.settings.brevo_configured).toBe(true);
    expect(payload.settings.alert_telegram_configured).toBe(true);
  });

  it('settings PUT response never echoes the SMTP password', async () => {
    const res = await request(settingsApp()).put('/admin/app-settings').send({ brevo_password: 'new-secret' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('new-secret');
    expect(res.body.data.brevo_configured).toBe(true);
  });

  it('settings PUT never echoes Telegram secrets and validates webhook/email fields', async () => {
    const ok = await request(settingsApp()).put('/admin/app-settings').send({
      alert_telegram_bot_token: 'telegram-secret',
      alert_webhook_url: 'https://hooks.example.com/notify',
      mail_from: 'ops@example.com',
      brevo_user: 'smtp@example.com',
    });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toContain('telegram-secret');
    expect(ok.body.data.alert_telegram_configured).toBe(true);
    expect(ok.body.data.alert_webhook_url).toBe('https://hooks.example.com/notify');

    const badWebhook = await request(settingsApp()).put('/admin/app-settings').send({
      alert_webhook_url: 'javascript:alert(1)',
    });
    expect(badWebhook.status).toBe(400);
    expect(badWebhook.body.field).toBe('alert_webhook_url');

    const badEmail = await request(settingsApp()).put('/admin/app-settings').send({
      mail_from: 'not-an-email',
    });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.field).toBe('mail_from');
  });
});

describe('Round 17 — notification resend guard', () => {
  beforeEach(async () => {
    await Notification.deleteMany({});
  });

  it('re-sending an already-delivered notification returns 409', async () => {
    const n = await Notification.create({
      title: 'مرحبا',
      body: 'نص',
      audience: 'ALL',
      status: 'SENT',
      sentAt: new Date(),
      deliveryStats: { successCount: 5, failedTokens: 0, pushDelivered: true },
    });

    const res = await request(notificationsApp()).post(`/admin/notifications/${n._id}/send`);
    expect(res.status).toBe(409);
  });

  it('a SENT notification whose push failed can still be re-sent', async () => {
    const n = await Notification.create({
      title: 'مرحبا',
      body: 'نص',
      audience: 'ALL',
      status: 'SENT',
      sentAt: new Date(),
      deliveryStats: { successCount: 0, failedTokens: 0, pushDelivered: false, reason: 'no-fcm' },
    });

    const res = await request(notificationsApp()).post(`/admin/notifications/${n._id}/send`);
    expect(res.status).toBe(200);
  });
});
