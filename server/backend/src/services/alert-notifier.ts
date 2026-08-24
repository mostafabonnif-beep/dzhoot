import { redactSensitiveText } from './audit-log';

const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const lastSentAt = new Map<string, number>();

export interface AlertPayload {
  event: string;
  severity: 'warning' | 'critical';
  message: string;
  details?: Record<string, unknown>;
}

function getCooldownMs(): number {
  const configured = Number.parseInt(process.env.ALERT_WEBHOOK_COOLDOWN_MS || '', 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_COOLDOWN_MS;
}

/** Webhook URL: AppSetting (set from the admin panel) with env fallback. */
async function getWebhookUrl(): Promise<string> {
  try {
    const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
    const doc = await AppSetting.findOne({ key: 'alert_webhook_url' }).lean().exec();
    const fromDb = doc ? String(doc.value || '').trim() : '';
    if (fromDb) return fromDb;
  } catch {
    // fall through to env
  }
  return String(process.env.ALERT_WEBHOOK_URL || '').trim();
}

export async function sendOperationalAlert(payload: AlertPayload): Promise<boolean> {
  const webhookUrl = await getWebhookUrl();
  if (!webhookUrl) return false;

  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  } catch {
    console.error('[alert] ALERT_WEBHOOK_URL is invalid');
    return false;
  }

  const key = `${payload.event}:${payload.severity}`;
  const now = Date.now();
  const previous = lastSentAt.get(key) || 0;
  if (now - previous < getCooldownMs()) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(parsed, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        message: redactSensitiveText(payload.message),
        details: payload.details
          ? Object.fromEntries(
              Object.entries(payload.details).map(([key, value]) => [
                key,
                typeof value === 'string' ? redactSensitiveText(value) : value,
              ]),
            )
          : undefined,
        sentAt: new Date(now).toISOString(),
        service: 'dzhoot-backend',
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`[alert] webhook returned HTTP ${response.status}`);
      return false;
    }
    lastSentAt.set(key, now);
    return true;
  } catch (error: any) {
    console.error(`[alert] webhook delivery failed: ${redactSensitiveText(error?.message || error)}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function clearAlertCooldowns(): void {
  lastSentAt.clear();
}

module.exports = { sendOperationalAlert, clearAlertCooldowns };
