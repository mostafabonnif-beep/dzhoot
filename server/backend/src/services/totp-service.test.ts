import { authenticator } from 'otplib';
import {
  createTotpSetup,
  decryptTotpSecret,
  encryptTotpSecret,
  verifyTotpToken,
} from './totp-service';

describe('totp-service', () => {
  const previousKey = process.env.TOTP_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOTP_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  afterAll(() => {
    if (previousKey === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
    else process.env.TOTP_ENCRYPTION_KEY = previousKey;
  });

  it('encrypts and decrypts a secret without storing plaintext', () => {
    const secret = authenticator.generateSecret();
    const encrypted = encryptTotpSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptTotpSecret(encrypted)).toBe(secret);
  });

  it('creates a setup URI and verifies only the current token', async () => {
    const setup = await createTotpSetup('admin@example.com');
    const token = authenticator.generate(setup.secret);
    expect(setup.uri).toContain('otpauth://totp/');
    expect(await verifyTotpToken(setup.encryptedSecret, token)).toBe(true);
    expect(await verifyTotpToken(setup.encryptedSecret, '000000')).toBe(false);
    expect(await verifyTotpToken(setup.encryptedSecret, 'not-a-code')).toBe(false);
  });
});
