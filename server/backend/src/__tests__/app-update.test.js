/* global describe, it, expect */

const router = require('../routes/app-update');

const { normalizeVersion, compareVersions, versionNameToCode, getCanonicalDownloadUrl, isStaleLocalDownloadUrl, publicDownloadUrl } = router._private;

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
});

describe('app download URL helpers', () => {
  const request = {
    get: (header) => (header === 'host' ? 'iptv.ld-11.net' : undefined),
    protocol: 'https',
  };

  it('uses the HTTPS public API redirect as the canonical download URL', () => {
    expect(getCanonicalDownloadUrl(request)).toBe('https://iptv.ld-11.net/api/v1/app/download');
  });

  it('replaces stale local download paths with the canonical redirect', () => {
    process.env.PUBLIC_BASE_URL = 'https://iptv.ld-11.net/';
    expect(isStaleLocalDownloadUrl(request, 'https://iptv.ld-11.net/downloads/dzhoof-tv-1.0.42.apk')).toBe(true);
    expect(publicDownloadUrl(request, 'https://iptv.ld-11.net/downloads/dzhoof-tv-1.0.42.apk')).toBe('https://iptv.ld-11.net/api/v1/app/download');
    expect(publicDownloadUrl(request, 'https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.0.42/DZHOOF-TV-v1.0.42-production.apk')).toContain('github.com/');
    delete process.env.PUBLIC_BASE_URL;
  });
});
