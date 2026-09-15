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
  // The checksum fetch pins the address the guard resolved (no rebinding window), so
  // the mock must expose the same surface as the real module.
  createPinnedLookup: jest.fn(() => undefined),
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
  isCanonicalRedirectUrl,
  servesCanonicalRedirect,
  publicDownloadUrl,
  normalizeSha256,
  splitReleaseNotes,
  isAllowedDownloadUrl,
  pickLatestVersion,
  requireChecksumFromEnv,
  pickManifestAsset,
  parseReleaseManifest,
  validateManifestAgainstAsset,
  checksumCacheKey,
  GITHUB_ASSET_HOSTS,
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
    // A row published through the admin API always carries a checksum now
    // (admin-app-versions publish gate); the route withholds one that does not.
    sha256: SHA256,
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
  delete process.env.APP_MIN_SUPPORTED_VERSION_CODE;
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

  it('allowlists every host GitHub actually redirects a release asset to', () => {
    // Regression: GitHub answers 302 from github.com to
    // release-assets.githubusercontent.com. That host was missing, so every
    // checksum fetch died on the second hop and the API served `sha256: null`
    // for a release that had a perfectly good `.sha256` asset (production,
    // 2026-09-15). The suite did not catch it because the checksum helpers were
    // mocked without the redirect. Keep this list in sync with
    // `curl -sI <asset url>`.
    expect(GITHUB_ASSET_HOSTS).toContain('github.com');
    expect(GITHUB_ASSET_HOSTS).toContain('release-assets.githubusercontent.com');
    expect(isAllowedDownloadUrl('https://release-assets.githubusercontent.com/x.apk')).toBe(true);
    expect(isAllowedDownloadUrl('https://release-assets.githubusercontent.com/gh/o?token=abc')).toBe(true);
    expect(isAllowedDownloadUrl('https://notgithub.example.com/x.apk')).toBe(false);
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

  it('withholds a stale local download path whose checksum cannot be bound to the redirected bytes', async () => {
    // `/downloads/*` rows are rewritten to the canonical `/api/v1/app/download`
    // redirect, which always serves the *newest GitHub release* — not this row's
    // artifact. The row's own sha256 therefore describes bytes the device will not
    // receive, so advertising it would hand out an install that fails on device.
    // The rewrite itself is still applied (asserted via the public helper below); the
    // release is withheld instead of advertised with a wrong checksum.
    process.env.PUBLIC_BASE_URL = 'https://iptv.ld-11.net/';
    withDb(dbVersion({ downloadUrl: 'https://iptv.ld-11.net/downloads/dzhoof-tv-1.0.42.apk' }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.updateBlockedReason).toBe('CHECKSUM_UNAVAILABLE');
    expect(response.body.latestVersion.sha256).toBeNull();
    // The metadata survives so a device can still report which build is published.
    expect(response.body.latestVersion.versionCode).toBe(10402);
    expect(response.body.latestVersion.downloadUrl).toBeNull();

    // The rewrite rule itself is unchanged.
    expect(
      publicDownloadUrl(
        { get: () => 'iptv.ld-11.net', protocol: 'https' },
        'https://iptv.ld-11.net/downloads/dzhoof-tv-1.0.42.apk',
      ),
    ).toBe('https://iptv.ld-11.net/api/v1/app/download');
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

    // The request host is still accepted as a valid redirect target (not blocked by the
    // allowlist); the row is withheld for its unverifiable checksum, not for its host.
    expect(response.body.latestVersion.downloadUrl).toBeNull();
    expect(response.body.updateBlockedReason).toBe('CHECKSUM_UNAVAILABLE');
    expect(
      isCanonicalRedirectUrl(
        { get: () => 'iptv.ld-11.net' },
        'https://iptv.ld-11.net/downloads/dzhoof-tv-1.0.42.apk',
      ),
    ).toBe(false);
    expect(
      servesCanonicalRedirect(
        { get: () => 'iptv.ld-11.net' },
        'https://iptv.ld-11.net/downloads/dzhoof-tv-1.0.42.apk',
      ),
    ).toBe(true);
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
    // The checksum is null *and* the update is withheld: an APK a device cannot
    // verify must not be advertised (see the P0-1 checksum contract suite).
    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.updateBlockedReason).toBe('CHECKSUM_UNAVAILABLE');
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
    expect(response.body.updateAvailable).toBe(false);
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

// Operations brief §4: `minimumSupportedVersionCode` must actually force an update.
// Production serves releases from the GitHub fallback, which has no per-release
// metadata, so before this the floor was hard-coded to 1 and `mandatory` was inert.
describe('operator minimum supported version floor', () => {
  afterEach(() => {
    delete process.env.APP_MIN_SUPPORTED_VERSION_CODE;
  });

  it('forces an update on a device below the configured floor (GitHub source)', async () => {
    process.env.APP_MIN_SUPPORTED_VERSION_CODE = '10300';
    githubUp();

    const response = await request(buildApp()).get(
      '/api/v1/app/version?currentVersionCode=10299',
    );

    expect(response.status).toBe(200);
    expect(response.body.source).toBe('github');
    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.mandatory).toBe(true);
    expect(response.body.isMandatory).toBe(true);
    expect(response.body.latestVersion.minimumSupportedVersionCode).toBe(10300);
  });

  it('leaves a device at the floor optional', async () => {
    process.env.APP_MIN_SUPPORTED_VERSION_CODE = '10300';
    githubUp();

    const response = await request(buildApp()).get(
      '/api/v1/app/version?currentVersionCode=10300',
    );

    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.mandatory).toBe(false);
  });

  it('ignores an invalid floor instead of forcing every installed device', async () => {
    githubUp();

    for (const invalid of ['not-a-number', '0', '-5', '1.5']) {
      process.env.APP_MIN_SUPPORTED_VERSION_CODE = invalid;
      // eslint-disable-next-line no-await-in-loop
      const response = await request(buildApp()).get(
        '/api/v1/app/version?currentVersionCode=10300',
      );

      expect(response.body.mandatory).toBe(false);
      expect(response.body.latestVersion.minimumSupportedVersionCode).toBe(1);
    }
  });

  it('never forces an update the device cannot take', async () => {
    process.env.APP_MIN_SUPPORTED_VERSION_CODE = '10500';
    withDb(dbVersion({ versionCode: 10400, minCompatibleVersion: 1 }));

    const response = await request(buildApp()).get(
      '/api/v1/app/version?currentVersionCode=10400',
    );

    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.mandatory).toBe(false);
  });

  it('raises a release minimum but never lowers it', async () => {
    process.env.APP_MIN_SUPPORTED_VERSION_CODE = '10400';
    withDb(dbVersion({ versionCode: 10500, minCompatibleVersion: 10200 }));

    const raised = await request(buildApp()).get(
      '/api/v1/app/version?currentVersionCode=10300',
    );
    expect(raised.body.latestVersion.minimumSupportedVersionCode).toBe(10400);
    expect(raised.body.mandatory).toBe(true);

    process.env.APP_MIN_SUPPORTED_VERSION_CODE = '10100';
    withDb(dbVersion({ versionCode: 10500, minCompatibleVersion: 10400 }));

    const kept = await request(buildApp()).get(
      '/api/v1/app/version?currentVersionCode=10300',
    );
    expect(kept.body.latestVersion.minimumSupportedVersionCode).toBe(10400);
    expect(kept.body.mandatory).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Verified-checksum contract (P0-1)
//
// The production defect: GET /api/v1/app/version answered `updateAvailable: true`
// with `latestVersion.sha256: null` for v1.3.1 even though the release published
// `dzhoof-tv-v1.3.1-official.apk.sha256`. Two things were wrong and both are
// covered here — the allowlist lost the redirect host, and a missing checksum was
// treated as "advertise it anyway" instead of "refuse to serve an unverifiable APK".
// ---------------------------------------------------------------------------

const MANIFEST_NAME = 'dzhoof-tv-v1.4.2-official.release.json';
const MANIFEST_URL = `${APK_URL.replace(/\.apk$/, '')}.release.json`;
const ASSET_HOST = 'release-assets.githubusercontent.com';
const SIGNER_SHA256 = '5938049a7b7eb803d7354efb96ca1989fdf17af1f62ff0e7fb68bd765920bb11';
const OTHER_SIGNER_SHA256 = '1111111111111111111111111111111111111111111111111111111111111111';

function releaseManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    packageName: 'com.dzhoof.iptv',
    versionName: '1.4.2',
    versionCode: 10402,
    releaseChannel: 'stable',
    distribution: 'external_apk',
    apkFileName: 'dzhoof-tv-v1.4.2-official.apk',
    sizeBytes: 123456789,
    sha256: SHA256,
    signerSha256: SIGNER_SHA256,
    minSdk: 28,
    targetSdk: 34,
    commit: 'abc1234',
    builtAt: '2026-09-13T00:00:00Z',
    ...overrides,
  };
}

/** The same release, plus the provenance manifest the pipeline publishes with it. */
function githubReleaseWithManifest(
  manifestOverrides: Record<string, unknown> = {},
  releaseOverrides: Record<string, unknown> = {},
) {
  const release = githubRelease(releaseOverrides) as { assets: unknown[] };
  release.assets.push({ name: MANIFEST_NAME, size: 512, browser_download_url: MANIFEST_URL });
  return { release, manifest: releaseManifest(manifestOverrides) };
}

/**
 * Models the real asset flow: the URL on github.com answers 302 to a signed URL on
 * release-assets.githubusercontent.com, which serves the bytes. The previous
 * helpers returned the body directly, which is exactly why the stale allowlist
 * slipped through CI.
 */
function serveRelease({
  release,
  sha256Body = `${SHA256}  apk\n`,
  manifestBody = JSON.stringify(releaseManifest()),
}: {
  release: unknown;
  sha256Body?: string;
  manifestBody?: string;
}) {
  axiosGet.mockImplementation(async (url: unknown) => {
    const target = String(url);
    if (isGithubApiUrl(target)) return { status: 200, headers: {}, data: release };
    if (target === SHA256_URL) {
      return { status: 302, headers: { location: `https://${ASSET_HOST}/asset?name=sha256` }, data: '' };
    }
    if (target === MANIFEST_URL) {
      return { status: 302, headers: { location: `https://${ASSET_HOST}/asset?name=manifest` }, data: '' };
    }
    if (target.startsWith(`https://${ASSET_HOST}/`)) {
      return { status: 200, headers: {}, data: target.includes('name=manifest') ? manifestBody : sha256Body };
    }
    throw new Error(`unexpected fetch: ${target}`);
  });
}

describe('GET /api/v1/app/version checksum contract (P0-1)', () => {
  beforeEach(() => {
    delete process.env.APP_UPDATE_REQUIRE_CHECKSUM;
    delete process.env.APP_RELEASE_SIGNER_SHA256;
  });

  it('serves the checksum when the release only publishes a .sha256 asset', async () => {
    serveRelease({ release: githubRelease() });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.status).toBe(200);
    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion.sha256).toBe(SHA256);
    expect(response.body.latestVersion.checksumSource).toBe('sha256-asset');
    expect(response.body.updateBlockedReason).toBeUndefined();
  });

  it('follows the github.com -> release-assets.githubusercontent.com redirect chain', async () => {
    serveRelease({ release: githubRelease() });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    // The regression assertion: without release-assets.githubusercontent.com in the
    // allowlist this is null, and production served exactly that to every device.
    expect(response.body.latestVersion.sha256).not.toBeNull();
    expect(validateUrlForSSRF).toHaveBeenCalled();
  });

  it('refuses the release when the manifest and the .sha256 asset disagree', async () => {
    // Both assets are produced from the same bytes, so a disagreement means one of
    // them was replaced or mispublished — the manifest must not win silently.
    const { release } = githubReleaseWithManifest();
    serveRelease({ release, sha256Body: `${'ab'.repeat(32)}  apk\n` });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.status).toBe(200);
    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.updateBlockedReason).toBe('CHECKSUM_UNAVAILABLE');
  });

  it('still uses a verified manifest when the .sha256 asset cannot be read', async () => {
    // An unreadable secondary asset is not evidence of tampering; the manifest is the
    // stronger source and the device verifies the downloaded APK itself.
    const { release } = githubReleaseWithManifest();
    serveRelease({ release, sha256Body: 'not-a-checksum\n' });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion.sha256).toBe(SHA256);
    expect(response.body.latestVersion.checksumSource).toBe('manifest');
  });

  it('prefers the provenance manifest and binds it to the APK asset', async () => {
    const { release } = githubReleaseWithManifest();
    serveRelease({ release });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion.sha256).toBe(SHA256);
    expect(response.body.latestVersion.checksumSource).toBe('manifest');
    expect(response.body.latestVersion.signerSha256).toBe(SIGNER_SHA256);
  });

  it('does not fall back to the weaker .sha256 asset when the manifest is inconsistent', async () => {
    // A swapped APK with a manifest describing the original: the weak asset is still
    // present and valid, and using it would hide the swap.
    const { release, manifest } = githubReleaseWithManifest({ apkFileName: 'dzhoof-tv-v1.4.2-evil.apk' });
    serveRelease({ release, manifestBody: JSON.stringify(manifest) });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.updateBlockedReason).toBe('CHECKSUM_UNAVAILABLE');
  });

  it('withholds the update when the checksum asset is malformed', async () => {
    serveRelease({ release: githubRelease(), sha256Body: 'not-a-checksum\n' });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.status).toBe(200);
    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.mandatory).toBe(false);
    expect(response.body.isMandatory).toBe(false);
    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.updateBlockedReason).toBe('CHECKSUM_UNAVAILABLE');
    // The release is still described, so an operator can see what was withheld.
    expect(response.body.latestVersion.versionCode).toBe(10402);
  });

  it('withholds the update when the checksum is truncated', async () => {
    serveRelease({ release: githubRelease(), sha256Body: `${SHA256.slice(0, 63)}\n` });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.latestVersion.sha256).toBeNull();
  });

  it('withholds the update when the manifest size disagrees with the APK asset', async () => {
    const { release, manifest } = githubReleaseWithManifest({ sizeBytes: 1 });
    serveRelease({ release, manifestBody: JSON.stringify(manifest) });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.updateAvailable).toBe(false);
  });

  it('withholds the update when the manifest is for another package', async () => {
    const { release, manifest } = githubReleaseWithManifest({ packageName: 'com.example.other' });
    serveRelease({ release, manifestBody: JSON.stringify(manifest) });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.updateAvailable).toBe(false);
  });

  it('withholds the update when the manifest versionCode disagrees with its versionName', async () => {
    const { release, manifest } = githubReleaseWithManifest({ versionCode: 10999 });
    serveRelease({ release, manifestBody: JSON.stringify(manifest) });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.updateAvailable).toBe(false);
  });

  it('withholds the update when the manifest cannot be parsed', async () => {
    const { release } = githubReleaseWithManifest();
    serveRelease({ release, manifestBody: '{ truncated' });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.updateAvailable).toBe(false);
  });

  it('withholds an update signed by an unexpected certificate when one is pinned', async () => {
    process.env.APP_RELEASE_SIGNER_SHA256 = SIGNER_SHA256;
    const { release, manifest } = githubReleaseWithManifest({ signerSha256: OTHER_SIGNER_SHA256 });
    serveRelease({ release, manifestBody: JSON.stringify(manifest) });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.updateAvailable).toBe(false);
  });

  it('withholds an update whose manifest carries no signer when one is pinned', async () => {
    // Fail-closed on the pin: dropping `signerSha256` from a re-signed APK's manifest
    // must not be a way past a configured APP_RELEASE_SIGNER_SHA256.
    process.env.APP_RELEASE_SIGNER_SHA256 = SIGNER_SHA256;
    const { release, manifest } = githubReleaseWithManifest({ signerSha256: null });
    serveRelease({ release, manifestBody: JSON.stringify(manifest) });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.updateAvailable).toBe(false);
  });

  it('serves an update whose signer matches the pinned certificate', async () => {
    process.env.APP_RELEASE_SIGNER_SHA256 = SIGNER_SHA256;
    const { release } = githubReleaseWithManifest();
    serveRelease({ release });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion.sha256).toBe(SHA256);
  });

  it('does not offer a downgrade', async () => {
    const { release } = githubReleaseWithManifest();
    serveRelease({ release });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10402');

    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.mandatory).toBe(false);
    // The release is still described, but nothing is offered.
    expect(response.body.latestVersion.versionCode).toBe(10402);
  });

  it('honours APP_UPDATE_REQUIRE_CHECKSUM=false as an explicit escape hatch', async () => {
    process.env.APP_UPDATE_REQUIRE_CHECKSUM = 'false';
    serveRelease({ release: githubRelease(), sha256Body: 'not-a-checksum\n' });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.latestVersion.checksumSource).toBeNull();
  });

  it('still withholds when the operator asked for the checksum to be required', async () => {
    process.env.APP_UPDATE_REQUIRE_CHECKSUM = 'true';
    serveRelease({ release: githubRelease(), sha256Body: 'not-a-checksum\n' });

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(false);
  });

  it('withholds a database release published without a checksum', async () => {
    // Rows predating the publish gate exist in production (AppVersion 1.2.2 has no
    // sha256). The API must not hand such a row to a device.
    withDb(dbVersion({ sha256: null }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10100');

    expect(response.body.source).toBe('db');
    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.latestVersion.checksumSource).toBeNull();
    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.updateBlockedReason).toBe('CHECKSUM_UNAVAILABLE');
  });

  it('serves a database release that carries a checksum', async () => {
    withDb(dbVersion());

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion.sha256).toBe(SHA256);
    expect(response.body.latestVersion.checksumSource).toBe('db');
  });
});

describe('published-release contract shared by /version and /latest', () => {
  beforeEach(() => {
    delete process.env.APP_UPDATE_REQUIRE_CHECKSUM;
    delete process.env.APP_RELEASE_SIGNER_SHA256;
    delete process.env.PUBLIC_BASE_URL;
  });

  // Regression for the production defect of 2026-09-15: the checksum lookup was
  // gated behind `updateAvailable`, so the live API answered
  // `sha256: null, checksumSource: null` to a device that was already current —
  // the exact "sha256 missing from the Update API" report (#5 of the brief).
  it('serves the verified checksum even when the device is already current', async () => {
    githubUp();

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10402');

    expect(response.status).toBe(200);
    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.latestVersion.sha256).toBe(SHA256);
    expect(response.body.latestVersion.checksumSource).toBe('sha256-asset');
  });

  it('serves the verified checksum to an already-current device reading the DB source', async () => {
    process.env.PUBLIC_BASE_URL = 'https://iptv.ld-11.net/';
    withDb(dbVersion({ downloadUrl: 'https://iptv.ld-11.net/api/v1/app/download' }));
    githubUp();

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10402');

    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.latestVersion.sha256).toBe(SHA256);
  });

  it('GET /latest carries the verified checksum instead of a null', async () => {
    githubUp();

    const response = await request(buildApp()).get('/api/v1/app/latest');

    expect(response.status).toBe(200);
    expect(response.body.data.sha256).toBe(SHA256);
    expect(response.body.data.checksumSource).toBe('sha256-asset');
    expect(response.body.checksumVerified).toBe(true);
  });

  it('GET /latest never leaks the internal checksum-fetch asset URLs', async () => {
    githubUp();

    const response = await request(buildApp()).get('/api/v1/app/latest');

    // These two fields exist only so the server can download the manifest and the
    // .sha256 asset over the SSRF-checked redirect chain. They used to be returned
    // verbatim by the raw-candidate response.
    expect(response.body.data).not.toHaveProperty('sha256AssetUrl');
    expect(response.body.data).not.toHaveProperty('manifestAssetUrl');
    expect(JSON.stringify(response.body)).not.toContain('.sha256');
    expect(JSON.stringify(response.body)).not.toContain('.release.json');
  });

  it('GET /latest withholds the download URL when no checksum can be verified', async () => {
    serveRelease({ release: githubRelease(), sha256Body: 'not-a-checksum\n' });

    const response = await request(buildApp()).get('/api/v1/app/latest');

    expect(response.status).toBe(200);
    expect(response.body.data.sha256).toBeNull();
    expect(response.body.data.downloadUrl).toBeNull();
    expect(response.body.checksumVerified).toBe(false);
    expect(response.body.updateBlockedReason).toBe('CHECKSUM_UNAVAILABLE');
  });

  it('binds a canonical-redirect row whose checksum matches the release it serves', async () => {
    process.env.PUBLIC_BASE_URL = 'https://iptv.ld-11.net/';
    withDb(dbVersion({ downloadUrl: 'https://iptv.ld-11.net/api/v1/app/download' }));
    githubUp();

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion.sha256).toBe(SHA256);
    expect(response.body.latestVersion.checksumSource).toBe('db');
    expect(response.body.latestVersion.downloadUrl).toBe('https://iptv.ld-11.net/api/v1/app/download');
  });

  it('withholds a canonical-redirect row whose checksum describes another release', async () => {
    process.env.PUBLIC_BASE_URL = 'https://iptv.ld-11.net/';
    withDb(
      dbVersion({
        downloadUrl: 'https://iptv.ld-11.net/api/v1/app/download',
        // 1.0.40's real digest in production: correct for the file that /downloads/
        // used to hold, wrong for the bytes the redirect serves today.
        sha256: '1170dcbc1a1515f216cc571fcb2c0cb0444043ffbf4011bd2f2004317050e3d5',
      }),
    );
    githubUp();

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.updateBlockedReason).toBe('CHECKSUM_UNAVAILABLE');
    expect(response.body.latestVersion.sha256).toBeNull();
    expect(response.body.latestVersion.downloadUrl).toBeNull();
  });

  it('leaves a row that points at its own artifact untouched by the redirect binding', async () => {
    withDb(dbVersion({ downloadUrl: APK_URL }));

    const response = await request(buildApp()).get('/api/v1/app/version?currentVersionCode=10300');

    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion.sha256).toBe(SHA256);
    expect(response.body.latestVersion.checksumSource).toBe('db');
    expect(response.body.latestVersion.downloadUrl).toBe(APK_URL);
  });
});

describe('canonical redirect detection', () => {
  const req = (host: string) => ({ get: () => host }) as unknown as express.Request;

  it('recognizes the API\'s own /api/v1/app/download redirect', () => {
    expect(isCanonicalRedirectUrl(req('iptv.ld-11.net'), 'https://iptv.ld-11.net/api/v1/app/download')).toBe(true);
  });

  it('ignores a plain asset URL on the same host', () => {
    expect(isCanonicalRedirectUrl(req('iptv.ld-11.net'), 'https://iptv.ld-11.net/downloads/app.apk')).toBe(false);
    expect(servesCanonicalRedirect(req('iptv.ld-11.net'), 'https://iptv.ld-11.net/downloads/app.apk')).toBe(true);
  });

  it('rejects a redirect path on another host or a non-HTTPS scheme', () => {
    expect(isCanonicalRedirectUrl(req('iptv.ld-11.net'), 'https://evil.example.com/api/v1/app/download')).toBe(false);
    expect(isCanonicalRedirectUrl(req('iptv.ld-11.net'), 'http://iptv.ld-11.net/api/v1/app/download')).toBe(false);
    expect(isCanonicalRedirectUrl(req('iptv.ld-11.net'), '')).toBe(false);
  });
});

describe('checksum cache identity', () => {
  const candidate = {
    versionCode: 10402,
    apkFileName: 'dzhoof-tv-v1.4.2-official.apk',
    apkFileSize: 123456789,
    manifestAssetUrl: 'https://github.com/o/r/releases/download/v1.4.2/dzhoof-tv-v1.4.2-official.release.json',
    sha256AssetUrl: 'https://github.com/o/r/releases/download/v1.4.2/dzhoof-tv-v1.4.2-official.apk.sha256',
  };

  it('is stable for the same artifact', () => {
    expect(checksumCacheKey(candidate)).toBe(checksumCacheKey({ ...candidate }));
  });

  // The key used to be `v<versionCode>` alone, so a re-cut APK republished under the
  // same versionCode kept serving the previous release's digest for the whole TTL.
  it('changes when the artifact behind the same versionCode changes', () => {
    const base = checksumCacheKey(candidate);
    expect(checksumCacheKey({ ...candidate, apkFileName: 'dzhoof-tv-v1.4.2-recut.apk' })).not.toBe(base);
    expect(checksumCacheKey({ ...candidate, apkFileSize: 1 })).not.toBe(base);
    expect(
      checksumCacheKey({ ...candidate, sha256AssetUrl: base.replace(base, 'https://github.com/o/r/releases/download/v1.4.2b/x.apk.sha256') }),
    ).not.toBe(base);
  });

  it('never collides across different version codes', () => {
    expect(checksumCacheKey({ ...candidate, versionCode: 10403 })).not.toBe(checksumCacheKey(candidate));
  });
});

describe('checksum gate helpers', () => {
  it('parses a manifest only when it is a JSON object', () => {
    expect(parseReleaseManifest(JSON.stringify(releaseManifest()))).toMatchObject({ schemaVersion: 1 });
    expect(parseReleaseManifest('[1,2,3]')).toBeNull();
    expect(parseReleaseManifest('{')).toBeNull();
    expect(parseReleaseManifest('')).toBeNull();
    expect(parseReleaseManifest(undefined as unknown as string)).toBeNull();
  });

  it('reports every disagreement between a manifest and its APK asset', () => {
    const apkAsset = { name: 'dzhoof-tv-v1.4.2-official.apk', size: 123456789 };

    expect(validateManifestAgainstAsset(releaseManifest(), apkAsset)).toMatchObject({
      ok: true,
      sha256: SHA256,
      signerSha256: SIGNER_SHA256,
    });

    const bad = validateManifestAgainstAsset(
      releaseManifest({ sha256: 'nope', sizeBytes: 5, apkFileName: 'other.apk', packageName: 'x.y' }),
      apkAsset,
    );
    expect(bad.ok).toBe(false);
    expect(bad.sha256).toBeNull();
    expect(bad.problems.join(' | ')).toContain('sha256');
    expect(bad.problems.join(' | ')).toContain('sizeBytes');
    expect(bad.problems.join(' | ')).toContain('apkFileName');
    expect(bad.problems.join(' | ')).toContain('packageName');
  });

  it('rejects a manifest for an unsupported schema version', () => {
    const verdict = validateManifestAgainstAsset(releaseManifest({ schemaVersion: 99 }), null);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toContain('schemaVersion');
  });

  it('picks the manifest that belongs to the APK, not an unrelated one', () => {
    const release = {
      assets: [
        { name: 'dzhoof-tv-v1.4.2-official.apk', browser_download_url: APK_URL },
        { name: 'dzhoof-tv-v1.4.1-official.release.json', browser_download_url: 'https://github.com/old.json' },
        { name: MANIFEST_NAME, browser_download_url: MANIFEST_URL },
      ],
    };
    const apkAsset = { name: 'dzhoof-tv-v1.4.2-official.apk' };

    expect(pickManifestAsset(release, apkAsset)).toMatchObject({ browser_download_url: MANIFEST_URL });
    expect(pickManifestAsset(release, { name: 'dzhoof-tv-v9.9.9-official.apk' })).toBeNull();
    expect(pickManifestAsset(release, null)).toBeNull();
  });

  it('requires a checksum unless the operator explicitly opts out', () => {
    delete process.env.APP_UPDATE_REQUIRE_CHECKSUM;
    expect(requireChecksumFromEnv()).toBe(true);

    for (const off of ['false', 'FALSE', '0', 'no', 'off']) {
      process.env.APP_UPDATE_REQUIRE_CHECKSUM = off;
      expect(requireChecksumFromEnv()).toBe(false);
    }

    process.env.APP_UPDATE_REQUIRE_CHECKSUM = 'true';
    expect(requireChecksumFromEnv()).toBe(true);
    delete process.env.APP_UPDATE_REQUIRE_CHECKSUM;
  });
});
