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

// Redis and the scheduler are environmental dependencies of this endpoint. They are
// stubbed so each verdict (pass/warn/fail) can be asserted deterministically, and so
// requiring the scheduler service cannot start timers inside the test worker.
jest.mock('../services/redis', () => ({
  isRedisReady: () => (global as any).__redisReady === true,
  getRedisClient: () => ({
    ping: async () => {
      if ((global as any).__redisPingFails) throw new Error('redis is down');
      return 'PONG';
    },
  }),
}));

jest.mock('../services/scheduler-service', () => ({
  schedulerService: {
    getTasksWithStatus: async () => (global as any).__schedulerTasks || [],
  },
}));

// The release checks resolve through the same code path `/version` uses, which also
// consults the latest GitHub release. Both are stubbed so the suite stays hermetic and
// every source can be exercised deliberately: `githubDown()` reproduces a provider
// outage (the pre-existing database-only case), `githubUp()` reproduces production,
// where GitHub Releases is the source of truth and the table is empty.
jest.mock('axios');
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn(async () => ({ safe: true, resolvedAddresses: ['140.82.121.4'] })),
  createPinnedLookup: jest.fn(() => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const axios = require('axios');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const router = require('../routes/admin-diagnostics');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AppVersion = require('../models/AppVersion');

const axiosGet = axios.get as jest.Mock;

const GITHUB_APK_URL =
  'https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.5.0/dzhoof-tv-v1.5.0-official.apk';

/** Provider outage: only the database can supply a release, as before this change. */
function githubDown() {
  axiosGet.mockRejectedValue(new Error('github unavailable'));
}

/** A published GitHub release, with the `.sha256` asset the pipeline uploads next to it. */
function githubUp(sha256Body = `${SHA256}  dzhoof-tv-v1.5.0-official.apk\n`) {
  axiosGet.mockImplementation(async (url: unknown) => {
    const href = String(url);
    if (new URL(href).hostname === 'api.github.com') {
      return {
        status: 200,
        headers: {},
        data: {
          tag_name: 'v1.5.0',
          body: 'إصلاحات وتحسينات',
          published_at: '2026-09-19T13:18:41Z',
          assets: [
            { name: 'dzhoof-tv-v1.5.0-official.apk', size: 26905636, browser_download_url: GITHUB_APK_URL },
            { name: 'dzhoof-tv-v1.5.0-official.apk.sha256', browser_download_url: `${GITHUB_APK_URL}.sha256` },
          ],
        },
      };
    }
    return { status: 200, headers: {}, data: sha256Body };
  });
}

const APK_URL =
  'https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.4.2/dzhoof-tv-v1.4.2-official.apk';
const SHA256 = 'f0494df3f964b5f16ccb50be945e98cc25fa95a8fa187189c399a81a1b481e85';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/diagnostics', router);
  return app;
}

const app = buildApp();

function releaseDoc(overrides: Record<string, unknown> = {}) {
  return {
    versionName: '1.4.2',
    versionCode: 10402,
    apkFileName: 'dzhoof-tv-v1.4.2-official.apk',
    apkFileSize: 26840396,
    downloadUrl: APK_URL,
    sha256: SHA256,
    releaseChannel: 'stable',
    distribution: 'external_apk',
    isActive: true,
    ...overrides,
  };
}

function statusOf(body: any, id: string) {
  const entry = body.checks.find((item: any) => item.id === id);
  return entry ? entry.status : 'missing';
}

async function fetchDiagnostics() {
  const response = await request(app).get('/api/v1/admin/diagnostics');
  return response;
}

beforeEach(() => {
  (global as any).__mockAuthDeny = false;
  (global as any).__mockUserRole = 'Admin';
  (global as any).__redisReady = true;
  (global as any).__redisPingFails = false;
  (global as any).__schedulerTasks = [];
  githubDown();
  process.env.APP_VERSION = '1.4.2';
  process.env.RELEASE_COMMIT = 'd34db33fd34db33fd34db33fd34db33fd34db33f';
  process.env.RELEASE_BUILT_AT = '2026-09-13T10:00:00Z';
  delete process.env.DISABLE_SCHEDULER;
});

afterEach(() => {
  delete process.env.APP_VERSION;
  delete process.env.RELEASE_COMMIT;
  delete process.env.RELEASE_BUILT_AT;
  delete process.env.APP_UPDATE_ALLOWED_HOSTS;
});

describe('GET /api/v1/admin/diagnostics — access control', () => {
  it('rejects anonymous callers with 401', async () => {
    (global as any).__mockAuthDeny = true;
    const response = await fetchDiagnostics();
    expect(response.status).toBe(401);
  });

  it('rejects authenticated non-admins with 403', async () => {
    (global as any).__mockUserRole = 'User';
    const response = await fetchDiagnostics();
    expect(response.status).toBe(403);
  });
});

describe('GET /api/v1/admin/diagnostics — verdicts', () => {
  it('reports no failure when the release, storage and scheduler are healthy', async () => {
    await AppVersion.create(releaseDoc());
    (global as any).__schedulerTasks = [
      { name: 'epg', displayName: 'EPG', lastRun: { status: 'success' } },
    ];

    const response = await fetchDiagnostics();

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(statusOf(response.body, 'mongodb')).toBe('pass');
    expect(statusOf(response.body, 'redis')).toBe('pass');
    expect(statusOf(response.body, 'build_identity')).toBe('pass');
    expect(statusOf(response.body, 'release_published')).toBe('pass');
    expect(statusOf(response.body, 'release_artifact_complete')).toBe('pass');
    expect(statusOf(response.body, 'release_download_url')).toBe('pass');
    expect(statusOf(response.body, 'release_version_code')).toBe('pass');
    expect(statusOf(response.body, 'scheduler')).toBe('pass');
    expect(response.body.checks.some((item: any) => item.status === 'fail')).toBe(false);

    expect(response.body.server).toMatchObject({
      version: '1.4.2',
      commit: 'd34db33fd34db33fd34db33fd34db33fd34db33f',
    });
    expect(response.body.server.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(response.body.release).toMatchObject({
      versionName: '1.4.2',
      versionCode: 10402,
      releaseChannel: 'stable',
      distribution: 'external_apk',
      downloadUrlHost: 'github.com',
    });
    expect(response.body.release.sha256Preview).toBe('f0494df3f964…');
  });

  it('fails when no release is published', async () => {
    const response = await fetchDiagnostics();
    expect(statusOf(response.body, 'release_published')).toBe('fail');
    expect(response.body.overall).toBe('fail');
    expect(response.body.release.versionName).toBeNull();
  });

  it('fails when the published artifact is missing its checksum', async () => {
    await AppVersion.create(releaseDoc({ sha256: null }));
    const response = await fetchDiagnostics();
    expect(statusOf(response.body, 'release_artifact_complete')).toBe('fail');
    expect(response.body.overall).toBe('fail');
  });

  it('fails when the download host is not allowlisted', async () => {
    await AppVersion.create(releaseDoc({ downloadUrl: 'https://cdn.example-mirror.test/app.apk' }));
    const response = await fetchDiagnostics();
    expect(statusOf(response.body, 'release_download_url')).toBe('fail');
    expect(response.body.checks.find((item: any) => item.id === 'release_download_url').detail).toContain(
      'cdn.example-mirror.test'
    );
  });

  it('fails when the download URL is not HTTPS', async () => {
    await AppVersion.create(releaseDoc({ downloadUrl: 'http://github.com/app.apk' }));
    const response = await fetchDiagnostics();
    expect(statusOf(response.body, 'release_download_url')).toBe('fail');
  });

  it('warns when versionCode disagrees with versionName', async () => {
    await AppVersion.create(releaseDoc({ versionName: '1.4.2', versionCode: 10403 }));
    const response = await fetchDiagnostics();
    expect(statusOf(response.body, 'release_version_code')).toBe('warn');
    expect(response.body.overall).toBe('warn');
  });

  it('inspects the newest active release, ignoring inactive rows', async () => {
    await AppVersion.create(releaseDoc({ isActive: false, versionCode: 10400, versionName: '1.4.0' }));
    await AppVersion.create(releaseDoc());
    const response = await fetchDiagnostics();
    expect(response.body.release.versionCode).toBe(10402);
  });

  it('downgrades redis to a warning and fails a broken scheduler task', async () => {
    await AppVersion.create(releaseDoc());
    (global as any).__redisReady = false;
    (global as any).__schedulerTasks = [
      { name: 'epg', displayName: 'EPG', lastRun: { status: 'failed' } },
      { name: 'sync', displayName: 'Sync', lastRun: { status: 'success' } },
    ];

    const response = await fetchDiagnostics();

    expect(statusOf(response.body, 'redis')).toBe('warn');
    expect(statusOf(response.body, 'scheduler')).toBe('fail');
    expect(response.body.overall).toBe('fail');
  });

  it('warns when the scheduler is disabled in this process', async () => {
    await AppVersion.create(releaseDoc());
    process.env.DISABLE_SCHEDULER = 'true';
    const response = await fetchDiagnostics();
    expect(statusOf(response.body, 'scheduler')).toBe('warn');
  });

  it('reports degraded when the build identity is incomplete', async () => {
    await AppVersion.create(releaseDoc());
    delete process.env.RELEASE_COMMIT;
    const response = await fetchDiagnostics();
    expect(statusOf(response.body, 'build_identity')).toBe('warn');
  });
});

describe('GET /api/v1/admin/diagnostics — release source', () => {
  // Regression: production had 26 AppVersion rows, every one `isActive: false`, while
  // `/api/v1/app/version` advertised 1.3.10 straight from GitHub Releases. Diagnostics
  // read the table alone, so the whole panel reported `overall: fail` on an update path
  // that worked — a false negative loud enough to hide the real ones.
  it('passes when GitHub Releases is the only source and the table is empty', async () => {
    githubUp();

    const response = await fetchDiagnostics();

    expect(response.status).toBe(200);
    expect(statusOf(response.body, 'release_published')).toBe('pass');
    expect(statusOf(response.body, 'release_artifact_complete')).toBe('pass');
    expect(statusOf(response.body, 'release_download_url')).toBe('pass');
    expect(response.body.release.versionName).toBe('1.5.0');
    expect(response.body.release.versionCode).toBe(10500);
    expect(response.body.release.downloadUrlHost).toBe('github.com');
    expect(response.body.release.sha256Preview).toBe('f0494df3f964…');
    expect(response.body.checks.find((item: any) => item.id === 'release_published').detail).toContain(
      'GitHub Releases'
    );
  });

  it('fails when GitHub is unreachable and no release row is active', async () => {
    githubDown();

    const response = await fetchDiagnostics();

    expect(response.status).toBe(200);
    expect(statusOf(response.body, 'release_published')).toBe('fail');
    expect(response.body.release.versionName).toBeNull();
  });

  it('fails the artifact check when GitHub advertises no checksum', async () => {
    githubUp('   \n');

    const response = await fetchDiagnostics();

    expect(statusOf(response.body, 'release_published')).toBe('pass');
    expect(statusOf(response.body, 'release_artifact_complete')).toBe('fail');
    expect(response.body.overall).toBe('fail');
  });

  it('prefers the newer of the two sources', async () => {
    await AppVersion.create(releaseDoc({ isActive: true, versionCode: 10402, versionName: '1.4.2' }));
    githubUp();

    const response = await fetchDiagnostics();

    expect(response.body.release.versionName).toBe('1.5.0');
    expect(response.body.release.versionCode).toBe(10500);
  });
});

describe('GET /api/v1/admin/diagnostics — disclosures', () => {
  it('never returns a credential, a connection string or an environment value', async () => {
    process.env.MONGODB_URI = 'mongodb://user:sup3rsecret@db.internal:27017/dzhoof';
    process.env.APP_UPDATE_ALLOWED_HOSTS = 'github.com,updates.internal.example';
    try {
      await AppVersion.create(releaseDoc());
      const response = await fetchDiagnostics();
      const serialized = JSON.stringify(response.body);

      expect(serialized).not.toContain('sup3rsecret');
      expect(serialized).not.toContain('mongodb://');
      expect(serialized).not.toContain('db.internal');
      expect(serialized).not.toContain('MONGODB_URI');
      // The allowlist count is safe to report; its exact contents are not secrets but
      // are also not needed by the operator reading this page.
      expect(statusOf(response.body, 'update_allowlist')).toBe('pass');
    } finally {
      delete process.env.MONGODB_URI;
    }
  });
});
