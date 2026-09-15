/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';

jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if ((global as any).__mockAuthDeny) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = { id: 'admin-1', role: (global as any).__mockUserRole || 'Admin' };
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Forbidden - Admin access required' });
    }
    next();
  },
}));

jest.mock('../services/audit-log', () => ({
  audit: jest.fn(),
  reqCtx: () => ({ userId: 'admin-1', ipAddress: '127.0.0.1' }),
  redactSensitiveText: (value: unknown) => String(value),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const auditModule = require('../services/audit-log');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const router = require('../routes/admin-error-reports');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ProblemReport = require('../models/ProblemReport');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CrashReport = require('../models/CrashReport');

const audit = auditModule.audit as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/error-reports', router);
  return app;
}

async function seedProblem(overrides: Record<string, unknown> = {}) {
  return ProblemReport.create({
    reportId: `DZR-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    message: 'القناة لا تعمل عند فتحها',
    errorCode: 'PLAYBACK_FAILED',
    feature: 'player',
    appVersion: '1.3.1',
    appVersionCode: 10301,
    deviceId: 'dz-0018a80af2a8f852',
    deviceModel: 'SM-A057G',
    status: 'new',
    ...overrides,
  });
}

async function seedCrash(overrides: Record<string, unknown> = {}) {
  return CrashReport.create({
    deviceId: 'dz-0018a80af2a8f852',
    appVersion: '1.0.48',
    appVersionCode: 10048,
    exceptionType: 'java.lang.IllegalArgumentException',
    exceptionMessage: 'Only VectorDrawables and rasterized asset types are supported',
    stackTrace: 'at s6.d.m0(SourceFile:1506)',
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete (global as any).__mockAuthDeny;
  delete (global as any).__mockUserRole;
});

describe('GET /api/v1/admin/error-reports', () => {
  // The automatic crash reports were write-only until this view existed: `POST
  // /app/crash-report` had stored five real production crashes that nothing could read.
  it('shows customer reports and captured crashes in one list, newest first', async () => {
    await seedCrash({ createdAt: new Date('2026-09-12T16:46:11Z') });
    await seedProblem({ createdAt: new Date('2026-09-15T10:00:00Z') });

    const response = await request(buildApp()).get('/api/v1/admin/error-reports');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].kind).toBe('problem');
    expect(response.body.data[0].reportId).toMatch(/^DZR-/);
    expect(response.body.data[1].kind).toBe('crash');
    expect(response.body.data[1].reportId).toMatch(/^CR-/);
  });

  it('carries the version, device, screen and feature every report must be triaged by', async () => {
    await seedProblem();

    const response = await request(buildApp()).get('/api/v1/admin/error-reports');

    expect(response.body.data[0]).toEqual(
      expect.objectContaining({
        appVersion: '1.3.1',
        appVersionCode: 10301,
        deviceId: 'dz-0018a80af2a8f852',
        deviceModel: 'SM-A057G',
        feature: 'player',
        errorCode: 'PLAYBACK_FAILED',
        status: 'new',
      }),
    );
  });

  it('groups repeated failures so a spike is visible without reading each report', async () => {
    await seedProblem({ deviceId: 'dz-a' });
    await seedProblem({ deviceId: 'dz-b' });
    await seedProblem({ deviceId: 'dz-c', errorCode: 'UPDATE_CHECKSUM_REQUIRED' });

    const response = await request(buildApp()).get('/api/v1/admin/error-reports');

    const group = response.body.groups.find(
      (entry: any) => entry.errorCode === 'PLAYBACK_FAILED',
    );
    expect(group.count).toBe(2);
    // Distinct devices, not just report count: two devices is a pattern, one device
    // retrying is not.
    expect(group.deviceCount).toBe(2);
    expect(response.body.statusCounts.new).toBe(3);
  });

  it('filters by error code, feature, version, device and correlation id', async () => {
    await seedProblem({ errorCode: 'PLAYBACK_FAILED', correlationId: 'corr-1' });
    await seedProblem({
      errorCode: 'UPDATE_CHECKSUM_REQUIRED',
      feature: 'update',
      appVersionCode: 10301,
      deviceId: 'dz-other',
    });

    const byCode = await request(buildApp()).get(
      '/api/v1/admin/error-reports?errorCode=UPDATE_CHECKSUM_REQUIRED',
    );
    expect(byCode.body.data).toHaveLength(1);
    expect(byCode.body.data[0].feature).toBe('update');

    const byFeature = await request(buildApp()).get('/api/v1/admin/error-reports?feature=player');
    expect(byFeature.body.data).toHaveLength(1);

    const byVersion = await request(buildApp()).get(
      '/api/v1/admin/error-reports?appVersionCode=10301',
    );
    expect(byVersion.body.data).toHaveLength(2);

    const byDevice = await request(buildApp()).get(
      '/api/v1/admin/error-reports?deviceId=dz-other',
    );
    expect(byDevice.body.data).toHaveLength(1);

    const byCorrelation = await request(buildApp()).get(
      '/api/v1/admin/error-reports?correlationId=corr-1',
    );
    expect(byCorrelation.body.data).toHaveLength(1);
  });

  it('restricts the list to one kind on request', async () => {
    await seedProblem();
    await seedCrash();

    const problems = await request(buildApp()).get('/api/v1/admin/error-reports?kind=problem');
    expect(problems.body.data).toHaveLength(1);
    expect(problems.body.data[0].kind).toBe('problem');

    const crashes = await request(buildApp()).get('/api/v1/admin/error-reports?kind=crash');
    expect(crashes.body.data).toHaveLength(1);
    expect(crashes.body.data[0].kind).toBe('crash');
  });

  it('bounds the page size', async () => {
    await seedProblem({ deviceId: 'a' });
    await seedProblem({ deviceId: 'b' });
    await seedProblem({ deviceId: 'c' });

    const response = await request(buildApp()).get('/api/v1/admin/error-reports?limit=2');
    expect(response.body.data).toHaveLength(2);

    // An absurd limit is clamped, never honoured.
    const huge = await request(buildApp()).get('/api/v1/admin/error-reports?limit=100000');
    expect(huge.body.data.length).toBeLessThanOrEqual(200);
  });

  it('refuses a non-admin caller', async () => {
    (global as any).__mockUserRole = 'User';
    const response = await request(buildApp()).get('/api/v1/admin/error-reports');
    expect(response.status).toBe(403);
  });
});

describe('GET /api/v1/admin/error-reports/:id', () => {
  it('returns one customer report', async () => {
    const created = await seedProblem();

    const response = await request(buildApp())
      .get(`/api/v1/admin/error-reports/${created._id}?kind=problem`);

    expect(response.status).toBe(200);
    expect(response.body.data.reportId).toBe(created.reportId);
  });

  it('returns one captured crash with its stack trace', async () => {
    const created = await seedCrash();

    const response = await request(buildApp())
      .get(`/api/v1/admin/error-reports/${created._id}?kind=crash`);

    expect(response.status).toBe(200);
    expect(response.body.data.diagnostics.stackTrace).toContain('SourceFile:1506');
  });

  it('rejects a malformed id and reports a missing one', async () => {
    const malformed = await request(buildApp()).get('/api/v1/admin/error-reports/not-an-id');
    expect(malformed.status).toBe(400);

    const missing = await request(buildApp())
      .get(`/api/v1/admin/error-reports/${new mongoose.Types.ObjectId()}`);
    expect(missing.status).toBe(404);
  });
});

describe('PATCH /api/v1/admin/error-reports/:id', () => {
  it('moves a report through triage and records the fix version', async () => {
    const created = await seedProblem();

    const response = await request(buildApp())
      .patch(`/api/v1/admin/error-reports/${created._id}`)
      .send({ status: 'resolved', adminNotes: 'أُصلح في 1.3.2', resolvedInVersion: '1.3.2' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('resolved');
    expect(response.body.data.resolvedInVersion).toBe('1.3.2');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROBLEM_REPORT_UPDATE' }),
    );
  });

  it('rejects an unknown status instead of storing it', async () => {
    const created = await seedProblem();

    const response = await request(buildApp())
      .patch(`/api/v1/admin/error-reports/${created._id}`)
      .send({ status: 'solved' });

    expect(response.status).toBe(400);
  });

  it('rejects an empty update', async () => {
    const created = await seedProblem();

    const response = await request(buildApp())
      .patch(`/api/v1/admin/error-reports/${created._id}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it('clears the notes when they are emptied', async () => {
    const created = await seedProblem({ adminNotes: 'ملاحظة قديمة' });

    const response = await request(buildApp())
      .patch(`/api/v1/admin/error-reports/${created._id}`)
      .send({ adminNotes: '   ' });

    expect(response.status).toBe(200);
    expect(response.body.data.adminNotes).toBeNull();
  });
});
