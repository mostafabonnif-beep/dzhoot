import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Plan from '../models/Plan';
import Reseller from '../models/Reseller';
import ActivationCode from '../models/ActivationCode';
import CodeBatch from '../models/CodeBatch';
import Notification from '../models/Notification';
import { hashActivationCode, normalizeActivationCode } from '../utils/code-generator';

/* ------------------------------------------------------------------ */
/* Round 19 regression tests: panel hardening + accounting accuracy.   */
/* ------------------------------------------------------------------ */

const RESELLER_ID = new mongoose.Types.ObjectId();

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

jest.mock('../services/scheduler-service', () => ({
  schedulerService: {
    getRuns: jest.fn(async ({ page, pageSize }: { page: number; pageSize: number }) => ({
      data: [],
      totalCount: 0,
      page,
      pageSize,
    })),
    getRunById: jest.fn(async () => null),
    executeTask: jest.fn(async () => ({ status: 'completed' })),
    getTasks: jest.fn(async () => []),
  },
  setTaskEnabled: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminRouter = require('../routes/admin');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminSettingsRouter = require('../routes/admin-app-settings');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminNotificationsRouter = require('../routes/admin-notifications');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminActivationCodesRouter = require('../routes/admin-activation-codes');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminCodeBatchesRouter = require('../routes/admin-code-batches');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const schedulerRouter = require('../routes/scheduler');

function adminApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
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

function codesApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/activation-codes', adminActivationCodesRouter);
  return app;
}

function batchesApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/code-batches', adminCodeBatchesRouter);
  return app;
}

function schedulerApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/scheduler', schedulerRouter);
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

describe('Round 19 — stale-code expiry actually runs on read paths', () => {
  beforeEach(async () => {
    await ActivationCode.deleteMany({});
    await Plan.deleteMany({});
  });

  it('listing codes flips an expired UNUSED code to EXPIRED', async () => {
    const plan = await makePlan();
    const plain = 'DZ-TEST-EXPIRED-0001';
    await ActivationCode.create({
      prefix: 'DZ',
      codeHash: hashActivationCode(normalizeActivationCode(plain)),
      codeEnc: 'enc',
      codeLast4: '0001',
      planId: plan._id,
      resellerId: RESELLER_ID,
      status: 'UNUSED',
      codeExpiresAt: new Date(Date.now() - 60 * 1000), // expired a minute ago
    });

    // First call primes the throttle, second call (after priming window) performs expiry.
    await request(codesApp()).get('/admin/activation-codes');
    const res = await request(codesApp()).get('/admin/activation-codes?status=EXPIRED');
    expect(res.status).toBe(200);
    const stillUnused = await ActivationCode.findOne({ status: 'UNUSED' }).lean();
    expect(stillUnused).toBeNull();
  });
});

describe('Round 19 — settings import never leaks the SMTP password', () => {
  beforeEach(async () => {
    const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
    await AppSetting.deleteMany({});
  });

  it('POST /import stores but never echoes SMTP or Telegram secrets', async () => {
    const res = await request(settingsApp())
      .post('/admin/app-settings/import')
      .send({ settings: {
        brevo_user: 'smtp@example.com',
        brevo_password: 'import-secret',
        alert_telegram_bot_token: 'telegram-import-secret',
      } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('import-secret');
    expect(JSON.stringify(res.body)).not.toContain('telegram-import-secret');
    expect(res.body.data.brevo_configured).toBe(true);
    expect(res.body.data.alert_telegram_configured).toBe(true);
    expect(res.body.data.brevo_user).toBe('smtp@example.com');

    const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
    const stored = await AppSetting.findOne({ key: 'brevo_password' }).lean();
    const telegramStored = await AppSetting.findOne({ key: 'alert_telegram_bot_token' }).lean();
    expect(stored?.value).toBe('import-secret');
    expect(telegramStored?.value).toBe('telegram-import-secret');
  });

  it('POST /import rejects invalid webhook and invalid emails', async () => {
    const badWebhook = await request(settingsApp())
      .post('/admin/app-settings/import')
      .send({ settings: { alert_webhook_url: 'ftp://bad.example.com/hook' } });
    expect(badWebhook.status).toBe(400);
    expect(badWebhook.body.field).toBe('alert_webhook_url');

    const badBrevoUser = await request(settingsApp())
      .post('/admin/app-settings/import')
      .send({ settings: { brevo_user: 'bad-email' } });
    expect(badBrevoUser.status).toBe(400);
    expect(badBrevoUser.body.field).toBe('brevo_user');
  });
});

describe('Round 19 — code-batches list includes wholesale price', () => {
  beforeEach(async () => {
    await CodeBatch.deleteMany({});
    await Reseller.deleteMany({});
    await Plan.deleteMany({});
  });

  it('wholesalePrice resolves from the reseller price list', async () => {
    const plan = await makePlan();
    const reseller = await Reseller.create({
      _id: RESELLER_ID,
      name: 'محل الجملة',
      username: `shop-${Date.now()}`,
      password: 'hashed-pass',
      creditBalance: 0,
      status: 'Active',
      prices: [{ planId: plan._id, price: 350 }],
    });
    await CodeBatch.create({
      resellerId: reseller._id,
      planId: plan._id,
      batchNumber: 1,
      quantity: 10,
      status: 'delivered',
      createdBy: new mongoose.Types.ObjectId(),
    });

    const res = await request(batchesApp()).get('/admin/code-batches');
    expect(res.status).toBe(200);
    const row = (res.body.data || []).find((b: any) => String(b.resellerId) === String(reseller._id));
    expect(row).toBeTruthy();
    expect(row.wholesalePrice).toBe(350);
  });
});

describe('Round 19 — business summary excludes self-generated batches from deliveries', () => {
  beforeEach(async () => {
    await CodeBatch.deleteMany({});
    await Reseller.deleteMany({});
    await Plan.deleteMany({});
  });

  it('self-generated reseller batches are not counted as wholesale deliveries', async () => {
    const plan = await makePlan({ price: 0 });
    const reseller = await Reseller.create({
      _id: RESELLER_ID,
      name: 'محل ذاتي',
      username: `self-${Date.now()}`,
      password: 'hashed-pass',
      creditBalance: 0,
      status: 'Active',
      prices: [{ planId: plan._id, price: 400 }],
    });
    // Self-generated batch (createdBy unset) — would falsely add 10×400=4000 to revenue
    await CodeBatch.create({
      resellerId: reseller._id,
      planId: plan._id,
      batchNumber: 1,
      quantity: 10,
      receiptDate: new Date(),
      notes: 'توليد ذاتي من بوابة الموزعين',
      status: 'delivered',
    });

    const res = await request(adminApp()).get('/admin/business/summary');
    expect(res.status).toBe(200);
    // No GRANT purchases, no operator activations, and the only batch is
    // self-generated → operator revenue must be exactly 0 (was 4000 before
    // the fix, because the self-generated batch was counted as a delivery).
    expect(res.body.data.summary.revenueTotal).toBe(0);
    expect(res.body.data.summary.revenueThisMonth).toBe(0);
  });
});

describe('Round 19 — notification send is atomically claimed', () => {
  beforeEach(async () => {
    await Notification.deleteMany({});
  });

  it('a due SCHEDULED notification (dispatcher owns it) cannot be sent manually', async () => {
    const n = await Notification.create({
      title: 'مجدول',
      body: 'نص',
      audience: 'ALL',
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60 * 1000), // due → dispatcher will pick it
    });
    const res = await request(notificationsApp()).post(`/admin/notifications/${n._id}/send`);
    expect(res.status).toBe(409);
  });

  it('a future SCHEDULED notification can still be sent manually', async () => {
    const n = await Notification.create({
      title: 'مجدول مستقبلا',
      body: 'نص',
      audience: 'ALL',
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await request(notificationsApp()).post(`/admin/notifications/${n._id}/send`);
    expect(res.status).toBe(200);
  });

  it('concurrent sends: only one claim wins', async () => {
    const n = await Notification.create({ title: 'مسودة', body: 'نص', audience: 'ALL', status: 'DRAFT' });
    const [r1, r2] = await Promise.all([
      request(notificationsApp()).post(`/admin/notifications/${n._id}/send`),
      request(notificationsApp()).post(`/admin/notifications/${n._id}/send`),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('POST / rejects an invalid scheduledAt and caps title/body length', async () => {
    const bad = await request(notificationsApp())
      .post('/admin/notifications')
      .send({ title: 'عنوان', body: 'نص', scheduledAt: 'not-a-date' });
    expect(bad.status).toBe(400);

    const long = await request(notificationsApp())
      .post('/admin/notifications')
      .send({ title: 'x'.repeat(500), body: 'y'.repeat(5000) });
    expect(long.status).toBe(201);
    const stored = await Notification.findById(long.body.data._id).lean();
    expect(stored?.title.length).toBeLessThanOrEqual(200);
    expect(stored?.body.length).toBeLessThanOrEqual(2000);
  });
});

describe('Round 19 — scheduler routes input hardening', () => {
  it('clamps negative/huge pagination instead of erroring', async () => {
    const res = await request(schedulerApp()).get('/admin/scheduler/runs?page=-3&pageSize=1000000');
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(200);
  });

  it('GET /runs/:id with malformed id returns 400, not 500', async () => {
    const res = await request(schedulerApp()).get('/admin/scheduler/runs/not-an-objectid');
    expect(res.status).toBe(400);
  });
});


