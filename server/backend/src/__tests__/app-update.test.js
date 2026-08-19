const router = require('../routes/app-update');

const { normalizeVersion, compareVersions, versionNameToCode } = router._private;

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
