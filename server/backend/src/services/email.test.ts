/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Email-channel readiness.
 *
 * The 2026-09-15 incident this covers: `MAIL_PROVIDER=brevo` with an empty
 * `BREVO_USER`/`BREVO_PASSWORD` made every send fail with
 * `Missing credentials for "PLAIN"`, once per alert, while nothing in the health
 * payload said the channel was unusable. These tests pin the reported state and the
 * "do not even try, say it once" behaviour.
 */
import { getEmailReadiness, sendEmail } from './email';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSendMail = jest.fn(async () => ({ messageId: 'test' }));
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: (...args: unknown[]) => mockCreateTransport(...(args as [])) },
}));

// AppSetting lookup: `null` means "not set in the panel", so the env fallback wins.
const mockFindOne: any = jest.fn(() => ({ lean: () => ({ exec: async () => null }) }));
jest.mock('../models/AppSetting', () => ({
  __esModule: true,
  default: { findOne: (...args: unknown[]) => mockFindOne(...(args as [])) },
}));

const ORIGINAL_ENV = { ...process.env };

/** Each case starts from a clean environment: these are env-driven by design. */
function resetEnv(): void {
  delete process.env.MAIL_PROVIDER;
  delete process.env.BREVO_USER;
  delete process.env.BREVO_PASSWORD;
}

/** Makes the AppSetting mock answer per key, as the admin panel would. */
function withAppSettings(values: Record<string, string>): void {
  mockFindOne.mockImplementation((query: any) => ({
    lean: () => ({
      exec: async () => {
        const key = String(query?.key || '');
        return values[key] ? { key, value: values[key] } : null;
      },
    }),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetEnv();
  mockFindOne.mockImplementation(() => ({ lean: () => ({ exec: async () => null }) }));
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('getEmailReadiness', () => {
  it('reports brevo without credentials as unusable, naming the reason only', async () => {
    process.env.MAIL_PROVIDER = 'brevo';

    const readiness = await getEmailReadiness();

    expect(readiness).toEqual({
      channel: 'email',
      provider: 'brevo',
      configured: false,
      reason: 'missing_credentials',
    });
  });

  it('reports brevo as usable when both credentials come from the environment', async () => {
    process.env.MAIL_PROVIDER = 'brevo';
    process.env.BREVO_USER = 'smtp-user';
    process.env.BREVO_PASSWORD = 'smtp-pass';

    const readiness = await getEmailReadiness();

    expect(readiness.configured).toBe(true);
    expect(readiness.reason).toBe('ok');
    // Never echo the credential itself through this API.
    expect(JSON.stringify(readiness)).not.toContain('smtp-pass');
    expect(JSON.stringify(readiness)).not.toContain('smtp-user');
  });

  it('prefers credentials set from the admin panel over the environment', async () => {
    process.env.MAIL_PROVIDER = 'brevo';
    withAppSettings({ brevo_user: 'panel-user', brevo_password: 'panel-pass' });

    const readiness = await getEmailReadiness();

    expect(readiness.configured).toBe(true);
    expect(JSON.stringify(readiness)).not.toContain('panel-pass');
  });

  it('treats a mailhog provider as usable but not a production channel', async () => {
    // Local development must keep sending to the mail sink: reporting it as
    // unusable would break every dev environment.
    const readiness = await getEmailReadiness();

    expect(readiness).toEqual({
      channel: 'email',
      provider: 'mailhog',
      configured: true,
      reason: 'dev_sink',
    });
  });

  it('rejects a half-configured channel (user without password)', async () => {
    process.env.MAIL_PROVIDER = 'brevo';
    process.env.BREVO_USER = 'smtp-user';

    const readiness = await getEmailReadiness();

    expect(readiness.configured).toBe(false);
    expect(readiness.reason).toBe('missing_credentials');
  });
});

describe('sendEmail on a channel that cannot send', () => {
  it('does not touch SMTP and reports ALERT_EMAIL_DISABLED instead', async () => {
    process.env.MAIL_PROVIDER = 'brevo';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await sendEmail({
      to: 'admin@dzhoof.local',
      subject: 'test',
      template: 'daily-report',
      variables: {},
    });

    expect(result).toEqual({ ok: false, error: 'ALERT_EMAIL_DISABLED', skipped: true });
    expect(mockSendMail).not.toHaveBeenCalled();
    // A known state is logged once, not once per recipient: the previous behaviour
    // produced '[email] send failed: Missing credentials for "PLAIN"' per send.
    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('ALERT_EMAIL_DISABLED'))).toHaveLength(1);

    // A second send reports the same state without logging it again.
    await sendEmail({ to: 'second@dzhoof.local', subject: 'test', template: 'daily-report', variables: {} });
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('ALERT_EMAIL_DISABLED'))).toHaveLength(1);

    warn.mockRestore();
    error.mockRestore();
  });

  it('still sends when the channel is usable', async () => {
    process.env.MAIL_PROVIDER = 'mailhog';

    const result = await sendEmail({
      to: 'admin@dzhoof.local',
      subject: 'test',
      template: 'daily-report',
      variables: { date: '2026-09-15' },
    });

    expect(result.ok).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});
