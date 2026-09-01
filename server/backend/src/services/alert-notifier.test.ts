import {
  clearAlertCooldowns,
  sendOperationalAlert,
} from './alert-notifier';
import User from '../models/User';

describe('operational alert notifier', () => {
  const originalWebhook = process.env.ALERT_WEBHOOK_URL;
  const originalCooldown = process.env.ALERT_WEBHOOK_COOLDOWN_MS;
  const originalTgToken = process.env.ALERT_TELEGRAM_BOT_TOKEN;
  const originalTgChat = process.env.ALERT_TELEGRAM_CHAT_ID;

  afterEach(() => {
    clearAlertCooldowns();
    if (originalWebhook === undefined) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = originalWebhook;
    if (originalCooldown === undefined) delete process.env.ALERT_WEBHOOK_COOLDOWN_MS;
    else process.env.ALERT_WEBHOOK_COOLDOWN_MS = originalCooldown;
    if (originalTgToken === undefined) delete process.env.ALERT_TELEGRAM_BOT_TOKEN;
    else process.env.ALERT_TELEGRAM_BOT_TOKEN = originalTgToken;
    if (originalTgChat === undefined) delete process.env.ALERT_TELEGRAM_CHAT_ID;
    else process.env.ALERT_TELEGRAM_CHAT_ID = originalTgChat;
    jest.restoreAllMocks();
  });

  it('does nothing when webhook delivery is not configured', async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    await expect(sendOperationalAlert({
      event: 'test:missing',
      severity: 'warning',
      message: 'No webhook configured',
    })).resolves.toBe(false);
  });

  it('emails an active admin when no webhook is configured', async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    await User.create({
      username: 'admin-test', email: 'admin@dzhoof.local', password: 'password123',
      role: 'Admin', isActive: true, channelListCode: 'ALERTTEST',
    });
    const emailMock = jest.fn().mockResolvedValue({ ok: true });
    jest.doMock('./email', () => ({ sendEmail: emailMock }));

    await expect(sendOperationalAlert({
      event: 'xtream-source-down',
      severity: 'critical',
      message: 'مصدر Business Cloud NEO متوقف',
    })).resolves.toBe(true);

    expect(emailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'admin@dzhoof.local',
      template: 'source-alert',
    }));
    jest.unmock('./email');
  });

  it('redacts sensitive values and suppresses duplicate alerts during cooldown', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://monitoring.example.test/hook';
    process.env.ALERT_WEBHOOK_COOLDOWN_MS = '60000';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);

    const payload = {
      event: 'sync:failure',
      severity: 'critical' as const,
      message: 'source failed password=very-secret url=https://user:pass@example.test/live.m3u8',
      details: { error: 'token=secret-value' },
    };
    await expect(sendOperationalAlert(payload)).resolves.toBe(true);
    await expect(sendOperationalAlert(payload)).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.message).not.toContain('very-secret');
    expect(body.message).not.toContain('user:pass@example.test');
    expect(body.details.error).not.toContain('secret-value');
  });

  it('sends operational alerts to Telegram when bot token and chat id are configured', async () => {
    process.env.ALERT_TELEGRAM_BOT_TOKEN = '123456:TEST-BOT-TOKEN';
    process.env.ALERT_TELEGRAM_CHAT_ID = '987654321';
    process.env.ALERT_WEBHOOK_COOLDOWN_MS = '0';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);

    await expect(sendOperationalAlert({
      event: 'xtream-source-down',
      severity: 'critical',
      message: 'مصدر NEO متوقف',
    })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.telegram.org/bot123456:TEST-BOT-TOKEN/sendMessage');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.chat_id).toBe('987654321');
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toContain('DZ HOOF');
    expect(body.text).toContain('xtream-source-down');
    expect(body.text).toContain('مصدر NEO متوقف');
  });

  it('does not send Telegram alerts when only the token (or only the chat id) is set', async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    process.env.ALERT_TELEGRAM_BOT_TOKEN = '123456:TEST-BOT-TOKEN';
    delete process.env.ALERT_TELEGRAM_CHAT_ID;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);
    await expect(sendOperationalAlert({
      event: 'test:no-chat',
      severity: 'warning',
      message: 'no chat',
    })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
