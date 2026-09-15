/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import express from 'express';

// Auth is proven separately (see the 401/403 cases) by flipping global flags, so the
// route's own behaviour can be tested without minting real admin sessions.
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

// Redis is not available in the unit environment; the release cache is asserted
// through its own module surface so the route stays testable without a cache server.
jest.mock('../services/app-release-cache', () => ({
  ghReleaseCache: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
  invalidateReleaseCaches: jest.fn(async () => true),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const releaseCache = require('../services/app-release-cache');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const auditModule = require('../services/audit-log');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const router = require('../routes/admin-app-versions');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AppVersion = require('../models/AppVersion');

const audit = auditModule.audit as jest.Mock;

const APK_URL =
  'https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.4.2/dzhoof-tv-v1.4.2-official.apk';
const SHA256 = 'f0494df3f964b5f16ccb50be945e98cc25fa95a8fa187189c399a81a1b481e85';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/app-versions', router);
  return app;
}

function publishBody(overrides: Record<string, unknown> = {}) {
  return {
    versionName: '1.4.2',
    versionCode: 10402,
    apkFileName: 'dzhoof-tv-v1.4.2-official.apk',
    apkFileSize: 26840396,
    downloadUrl: APK_URL,
    releaseNotes: 'تحسين الثبات',
    sha256: SHA256,
    ...overrides,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  (global as any).__mockAuthDeny = false;
  (global as any).__mockUserRole = 'Admin';
  await AppVersion.deleteMany({});
});

describe('admin app-versions route — access control', () => {
  it('requires an authenticated admin', async () => {
    (global as any).__mockAuthDeny = true;

    const response = await request(buildApp()).get('/api/v1/admin/app-versions');

    expect(response.status).toBe(401);
  });

  it('rejects an authenticated non-admin user', async () => {
    (global as any).__mockUserRole = 'User';

    const response = await request(buildApp()).get('/api/v1/admin/app-versions');

    expect(response.status).toBe(403);
  });
});

describe('POST /api/v1/admin/app-versions', () => {
  it('publishes a version with provenance defaults and audits it', async () => {
    const response = await request(buildApp()).post('/api/v1/admin/app-versions').send(publishBody());

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        versionName: '1.4.2',
        versionCode: 10402,
        sha256: SHA256,
        releaseChannel: 'stable',
        distribution: 'external_apk',
        platforms: null,
        isActive: true,
        isMandatory: false,
        minCompatibleVersion: 1,
      }),
    );

    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        action: 'APP_VERSION_PUBLISH',
        resource: 'AppVersion',
        userId: 'admin-1',
      }),
    );
  });

  it('stores an explicit channel, distribution and platform scope', async () => {
    const response = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(
        publishBody({
          versionCode: 10500,
          versionName: '1.5.0',
          releaseChannel: 'beta',
          distribution: 'play',
          platforms: ['android-tv'],
        }),
      );

    expect(response.status).toBe(201);
    expect(response.body.data.releaseChannel).toBe('beta');
    expect(response.body.data.distribution).toBe('play');
    expect(response.body.data.platforms).toEqual(['android-tv']);
  });

  it('rejects an invalid checksum with a field-level error', async () => {
    const response = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(publishBody({ sha256: 'deadbeef' }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.details.some((d: any) => d.path === 'sha256')).toBe(true);
  });

  it('rejects an unknown channel, distribution or platform', async () => {
    const channel = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(publishBody({ releaseChannel: 'nightly' }));
    expect(channel.status).toBe(400);

    const distribution = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(publishBody({ distribution: 'sideload' }));
    expect(distribution.status).toBe(400);

    const platform = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(publishBody({ platforms: ['ios'] }));
    expect(platform.status).toBe(400);
  });

  it('rejects a non-HTTPS download URL', async () => {
    const response = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(publishBody({ downloadUrl: 'http://cdn.example.com/app.apk' }));

    expect(response.status).toBe(400);
    expect(response.body.details.some((d: any) => d.path === 'downloadUrl')).toBe(true);
  });

  it('refuses a duplicate versionCode', async () => {
    await request(buildApp()).post('/api/v1/admin/app-versions').send(publishBody());

    const duplicate = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(publishBody({ versionName: '1.4.3' }));

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.success).toBe(false);
  });
});

describe('GET /api/v1/admin/app-versions', () => {
  it('lists versions newest first with provenance fields', async () => {
    await AppVersion.create({
      versionName: '1.3.0',
      versionCode: 10300,
      apkFileName: 'a.apk',
      apkFileSize: 100,
      downloadUrl: APK_URL,
    });
    await AppVersion.create({
      versionName: '1.4.2',
      versionCode: 10402,
      apkFileName: 'b.apk',
      apkFileSize: 200,
      downloadUrl: APK_URL,
      releaseChannel: 'beta',
      sha256: SHA256,
    });

    const response = await request(buildApp()).get('/api/v1/admin/app-versions');

    expect(response.status).toBe(200);
    expect(response.body.data.map((v: any) => v.versionCode)).toEqual([10402, 10300]);
    expect(response.body.data[0]).toEqual(
      expect.objectContaining({ releaseChannel: 'beta', sha256: SHA256, distribution: 'external_apk' }),
    );
    // A legacy row with no stored channel still reports the effective value.
    expect(response.body.data[1].releaseChannel).toBe('stable');
  });
});

describe('PATCH /api/v1/admin/app-versions/:id', () => {
  it('updates mutable metadata and audits before/after', async () => {
    const created = await AppVersion.create({
      versionName: '1.4.2',
      versionCode: 10402,
      apkFileName: 'b.apk',
      apkFileSize: 200,
      downloadUrl: APK_URL,
    });

    const response = await request(buildApp())
      .patch(`/api/v1/admin/app-versions/${created._id}`)
      .send({ releaseChannel: 'beta', isMandatory: true, releaseNotes: 'عاجل', platforms: ['android-tv'] });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        releaseChannel: 'beta',
        isMandatory: true,
        releaseNotes: 'عاجل',
        platforms: ['android-tv'],
      }),
    );

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = audit.mock.calls[0][0];
    expect(entry.action).toBe('APP_VERSION_UPDATE');
    expect(entry.changes.before.releaseChannel).toBe('stable');
    expect(entry.changes.after.releaseChannel).toBe('beta');
  });

  it('clears the platform scope when given an empty list', async () => {
    const created = await AppVersion.create({
      versionName: '1.4.2',
      versionCode: 10402,
      apkFileName: 'b.apk',
      apkFileSize: 200,
      downloadUrl: APK_URL,
      platforms: ['android-tv'],
    });

    const response = await request(buildApp())
      .patch(`/api/v1/admin/app-versions/${created._id}`)
      .send({ platforms: [] });

    expect(response.status).toBe(200);
    expect(response.body.data.platforms).toBeNull();
  });

  it('refuses to re-point the artifact identity of a published version', async () => {
    const created = await AppVersion.create({
      versionName: '1.4.2',
      versionCode: 10402,
      apkFileName: 'b.apk',
      apkFileSize: 200,
      downloadUrl: APK_URL,
    });

    for (const patch of [
      { versionCode: 10403 },
      { versionName: '1.4.3' },
      { downloadUrl: 'https://evil.example.com/app.apk' },
      { sha256: SHA256 },
      { apkFileSize: 999 },
      { apkFileName: 'other.apk' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const response = await request(buildApp())
        .patch(`/api/v1/admin/app-versions/${created._id}`)
        .send(patch);
      expect(response.status).toBe(400);
    }

    const unchanged = await AppVersion.findById(created._id).lean();
    expect(unchanged.downloadUrl).toBe(APK_URL);
    expect(unchanged.sha256).toBeNull();
  });

  it('rejects an unknown or malformed id', async () => {
    const malformed = await request(buildApp())
      .patch('/api/v1/admin/app-versions/not-an-id')
      .send({ isMandatory: true });
    expect(malformed.status).toBe(400);

    const missing = await request(buildApp())
      .patch('/api/v1/admin/app-versions/507f1f77bcf86cd799439011')
      .send({ isMandatory: true });
    expect(missing.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Publish gate: an active release must carry a verifiable checksum
//
// GET /api/v1/app/version withholds an update it cannot verify, and the Android
// client refuses a null checksum outright. Publishing an active row without one
// therefore shipped a release no device would ever install.
// ---------------------------------------------------------------------------
describe('admin app-versions route — checksum publish gate', () => {
  it('refuses to publish an active version without a checksum', async () => {
    const response = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(publishBody({ sha256: null }));

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('APP_VERSION_CHECKSUM_REQUIRED');
    expect(audit).not.toHaveBeenCalled();
    expect(await AppVersion.countDocuments()).toBe(0);
  });

  it('refuses to publish an active version with an invalid checksum', async () => {
    const response = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(publishBody({ sha256: 'deadbeef' }));

    expect(response.status).toBe(400);
    expect(await AppVersion.countDocuments()).toBe(0);
  });

  it('allows a checksum-less draft as long as it is inactive', async () => {
    const response = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(publishBody({ sha256: null, isActive: false }));

    expect(response.status).toBe(201);
    expect(response.body.data.isActive).toBe(false);
    expect(response.body.data.sha256).toBeNull();
  });

  it('refuses to activate a version that has no checksum', async () => {
    const created = await AppVersion.create({
      versionName: '1.4.2',
      versionCode: 10402,
      apkFileName: 'b.apk',
      apkFileSize: 200,
      downloadUrl: APK_URL,
      isActive: false,
    });

    const response = await request(buildApp())
      .patch(`/api/v1/admin/app-versions/${created._id}`)
      .send({ isActive: true });

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('APP_VERSION_CHECKSUM_REQUIRED');

    const stored = await AppVersion.findById(created._id).lean();
    expect(stored?.isActive).toBe(false);
  });

  it('allows activating a version that carries a checksum', async () => {
    const created = await AppVersion.create({
      versionName: '1.4.2',
      versionCode: 10402,
      apkFileName: 'b.apk',
      apkFileSize: 200,
      downloadUrl: APK_URL,
      sha256: SHA256,
      isActive: false,
    });

    const response = await request(buildApp())
      .patch(`/api/v1/admin/app-versions/${created._id}`)
      .send({ isActive: true });

    expect(response.status).toBe(200);
    expect(response.body.data.isActive).toBe(true);
  });

  it('refuses to activate a legacy row that never had the isActive field set', async () => {
    // A row inserted by a script/migration rather than through this API has no
    // `isActive` field at all — it is not served today, so activating it must clear the
    // same gate (the check is `!== true`, not `=== false`).
    const created = await AppVersion.create({
      versionName: '1.1.0',
      versionCode: 10100,
      apkFileName: 'legacy.apk',
      apkFileSize: 200,
      downloadUrl: APK_URL,
      isActive: true,
    });
    await AppVersion.collection.updateOne({ _id: created._id }, { $unset: { isActive: '' } });

    const response = await request(buildApp())
      .patch(`/api/v1/admin/app-versions/${created._id}`)
      .send({ isActive: true });

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('APP_VERSION_CHECKSUM_REQUIRED');
  });

  it('stores an uppercase checksum lowercase instead of failing later', async () => {
    const response = await request(buildApp())
      .post('/api/v1/admin/app-versions')
      .send(publishBody({ versionName: '1.6.0', versionCode: 10600, sha256: SHA256.toUpperCase() }));

    expect(response.status).toBe(201);
    expect(response.body.data.sha256).toBe(SHA256);
  });

  it('still lets an operator edit a legacy active row that has no checksum', async () => {
    // Production carries such rows (AppVersion 1.2.2). Refusing an unrelated edit
    // would lock the operator out of fixing release notes.
    const created = await AppVersion.create({
      versionName: '1.2.2',
      versionCode: 10202,
      apkFileName: 'old.apk',
      apkFileSize: 200,
      downloadUrl: APK_URL,
      isActive: true,
    });

    const response = await request(buildApp())
      .patch(`/api/v1/admin/app-versions/${created._id}`)
      .send({ releaseNotes: 'ملاحظات مصحّحة' });

    expect(response.status).toBe(200);
    expect(response.body.data.releaseNotes).toBe('ملاحظات مصحّحة');
  });
});

describe('POST /cache/invalidate', () => {
  const invalidate = releaseCache.invalidateReleaseCaches as jest.Mock;

  beforeEach(() => {
    invalidate.mockClear();
  });

  it('drops the cached release lookup so the next check re-reads GitHub', async () => {
    const response = await request(buildApp()).post('/api/v1/admin/app-versions/cache/invalidate');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, invalidated: ['ghrel:latest'] });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('audits the invalidation', async () => {
    audit.mockClear();

    await request(buildApp()).post('/api/v1/admin/app-versions/cache/invalidate');

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APP_VERSION_CACHE_INVALIDATE' }),
    );
  });

  it('refuses an unauthenticated caller', async () => {
    (global as any).__mockAuthDeny = true;
    try {
      const response = await request(buildApp()).post('/api/v1/admin/app-versions/cache/invalidate');

      expect(response.status).toBe(401);
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      delete (global as any).__mockAuthDeny;
    }
  });

  it('refuses a non-admin caller', async () => {
    (global as any).__mockUserRole = 'User';
    try {
      const response = await request(buildApp()).post('/api/v1/admin/app-versions/cache/invalidate');

      expect(response.status).toBe(403);
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      delete (global as any).__mockUserRole;
    }
  });

  it('reports a failure instead of pretending the cache was cleared', async () => {
    invalidate.mockRejectedValueOnce(new Error('redis down'));

    const response = await request(buildApp()).post('/api/v1/admin/app-versions/cache/invalidate');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
  });
});
