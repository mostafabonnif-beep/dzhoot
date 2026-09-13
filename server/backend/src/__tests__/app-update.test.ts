/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import express from 'express';

jest.mock('axios');
jest.mock('../routes/config', () => ({ resolvePublicDemoCode: jest.fn() }));
jest.mock('../models/AppVersion', () => ({ findOne: jest.fn(), find: jest.fn() }));
jest.mock('../models/CrashReport', () => ({ create: jest.fn() }));
// Keep the suite hermetic: the SSRF guard is exercised by its own tests, here we
// only assert that the route consults it before every hop.
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn(async () => ({ safe: true, resolvedAddresses: ['140.82.121.4'] })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const axios = require('axios');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AppVersion = require('../models/AppVersion');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validateUrlForSSRF } = require('../utils/ssrf-guard');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const router = require('../routes/app-update');

const {
  normalizeVersion,
  compareVersions,
  versionNameToCode,
  getCanonicalDownloadUrl,
  isStaleLocalDownloadUrl,
  publicDownloadUrl,
  normalizeSha256,
  splitReleaseNotes,
  isAllowedDownloadUrl,
  pickLatestVersion,
} = router._private;

const axiosGet = axios.get as jest.Mock;
const dbFindOne = AppVersion.findOne as jest.Mock;

const APK_URL =
  'https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.4.2/dzhoof-tv-v1.4.2-official.apk';
const SHA256_URL = `${APK_URL}.sha256`;
const SHA256 = 'f0494df3f964b5f16ccb50be945e98cc25fa95a8fa187189c399a81a1b481e85';

function dbVersion(overrides: Record<string, unknown> = {}) {
  return {
    versionName: '1.4.2',
    versionCode: 10402,
    apkFileName: 'dzhoof-tv-v1.4.2-official.apk',
    apkFileSize: 123456789,
    downloadUrl: APK_URL,
    releaseNotes: 'تحسين الثبات\nإصلاح مشكلة التشغيل',
    isActive: true,
    isMandatory: false,
    minCompatibleVersion: 10000,
    releasedAt: new Date('2026-09-13T00:00:00Z'),
    ...overrides,
  };
}

function githubRelease(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.4.2',
    body: 'تحسين الثبات\nإصلاح مشكلة التشغيل',
    published_at: '2026-09-13T00:00:00Z',
    assets: [
      { name: 'dzhoof-tv-v1.4.2-official.apk', size: 123456789, browser_download_url: APK_URL },
      { name: 'dzhoof-tv-v1.4.2-official.apk.sha256', browser_download_url: SHA256_URL },
    ],
    ...overrides,
  };
}

function withDb(doc: unknown) {
  dbFindOne.mockReturnValue({ sort: () => ({ lean: async () => doc }) });
}

function isGithubApiUrl(url: unknown): boolean {
  try {
    return new URL(String(url)).hostname === 'api.github.com';
  } catch {
    return false;
  }
}

function githubDown() {
  axiosGet.mockRejectedValue(new Error('github unavailable'));
}

function githubUp(release: unknown = githubRelease(), sha256Body = `${SHA256}  apk\n`) {
  axiosGet.mockImplementation(async (url: unknown) => {
    if (isGithubApiUrl(url)) {
      return { status: 200, headers: {}, data: release };
    }
    return { status: 200, headers: {}, data: sha256Body };
  });
}

function buildApp(appRouter: unknown = router) {
  const app = express();
  app.use('/api/v1/app', appRouter as express.Router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_UPDATE_ALLOWED_HOSTS;
  withDb(null);
  githubDown();
});

describe('app update version helpers', () => {
  it('normalizes release tags and prerelease suffixes', () => {
    expect(normalizeVersion('v1.0.5-staging')).toBe('1.0.5');
  });

  it('maps semantic releases to the Android versionCode scale', () => {
    expect(versionNameToCode('1.0.5')).toBe(10005);
    expect(versionNameToCode('v2.3.17')).toBe(20317);
  });

  it('orders semantic versions without treating only the major number as a code', () => {
    expect(compareVersions('1.0.5', '1.0.4')).toBeGreaterThan(0);
    expect(versionNameToCode('1.0.5')).toBeGreaterThan(10004);
  });

  it('accepts only 64-hex checksums', () => {
    expect(normalizeSha256(SHA256)).toBe(SHA256);
    expect(normalizeSha256(`${SHA256.toUpperCase()}  file.apk`)).toBe(SHA256);
    expect(normalizeSha256('not-a-checksum')).toBeNull();
    expect(normalizeSha256(undefined)).toBeNull();
  });

  it('splits release notes into a bounded list and keeps them clean', () => {
    expect(splitReleaseNotes('- one\n* two\n\n  three  ')).toEqual(['one', 'two', 'three']);
    expect(splitReleaseNotes('')).toEqual([]);
    expect(splitReleaseNotes(Array.from({ length: 25 }, (_, i) => `line ${i}`))).toHaveLength(20);
  });
});

describe('app download URL helpers', () => {
  const request = {
    get: (header: string) => (header === 'host' ? 'iptv.ld-11.net' : undefined),
    protocol: 'https',
  };

  it('uses the HTTPS public API redirect as the canonical download URL', () => {
    expect(getCanonicalDownloadUrl(request)).toBe('https://iptv.ld-11.net/api/v1/app/download');
  });

  it('replaces stale local download paths with the canonical redirect', () => {
    process.env.PUBLIC_BASE_URL = 'https://iptv.ld-11.net/';
    expect(isStaleLocalDownloadUrl(request, 'https://iptv.ld-11.net/downloads/dzhoof-tv-1.0.42.apk')).toBe(true);
    expect(publicDownloadUrl(request, 'https://iptv.ld-11.net/downloads/dzhoof-tv-1.0.42.apk')).toBe(
      'https://iptv.ld-11.net/api/v1/app/download',
    );
    expect(publicDownloadUrl(request, APK_URL)).toContain('github.com/');
    delete process.env.PUBLIC_BASE_URL;
  });

  it('allowlists HTTPS hosts only', () => {
    expect(isAllowedDownloadUrl(APK_URL)).toBe(true);
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/x.apk')).toBe(true);
    expect(isAllowedDownloadUrl('http://github.com/x.apk')).toBe(false);
    expect(isAllowedDownloadUrl('https://evil.example.com/x.apk')).toBe(false);
    expect(isAllowedDownloadUrl('https://127.0.0.1/x.apk')).toBe(false);
    expect(isAllowedDownloadUrl('')).toBe(false);
  });

  it('honors APP_UPDATE_ALLOWED_HOSTS and PUBLIC_BASE_URL hosts', () => {
    process.env.PUBLIC_BASE_URL = 'https://cdn.dzhoof.example/';
    process.env.APP_UPDATE_ALLOWED_HOSTS = 'mirror.example.com';
    expect(isAllowedDownloadUrl('https://cdn.dzhoof.example/app.apk')).toBe(true);
    expect(isAllowedDownloadUrl('https://mirror.example.com/app.apk')).toBe(true);
    expect(isAllowedDownloadUrl('https://other.example.com/app.apk')).toBe(false);
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.APP_UPDATE_ALLOWED_HOSTS;
  });
});

describe('pickLatestVersion', () => {
  const stable = { versionCode: 10400, releaseChannel: 'stable', platforms: null };
  const beta = { versionCode: 10500, releaseChannel: 'beta', platforms: null };

  it('filters by channel and picks the highest version code', () => {
    expect(pickLatestVersion([stable, beta], { channel: 'stable' })).toBe(stable);
    expect(pickLatestVersion([stable, beta], { channel: 'beta' })).toBe(beta);
  });

  it('ignores channel/platform when not requested', () => {
    expect(pickLatestVersion([stable, beta])).toBe(beta);
  });

  it('respects a per-version platform scope when present', () => {
    const tvOnly = { versionCode: 10400, releaseChannel: 'stable', platforms: ['android-tv'] };
    expect(pickLatestVersion([tvOnly], { platform: 'android-tv' })).toBe(tvOnly);
    expect(pickLatestVersion([tvOnly], { platform: 'android' })).toBeNull();
  });
});

describe('GET /api/v1/app/version contract', () => {
  it('requires a current version', async () => {
    const response = await request(buildApp()).get('/api/v1/app/version');

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Current version is required',
        errorCode: 'UPDATE_METADATA_INVALID',
        userMessageKey: 'errors.update.update_metadata_invalid',
        retryable: false,
      }),
    );
  });

  it('rejects a non-numeric or fractional version code', async () => {
    const bad = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=abc');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Invalid version code');

    const fractional = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=1.5');
    expect(fractional.status).toBe(400);
  });

  it('keeps the legacy currentVersion parameter working', async () => {
    withDb(dbVersion({ versionCode: 10300, versionName: '1.3.0' }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersion=10300');

    expect(response.status).toBe(200);
    expect(response.body.currentVersionCode).toBe(10300);
    expect(response.body.currentVersion).toBe(10300);
    expect(response.body.updateAvailable).toBe(false);
  });

  it('returns the documented latestVersion shape for an optional update', async () => {
    withDb(dbVersion());

    const response = await request(buildApp()).get(
      '/api/v1/app/version?currentVersionCode=10300&channel=stable&platform=android-tv',
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.mandatory).toBe(false);
    expect(response.body.currentVersionCode).toBe(10300);

    const latest = response.body.latestVersion;
    expect(latest).toEqual(
      expect.objectContaining({
        versionName: '1.4.2',
        versionCode: 10402,
        minimumSupportedVersionCode: 10000,
        releaseChannel: 'stable',
        distribution: 'external_apk',
        downloadUrl: APK_URL,
        sizeBytes: 123456789,
        publishedAt: '2026-09-13T00:00:00.000Z',
      }),
    );
    expect(latest.releaseNotesList).toEqual(['تحسين الثبات', 'إصلاح مشكلة التشغيل']);
    // Legacy keys/types the shipped AppUpdater reads must not change.
    expect(latest.releaseNotes).toBe('تحسين الثبات\nإصلاح مشكلة التشغيل');
    expect(latest.apkFileSize).toBe(123456789);
    expect(response.body.isMandatory).toBe(false);
    expect(response.body.source).toBe('db');
  });

  it('reports no update when the device is current', async () => {
    withDb(dbVersion({ versionCode: 10300, versionName: '1.3.0' }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.mandatory).toBe(false);
  });

  it('marks an update mandatory below minimumSupportedVersionCode', async () => {
    withDb(dbVersion({ versionCode: 10400, minCompatibleVersion: 10300 }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10200');

    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.mandatory).toBe(true);
    expect(response.body.latestVersion.minimumSupportedVersionCode).toBe(10300);
  });

  it('blocks a downgrade when the device is newer than the published release', async () => {
    withDb(dbVersion({ versionCode: 10400, minCompatibleVersion: 10000 }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10500');

    expect(response.status).toBe(200);
    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.mandatory).toBe(false);
  });

  it('does not offer a stable release to a beta client', async () => {
    withDb(dbVersion({ versionCode: 10400 }));

    const response = await request(buildApp()).get(
      '/api/v1/app/version?currentVersionCode=10300&channel=beta',
    );

    expect(response.status).toBe(200);
    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.latestVersion).toBeNull();
  });

  it('drops a non-HTTPS download URL', async () => {
    withDb(dbVersion({ downloadUrl: 'http://cdn.example.com/app.apk' }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.downloadUrl).toBeNull();
    expect(response.body.downloadUrl).toBeNull();
  });

  it('drops a download URL on an untrusted domain', async () => {
    withDb(dbVersion({ downloadUrl: 'https://evil.example.com/app.apk' }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.downloadUrl).toBeNull();
  });

  it('rewrites a stale local download path to the canonical HTTPS redirect', async () => {
    process.env.PUBLIC_BASE_URL = 'https://iptv.ld-11.net/';
    withDb(dbVersion({ downloadUrl: 'https://iptv.ld-11.net/downloads/dzhoof-tv-1.0.42.apk' }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.downloadUrl).toBe(
      'https://iptv.ld-11.net/api/v1/app/download',
    );
  });

  it('allows the API request host when PUBLIC_BASE_URL is not configured', async () => {
    withDb(dbVersion({ downloadUrl: 'https://iptv.ld-11.net/downloads/dzhoof-tv-1.0.42.apk' }));
    const app = express();
    app.set('trust proxy', 1);
    app.use('/api/v1/app', router);

    const response = await request(app)
      .get('/api/v1/app/version?currentVersionCode=10300')
      .set('X-Forwarded-Proto', 'https')
      .set('Host', 'iptv.ld-11.net');

    expect(response.body.latestVersion.downloadUrl).toBe(
      'https://iptv.ld-11.net/api/v1/app/download',
    );
  });
});

describe('GET /api/v1/app/version GitHub source', () => {
  it('serves the GitHub release with its published SHA-256', async () => {
    githubUp();

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.status).toBe(200);
    expect(response.body.source).toBe('github');
    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion).toEqual(
      expect.objectContaining({
        versionName: '1.4.2',
        versionCode: 10402,
        sizeBytes: 123456789,
        sha256: SHA256,
      }),
    );
    expect(response.body.latestVersion.releaseNotesList).toEqual([
      'تحسين الثبات',
      'إصلاح مشكلة التشغيل',
    ]);
    expect(validateUrlForSSRF).toHaveBeenCalled();
  });

  it('omits the checksum when the .sha256 asset is malformed', async () => {
    githubUp(githubRelease(), 'not-a-checksum\n');

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.status).toBe(200);
    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion.sha256).toBeNull();
  });

  it('refuses a checksum redirect to an untrusted host', async () => {
    axiosGet.mockImplementation(async (url: unknown) => {
      if (isGithubApiUrl(url)) {
        return { status: 200, headers: {}, data: githubRelease() };
      }
      return {
        status: 302,
        headers: { location: 'https://evil.example.com/steal.sha256' },
        data: '',
      };
    });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.sha256).toBeNull();
  });

  it('survives invalid release metadata without a 5xx', async () => {
    githubUp(githubRelease({ tag_name: 'not-a-version' }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.status).toBe(200);
    expect(response.body.updateAvailable).toBe(false);
  });

  it('returns no release when the latest GitHub release has no APK asset', async () => {
    githubUp(githubRelease({ assets: [] }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.status).toBe(200);
    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.latestVersion).toBeNull();
  });

  it('fails closed with 500 when every release source is unavailable', async () => {
    withDb(null);
    githubDown();

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.status).toBe(500);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        errorCode: 'UPDATE_CHECK_NETWORK',
        userMessageKey: 'errors.update.update_check_network',
        retryable: true,
      }),
    );
  });
});

describe('GET /api/v1/app/version rate limiting', () => {
  it('returns 429 once the configured budget is exhausted', async () => {
    process.env.APP_UPDATE_RATE_LIMIT_MAX = '3';
    try {
      let isolatedRouter: any;
      let isolatedAppVersion: any;
      let isolatedAxios: any;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        isolatedRouter = require('../routes/app-update');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        isolatedAppVersion = require('../models/AppVersion');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        isolatedAxios = require('axios');
      });

      isolatedAppVersion.findOne.mockReturnValue({
        sort: () => ({
          lean: async () => dbVersion({ versionCode: 10300, minCompatibleVersion: 10000 }),
        }),
      });
      isolatedAxios.get.mockRejectedValue(new Error('github unavailable'));

      const app = buildApp(isolatedRouter);
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const response = await request(app).get('/api/v1/app/version?currentVersionCode=10300');
        statuses.push(response.status);
      }

      expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
      expect(statuses[3]).toBe(429);
    } finally {
      delete process.env.APP_UPDATE_RATE_LIMIT_MAX;
    }
  });
});
