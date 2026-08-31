import { decryptSecret, encryptSecret } from './crypto';

describe('secret encryption configuration', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalXtreamKey = process.env.XTREAM_SECRET_KEY;
  const originalJwtKey = process.env.JWT_ACCESS_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalXtreamKey === undefined) delete process.env.XTREAM_SECRET_KEY;
    else process.env.XTREAM_SECRET_KEY = originalXtreamKey;
    if (originalJwtKey === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalJwtKey;
  });

  it('keeps development and test round-trips functional without a configured key', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.XTREAM_SECRET_KEY;
    delete process.env.JWT_ACCESS_SECRET;

    const encrypted = encryptSecret('demo-secret');

    expect(encrypted).toMatch(/^enc:/);
    expect(decryptSecret(encrypted)).toBe('demo-secret');
  });

  it('rejects the development fallback in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.XTREAM_SECRET_KEY;
    delete process.env.JWT_ACCESS_SECRET;

    expect(() => encryptSecret('production-secret')).toThrow(
      'XTREAM_SECRET_KEY or JWT_ACCESS_SECRET must be configured in production',
    );
  });

  it('supports the configured production key', () => {
    process.env.NODE_ENV = 'production';
    process.env.XTREAM_SECRET_KEY = 'a-production-secret';
    delete process.env.JWT_ACCESS_SECRET;

    const encrypted = encryptSecret('production-secret');

    expect(decryptSecret(encrypted)).toBe('production-secret');
  });
});
