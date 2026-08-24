import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Plan from '../models/Plan';
import ActivationCode from '../models/ActivationCode';
import Subscription from '../models/Subscription';
import Reseller from '../models/Reseller';

jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-id', role: 'Admin' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../middleware/requireAdmin', () => ({
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminRouter = require('../routes/admin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
}

describe('GET /admin/business/summary', () => {
  it('returns activation, revenue, subscription and credit aggregates', async () => {
    const planA = await Plan.create({ name: 'شهري', durationDays: 30, price: 500, currency: 'DZD', maxDevices: 1, maxConcurrentStreams: 1 });
    const planB = await Plan.create({ name: 'سنوي', durationDays: 365, price: 5000, currency: 'DZD', maxDevices: 2, maxConcurrentStreams: 2 });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    await ActivationCode.create([
      // 3 activations this month on planA → 3 × 500 = 1500
      { prefix: 'DZ', codeHash: 'h1', codeEnc: 'enc', codeLast4: '0001', planId: planA._id, status: 'ACTIVATED', activatedAt: new Date(monthStart.getTime() + 1000) },
      { prefix: 'DZ', codeHash: 'h2', codeEnc: 'enc', codeLast4: '0002', planId: planA._id, status: 'ACTIVATED', activatedAt: new Date(monthStart.getTime() + 2000) },
      { prefix: 'DZ', codeHash: 'h3', codeEnc: 'enc', codeLast4: '0003', planId: planA._id, status: 'ACTIVATED', activatedAt: new Date(monthStart.getTime() + 3000) },
      // 1 activation this month on planB → 5000 (total this month 6500)
      { prefix: 'DZ', codeHash: 'h4', codeEnc: 'enc', codeLast4: '0004', planId: planB._id, status: 'ACTIVATED', activatedAt: new Date(monthStart.getTime() + 4000) },
      // 1 activation last month on planA → not in this-month count, still in totals
      { prefix: 'DZ', codeHash: 'h5', codeEnc: 'enc', codeLast4: '0005', planId: planA._id, status: 'ACTIVATED', activatedAt: lastMonth },
      // unactivated code — never counted
      { prefix: 'DZ', codeHash: 'h6', codeEnc: 'enc', codeLast4: '0006', planId: planA._id, status: 'UNUSED', activatedAt: null },
    ]);

    await Subscription.create([
      { userId: new mongoose.Types.ObjectId(), planId: planA._id, status: 'ACTIVE', startsAt: new Date(now.getTime() - 86400000), expiresAt: new Date(now.getTime() + 86400000) },
      { userId: new mongoose.Types.ObjectId(), planId: planB._id, status: 'ACTIVE', startsAt: new Date(now.getTime() - 86400000), expiresAt: new Date(now.getTime() + 86400000) },
      { userId: new mongoose.Types.ObjectId(), planId: planA._id, status: 'EXPIRED', startsAt: new Date(now.getTime() - 2 * 86400000), expiresAt: new Date(now.getTime() - 86400000) },
    ]);

    await Reseller.create([
      { name: 'محل نشط', city: 'الجزائر', status: 'Active', credit: [{ planId: planA._id, quantity: 10 }, { planId: planB._id, quantity: 2 }] },
      { name: 'محل معطّل', city: 'وهران', status: 'Inactive', credit: [{ planId: planA._id, quantity: 99 }] },
    ]);

    const response = await request(buildApp()).get('/admin/business/summary');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const { summary, byPlanThisMonth, byPlanTotal, creditByPlan, recentActivations } = response.body.data;

    expect(summary.activatedThisMonth).toBe(4);
    expect(summary.activatedTotal).toBe(5);
    expect(summary.revenueThisMonth).toBe(6500);
    expect(summary.revenueTotal).toBe(7000); // 1500×... = 4×500 + 5000 = 7000
    expect(summary.activeSubscriptions).toBe(2);
    expect(summary.activeResellers).toBe(1);
    expect(summary.creditRemaining).toBe(12); // only the active reseller counts
    expect(summary.pricesSet).toBe(true);

    const monthA = byPlanThisMonth.find((r: any) => String(r.planId) === String(planA._id));
    expect(monthA.count).toBe(3);
    expect(monthA.revenue).toBe(1500);

    const creditA = creditByPlan.find((r: any) => String(r.planId) === String(planA._id));
    expect(creditA.quantity).toBe(10);

    // Recent activations expose masked codes only
    expect(recentActivations.length).toBe(5);
    for (const a of recentActivations) {
      expect(a.code).toMatch(/^DZ-••••-/);
      expect(a.code).not.toContain('enc');
    }
  });

  it('reports pricesSet=false and zero revenue when all plans are free', async () => {
    const plan = await Plan.create({ name: 'مجاني', durationDays: 7, price: 0, maxDevices: 1, maxConcurrentStreams: 1 });
    await ActivationCode.create({
      prefix: 'DZ', codeHash: 'h7', codeEnc: 'enc', codeLast4: '1000', planId: plan._id, status: 'ACTIVATED',
      activatedAt: new Date(new Date().getFullYear(), new Date().getMonth(), 2),
    });

    const response = await request(buildApp()).get('/admin/business/summary');

    expect(response.status).toBe(200);
    expect(response.body.data.summary.pricesSet).toBe(false);
    expect(response.body.data.summary.revenueThisMonth).toBe(0);
    expect(response.body.data.summary.activatedThisMonth).toBe(1);
  });
});
