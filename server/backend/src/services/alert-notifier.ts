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

/** Telegram bot token: AppSetting `alert_telegram_bot_token` → env fallback. */
async function getTelegramBotToken(): Promise<string> {
  try {
    const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
    const doc = await AppSetting.findOne({ key: 'alert_telegram_bot_token' }).lean().exec();
    const fromDb = doc ? String(doc.value || '').trim() : '';
    if (fromDb) return fromDb;
  } catch {
    // fall through
  }
  return String(process.env.ALERT_TELEGRAM_BOT_TOKEN || '').trim();
}

/** Telegram chat id: AppSetting `alert_telegram_chat_id` → env fallback. */
async function getTelegramChatId(): Promise<string> {
  try {
    const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
    const doc = await AppSetting.findOne({ key: 'alert_telegram_chat_id' }).lean().exec();
    const fromDb = doc ? String(doc.value || '').trim() : '';
    if (fromDb) return fromDb;
  } catch {
    // fall through
  }
  return String(process.env.ALERT_TELEGRAM_CHAT_ID || '').trim();
}

const TELEGRAM_MSG_LIMIT = 4000;
function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTelegramText(payload: AlertPayload, now: Date): string {
  const severityIcon = payload.severity === 'critical' ? '🚨' : '⚠️';
  const severityLabel = payload.severity === 'critical' ? 'حرج' : 'تحذير';
  const lines = [
    `${severityIcon} <b>DZ HOOF — ${severityLabel}</b>`,
    '',
    `<b>الحدث:</b> ${escapeTelegramHtml(payload.event)}`,
    `<b>الرسالة:</b> ${escapeTelegramHtml(payload.message)}`,
    `<b>الوقت:</b> ${now.toISOString()}`,
  ];
  if (payload.details && Object.keys(payload.details).length > 0) {
    const detailText = Object.entries(payload.details)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join('\n')
      .slice(0, 800);
    lines.push('', `<b>التفاصيل:</b>\n${escapeTelegramHtml(detailText)}`);
  }
  return lines.join('\n').slice(0, TELEGRAM_MSG_LIMIT);
}

export async function sendOperationalAlert(payload: AlertPayload): Promise<boolean> {
  let webhookUrl = await getWebhookUrl();
  const alertEmail = await getAlertEmail();
  const telegramToken = await getTelegramBotToken();
  const telegramChatId = await getTelegramChatId();
  if (!webhookUrl && !alertEmail && !(telegramToken && telegramChatId)) return false;

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

  // Channel 3: Telegram (bot token + chat id from the admin panel). HTML
  // formatting, right-to-left friendly, truncated to Telegram's limit.
  if (telegramToken && telegramChatId && !delivered) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: formatTelegramText(payload, new Date(now)),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
      if (response.ok) delivered = true;
      else {
        const body = await response.text().catch(() => '');
        console.error(`[alert] telegram returned HTTP ${response.status}: ${redactSensitiveText(body.slice(0, 200))}`);
      }
    } catch (error: any) {
      console.error(`[alert] telegram channel error: ${redactSensitiveText(error?.message || error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (delivered) lastSentAt.set(key, now);
  return delivered;
}

export function clearAlertCooldowns(): void {
  lastSentAt.clear();
}

module.exports = { sendOperationalAlert, clearAlertCooldowns };
