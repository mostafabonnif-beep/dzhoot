/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Alert-channel status and the "every channel failed" escalation.
 *
 * Covers the reporting gap behind the 2026-09-15 `Missing credentials for "PLAIN"`
 * incident: `/health?details=true` said alerting was configured (Telegram was set)
 * while the email channel could not send at all, and nothing said so per channel.
 */
import { getAlertChannelStatus, sendOperationalAlert, clearAlertCooldowns } from './alert-notifier';
import { getEmailReadiness, sendEmail } from './email';

const mockAppSettings: Record<string, string> = {};

jest.mock('./email', () => ({ getEmailReadiness: jest.fn(), sendEmail: jest.fn() }));
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn(async () => ({ safe: true, resolvedAddresses: ['198.51.100.10'] })),
}));
jest.mock('../models/AppSetting', () => ({
  __esModule: true,
  default: {
    findOne: (query: any) => ({
      lean: () => ({
        exec: async () => {
          const key = String(query?.key || '');
          return mockAppSettings[key] ? { key, value: mockAppSettings[key] } : null;
        },
      }),
    }),
  },
}));
// No admin fallback recipient: this suite must not depend on another suite's users.
jest.mock('../models/User', () => ({
  __esModule: true,
  default: {
    findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => null }) }) }),
  },
}));

const readinessMock = getEmailReadiness as jest.Mock;
const sendEmailMock = sendEmail as jest.Mock;
const ENV_KEYS = [
  'ALERT_WEBHOOK_URL',
  'ALERT_EMAIL',
  'ALERT_TELEGRAM_BOT_TOKEN',
  'ALERT_TELEGRAM_CHAT_ID',
] as const;
const ORIGINAL_ENV = { ...process.env };

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function clearSettings(): void {
  for (const key of Object.keys(mockAppSettings)) delete mockAppSettings[key];
}

beforeEach(() => {
  jest.clearAllMocks();
  clearAlertCooldowns();
  clearEnv();
  clearSettings();
  readinessMock.mockResolvedValue({ channel: 'email', provider: 'brevo', configured: true, reason: 'ok' });
  sendEmailMock.mockResolvedValue({ ok: true });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('getAlertChannelStatus', () => {
  it('reports every channel as not configured when nothing is set', async () => {
    const channels = await getAlertChannelStatus();

    expect(channels).toEqual([
      { channel: 'webhook', configured: false, reason: 'not_configured' },
      { channel: 'email', configured: false, reason: 'not_configured' },
      { channel: 'telegram', configured: false, reason: 'not_configured' },
    ]);
  });

  it('reports a configured recipient with a broken transport as unusable', async () => {
    mockAppSettings.alert_email = 'ops@dzhoof.local';
    readinessMock.mockResolvedValue({
      channel: 'email',
      provider: 'brevo',
      configured: false,
      reason: 'missing_credentials',
    });

    const channels = await getAlertChannelStatus();
    const email = channels.find((channel) => channel.channel === 'email');

    // This is the state that produced "Missing credentials for PLAIN" on every
    // alert while the endpoint still claimed alerting was configured.
    expect(email).toEqual({ channel: 'email', configured: false, reason: 'missing_credentials' });
  });

  it('reports email as usable when the panel has credentials', async () => {
    mockAppSettings.alert_email = 'ops@dzhoof.local';

    const channels = await getAlertChannelStatus();
    const email = channels.find((channel) => channel.channel === 'email');

    expect(email).toEqual({ channel: 'email', configured: true, reason: 'ok' });
  });

  it('reports telegram and webhook from their own settings', async () => {
    mockAppSettings.alert_telegram_bot_token = '123:token';
    mockAppSettings.alert_telegram_chat_id = '-100123';
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/alert';

    const channels = await getAlertChannelStatus();

    expect(channels.find((channel) => channel.channel === 'telegram')).toEqual({
      channel: 'telegram',
      configured: true,
      reason: 'ok',
    });
    expect(channels.find((channel) => channel.channel === 'webhook')).toEqual({
      channel: 'webhook',
      configured: true,
      reason: 'ok',
    });
  });

  it('never echoes a credential in the status payload', async () => {
    mockAppSettings.alert_telegram_bot_token = '123:super-secret-token';
    mockAppSettings.alert_telegram_chat_id = '-100123';

    const serialized = JSON.stringify(await getAlertChannelStatus());

    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain('-100123');
  });
});

describe('sendOperationalAlert escalation', () => {
  it('logs ALL_ALERT_CHANNELS_FAILED when every configured channel fails', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/alert';
    const fetchMock = jest.fn(async () => ({ ok: false, status: 500, text: async () => 'nope' }));
    const originalFetch = global.fetch;
    (global as any).fetch = fetchMock;
    const errors: string[] = [];
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '));
    });

    try {
      const delivered = await sendOperationalAlert({
        event: 'source-watchdog',
        severity: 'critical',
        message: 'المصدر متوقف',
      });

      expect(delivered).toBe(false);
      expect(errors.some((line) => line.includes('ALL_ALERT_CHANNELS_FAILED'))).toBe(true);
      expect(errors.some((line) => line.includes('source-watchdog'))).toBe(true);
    } finally {
      errorSpy.mockRestore();
      (global as any).fetch = originalFetch;
    }
  });

  it('does not repeat a per-alert error when the email channel is simply disabled', async () => {
    mockAppSettings.alert_email = 'ops@dzhoof.local';
    readinessMock.mockResolvedValue({
      channel: 'email',
      provider: 'brevo',
      configured: false,
      reason: 'missing_credentials',
    });
    sendEmailMock.mockResolvedValue({ ok: false, error: 'ALERT_EMAIL_DISABLED', skipped: true });
    const errors: string[] = [];
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '));
    });

    try {
      await sendOperationalAlert({
        event: 'source-watchdog-disabled-email',
        severity: 'warning',
        message: 'تنبيه',
      });

      // The disabled state is reported once by the email service, not once per alert.
      expect(errors.some((line) => line.includes('[alert] email delivery failed'))).toBe(false);
      // But the alert still went nowhere, so the escalation is expected.
      expect(errors.some((line) => line.includes('ALL_ALERT_CHANNELS_FAILED'))).toBe(true);
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
