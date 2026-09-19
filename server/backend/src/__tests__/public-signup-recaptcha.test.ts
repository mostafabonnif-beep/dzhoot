import request from 'supertest';
import mongoose from 'mongoose';

// `routes/publicAuth.js` does `const { sendVerificationEmail } = require('../services/email')`
// at module load, so `jest.spyOn` on the module object after the fact does NOT
// intercept it — the real SMTP send ran, failed its login asynchronously and
// leaked into the next suite ("Cannot log after tests are done", jest exit 1).
// The module factory replaces the export before the route captures it.
jest.mock('../services/email', () => {
  const actual = jest.requireActual('../services/email');
  return {
    ...actual,
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('../server');

/**
 * `POST /api/v1/public/signup` is a sibling of `POST /api/v1/auth/register` and
 * hands back a channelListCode plus JWTs on success — but it never verified the
 * reCAPTCHA token. `utils/registration-config.js` only gates whether open
 * registration is *enabled*; it is not an enforcement point. A bot could post
 * here while `/auth/register` correctly refused it.
 */
describe('public signup enforces reCAPTCHA', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.PUBLIC_REGISTRATION_ENABLED = 'true';
    process.env.MAIL_PROVIDER = 'brevo';
    process.env.BREVO_USER = 'test-user';
    process.env.BREVO_PASSWORD = 'test-password';
    process.env.GOOGLE_RECAPTCHA_SITE_KEY = 'test-site-key';
    process.env.GOOGLE_RECAPTCHA_SECRET_KEY = 'test-secret-key';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('refuses a signup with no token', async () => {
    const res = await request(app)
      .post('/api/v1/public/signup')
      .send({ username: 'nogtoken', email: 'nogtoken@example.com', password: 'StrongPass123!' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reCAPTCHA/i);
  });

  it('refuses a signup whose token Google rejects', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    }) as unknown as typeof fetch;

    const res = await request(app)
      .post('/api/v1/public/signup')
      .send({
        username: 'bottish',
        email: 'bottish@example.com',
        password: 'StrongPass123!',
        recaptchaToken: 'bogus',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/bot activity/i);
  });

  it('refuses a low-score (v3) token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: true, score: 0.1 }),
    }) as unknown as typeof fetch;

    const res = await request(app)
      .post('/api/v1/public/signup')
      .send({
        username: 'lowscore',
        email: 'lowscore@example.com',
        password: 'StrongPass123!',
        recaptchaToken: 'low',
      });

    expect(res.status).toBe(403);
  });

  it('fails closed when the verification endpoint is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) as unknown as typeof fetch;

    const res = await request(app)
      .post('/api/v1/public/signup')
      .send({
        username: 'unreachable',
        email: 'unreachable@example.com',
        password: 'StrongPass123!',
        recaptchaToken: 'whatever',
      });

    expect(res.status).toBe(503);
  });

  it('creates the account when the token verifies', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: true, score: 0.9 }),
    }) as unknown as typeof fetch;

    const res = await request(app)
      .post('/api/v1/public/signup')
      .send({
        username: 'gooduser',
        email: 'gooduser@example.com',
        password: 'StrongPass123!',
        recaptchaToken: 'good',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const created = await mongoose.model('User').findOne({ username: 'gooduser' }).lean();
    expect(created).toBeTruthy();
  });
});
