import {
  clearAlertCooldowns,
  sendOperationalAlert,
} from './alert-notifier';

describe('operational alert notifier', () => {
  const originalWebhook = process.env.ALERT_WEBHOOK_URL;
  const originalCooldown = process.env.ALERT_WEBHOOK_COOLDOWN_MS;

  afterEach(() => {
    clearAlertCooldowns();
    if (originalWebhook === undefined) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = originalWebhook;
    if (originalCooldown === undefined) delete process.env.ALERT_WEBHOOK_COOLDOWN_MS;
    else process.env.ALERT_WEBHOOK_COOLDOWN_MS = originalCooldown;
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
});
