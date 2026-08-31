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

/**
 * Alert email recipient: AppSetting `alert_email` (admin panel) → env
 * `ALERT_EMAIL` → first active Admin user's email. Empty string = no email
 * channel. The daily ops report already mails active Admins, so this keeps
 * source-down alerts on the same working Brevo path.
 */
async function getAlertEmail(): Promise<string> {
  try {
    const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
    const doc = await AppSetting.findOne({ key: 'alert_email' }).lean().exec();
    const fromDb = doc ? String(doc.value || '').trim() : '';
    if (fromDb) return fromDb;
  } catch {
    // fall through
  }
  const fromEnv = String(process.env.ALERT_EMAIL || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const User = require('../models/User').default || require('../models/User');
    const admin = await User.findOne({ role: 'Admin', isActive: true }).select('email').lean().exec();
    if (admin && admin.email) return String(admin.email).trim();
  } catch {
    // fall through
  }
  return '';
}

export async function sendOperationalAlert(payload: AlertPayload): Promise<boolean> {
  let webhookUrl = await getWebhookUrl();
  const alertEmail = await getAlertEmail();
  if (!webhookUrl && !alertEmail) return false;

  const key = `${payload.event}:${payload.severity}`;
  const now = Date.now();
  const previous = lastSentAt.get(key) || 0;
  if (now - previous < getCooldownMs()) return false;

  const safeMessage = redactSensitiveText(payload.message);
  let delivered = false;

  // Channel 1: webhook (if configured). A broken webhook must not silence email.
  if (webhookUrl) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(webhookUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) parsed = null;
    } catch {
      parsed = null;
    }
    if (!parsed) {
      console.error('[alert] ALERT_WEBHOOK_URL is invalid — skipping webhook channel');
      webhookUrl = '';
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(parsed, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            message: safeMessage,
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
        if (response.ok) delivered = true;
        else console.error(`[alert] webhook returned HTTP ${response.status}`);
      } catch (error: any) {
        console.error(`[alert] webhook delivery failed: ${redactSensitiveText(error?.message || error)}`);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  // Channel 2: email to the operator (same Brevo path as the daily report).
  if (alertEmail && !delivered) {
    try {
      const { sendEmail } = require('./email');
      const res = await sendEmail({
        to: alertEmail,
        subject: `[DZ HOOF] تنبيه المصادر: ${payload.severity === 'critical' ? 'حرج' : 'تحذير'} — ${payload.event}`,
        template: 'source-alert',
        variables: {
          event: payload.event,
          severity: payload.severity,
          message: safeMessage,
          time: new Date(now).toISOString(),
        },
      });
      if (res.ok) delivered = true;
      else console.error(`[alert] email delivery failed: ${redactSensitiveText(res.error || '')}`);
    } catch (error: any) {
      console.error(`[alert] email channel error: ${redactSensitiveText(error?.message || error)}`);
    }
  }

  if (delivered) lastSentAt.set(key, now);
  return delivered;
}

export function clearAlertCooldowns(): void {
  lastSentAt.clear();
}

module.exports = { sendOperationalAlert, clearAlertCooldowns };
