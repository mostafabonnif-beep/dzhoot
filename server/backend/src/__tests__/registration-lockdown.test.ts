import request from 'supertest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('../server');

/**
 * Audit-remediation-v1: public self-service registration is disabled by default.
 * It only opens when PUBLIC_REGISTRATION_ENABLED=true AND mail + reCAPTCHA are
 * configured — otherwise the endpoint must refuse with 403.
 */
describe('registration lockdown (audit-remediation-v1)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('POST /api/v1/auth/register returns 403 when registration is disabled (default)', async () => {
    delete process.env.PUBLIC_REGISTRATION_ENABLED;

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'probe', email: 'probe@example.com', password: 'Probe12345!' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/disabled/i);
  });

  it('POST /api/v1/auth/register stays disabled when the flag is set but protection is missing', async () => {
    // Flag on, but no BREVO creds and no reCAPTCHA → must stay disabled.
    process.env.PUBLIC_REGISTRATION_ENABLED = 'true';
    delete process.env.BREVO_USER;
    delete process.env.BREVO_PASSWORD;
    delete process.env.GOOGLE_RECAPTCHA_SITE_KEY;
    delete process.env.GOOGLE_RECAPTCHA_SECRET_KEY;

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'probe2', email: 'probe2@example.com', password: 'Probe12345!' });

    expect(res.status).toBe(403);
  });

  it('POST /api/v1/public/signup returns 403 when registration is disabled', async () => {
    delete process.env.PUBLIC_REGISTRATION_ENABLED;

    const res = await request(app)
      .post('/api/v1/public/signup')
      .send({ username: 'probe3', email: 'probe3@example.com', password: 'Probe12345!' });

    expect(res.status).toBe(403);
  });

  it('GET /api/v1/config/defaults reports capability flags (registration disabled, oauth disabled)', async () => {
    delete process.env.PUBLIC_REGISTRATION_ENABLED;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GH_OAUTH_CLIENT_ID;

    const res = await request(app).get('/api/v1/config/defaults');

    expect(res.status).toBe(200);
    expect(res.body.data.registrationEnabled).toBe(false);
    expect(res.body.data.googleOAuthEnabled).toBe(false);
    expect(res.body.data.githubOAuthEnabled).toBe(false);
    expect(res.body.data).toHaveProperty('mailConfigured');
  });
});
