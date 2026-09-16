import { verifyRecaptchaToken } from './recaptcha';

/** Shared review of the public-registration captcha check. */
describe('verifyRecaptchaToken', () => {
  const originalSecret = process.env.GOOGLE_RECAPTCHA_SECRET_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.GOOGLE_RECAPTCHA_SECRET_KEY;
    else process.env.GOOGLE_RECAPTCHA_SECRET_KEY = originalSecret;
    global.fetch = originalFetch;
  });

  it('skips when no secret is configured', async () => {
    delete process.env.GOOGLE_RECAPTCHA_SECRET_KEY;
    await expect(verifyRecaptchaToken('anything', '1.2.3.4')).resolves.toEqual({
      ok: true,
      skipped: true,
    });
  });

  it('refuses an empty token', async () => {
    process.env.GOOGLE_RECAPTCHA_SECRET_KEY = 'secret';
    await expect(verifyRecaptchaToken('', '1.2.3.4')).resolves.toMatchObject({
      ok: false,
      reason: 'missing_token',
    });
  });

  it('accepts a successful v3 response above the score threshold', async () => {
    process.env.GOOGLE_RECAPTCHA_SECRET_KEY = 'secret';
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: true, score: 0.7 }),
    }) as unknown as typeof fetch;

    await expect(verifyRecaptchaToken('token', '1.2.3.4')).resolves.toEqual({ ok: true, score: 0.7 });
  });

  it('accepts a v2 response (no score field)', async () => {
    process.env.GOOGLE_RECAPTCHA_SECRET_KEY = 'secret';
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    }) as unknown as typeof fetch;

    await expect(verifyRecaptchaToken('token', '1.2.3.4')).resolves.toEqual({
      ok: true,
      score: undefined,
    });
  });

  it('refuses a rejected and a low-score response', async () => {
    process.env.GOOGLE_RECAPTCHA_SECRET_KEY = 'secret';
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: false }),
    }) as unknown as typeof fetch;
    await expect(verifyRecaptchaToken('token', '1.2.3.4')).resolves.toMatchObject({
      ok: false,
      reason: 'rejected',
    });

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: true, score: 0.2 }),
    }) as unknown as typeof fetch;
    await expect(verifyRecaptchaToken('token', '1.2.3.4')).resolves.toMatchObject({
      ok: false,
      reason: 'rejected',
      score: 0.2,
    });
  });

  it('fails closed when Google cannot be reached', async () => {
    process.env.GOOGLE_RECAPTCHA_SECRET_KEY = 'secret';
    global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) as unknown as typeof fetch;

    await expect(verifyRecaptchaToken('token', '1.2.3.4')).resolves.toMatchObject({
      ok: false,
      reason: 'verification_unavailable',
    });
  });
});
