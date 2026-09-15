import nodemailer, { Transporter } from 'nodemailer';
import Handlebars from 'handlebars';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
}

interface SendEmailOptions {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, string>;
}

// ---------------------------------------------------------------------------
// SMTP transporter (cached per config — rebuilt whenever settings change)
// ---------------------------------------------------------------------------

let transporter: Transporter | null = null;
let transporterConfigKey = '';

async function getTransporter(): Promise<Transporter> {
  const config = await getSmtpConfig();
  const key = JSON.stringify(config);
  // The panel can change brevo_user/brevo_password at runtime; a singleton
  // built from the first send would keep using stale credentials until the
  // process restarts. Rebuild whenever the resolved config actually changed.
  if (!transporter || key !== transporterConfigKey) {
    transporter = nodemailer.createTransport(config);
    transporterConfigKey = key;
  }
  return transporter;
}

/** Read one operator setting from AppSetting (admin panel) with env fallback. */
async function getSetting(key: string, envFallback: string): Promise<string> {
  try {
    const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
    const doc = await AppSetting.findOne({ key }).lean().exec();
    const fromDb = doc ? String(doc.value || '').trim() : '';
    if (fromDb) return fromDb;
  } catch {
    // fall through to env
  }
  return String(envFallback || '').trim();
}

async function getSmtpConfig(): Promise<SmtpConfig> {
  const provider = (process.env.MAIL_PROVIDER || 'mailhog').toLowerCase();

  if (provider === 'brevo') {
    const [user, pass] = await Promise.all([
      getSetting('brevo_user', process.env.BREVO_USER || ''),
      getSetting('brevo_password', process.env.BREVO_PASSWORD || ''),
    ]);
    return {
      host: process.env.BREVO_HOST || 'smtp-relay.brevo.com',
      port: parseInt(process.env.BREVO_PORT || '587', 10),
      secure: false, // STARTTLS
      auth: { user, pass },
    };
  }

  // mailhog (default)
  return {
    host: process.env.MAILHOG_HOST || 'localhost',
    port: parseInt(process.env.MAILHOG_PORT || '1025', 10),
    secure: false,
  };
}

/** Why the email channel is (not) usable. A code, never a value. */
export type EmailReadinessReason = 'ok' | 'dev_sink' | 'missing_credentials';

export interface EmailReadiness {
  channel: 'email';
  provider: string;
  /** True when `sendEmail` can realistically deliver. */
  configured: boolean;
  reason: EmailReadinessReason;
}

/**
 * Whether transactional email can actually be sent — without contacting the SMTP
 * server and without echoing any credential.
 *
 * Why this exists: on 2026-09-15 the scheduler logged
 * `[email] send failed: Missing credentials for "PLAIN"` for every alert and the
 * daily report while `/health` reported `alertingConfigured: true` (Telegram was
 * configured) and the report job still reported `completed`. The operator had no
 * way to see that the email channel was dead. This makes that state explicit and
 * greppable instead of inferring it from a stack of failed sends.
 */
export async function getEmailReadiness(): Promise<EmailReadiness> {
  const provider = (process.env.MAIL_PROVIDER || 'mailhog').toLowerCase();

  if (provider !== 'brevo') {
    // A MailHog/dev sink accepts mail without credentials, so sending still works —
    // it is just not a production channel. Reporting it as unusable would break
    // local development, so it stays "configured" with a distinct reason.
    return { channel: 'email', provider, configured: true, reason: 'dev_sink' };
  }

  const [user, pass] = await Promise.all([
    getSetting('brevo_user', process.env.BREVO_USER || ''),
    getSetting('brevo_password', process.env.BREVO_PASSWORD || ''),
  ]);
  const configured = Boolean(user && pass);
  return {
    channel: 'email',
    provider,
    configured,
    reason: configured ? 'ok' : 'missing_credentials',
  };
}

// A broken channel is a known state, not a per-send incident: log it once (and once
// more if the reason changes) instead of one line per alert.
let loggedEmailState = '';
function noteEmailUnusable(reason: EmailReadinessReason): void {
  if (loggedEmailState === reason) return;
  loggedEmailState = reason;
  console.warn(
    `[email] ALERT_EMAIL_DISABLED: the email channel cannot send (${reason}); ` +
      'operational alerts continue on the remaining channels',
  );
}

// ---------------------------------------------------------------------------
// Template loading & caching
// ---------------------------------------------------------------------------

// Templates are copied to dist/templates by `npm run build` locally, but the
// production Dockerfile builds with plain `tsc` and copies backend/src as
// runtime files — so dist/templates never exists in the image and EVERY
// system email silently failed (ENOENT). Resolve to src/templates as a
// fallback so email works regardless of how the image was built.
const DIST_TEMPLATE_DIR = path.resolve(__dirname, '../templates/email');
const SRC_TEMPLATE_DIR = path.resolve(__dirname, '../../src/templates/email');
const TEMPLATE_DIR = fs.existsSync(path.join(DIST_TEMPLATE_DIR, 'base.html'))
  ? DIST_TEMPLATE_DIR
  : SRC_TEMPLATE_DIR;
const templateCache = new Map<string, HandlebarsTemplateDelegate>();

let baseHtml: string | null = null;

function getBaseHtml(): string {
  if (!baseHtml) {
    baseHtml = fs.readFileSync(path.join(TEMPLATE_DIR, 'base.html'), 'utf-8');
  }
  return baseHtml;
}

function loadTemplate(name: string): HandlebarsTemplateDelegate {
  const cached = templateCache.get(name);
  if (cached) return cached;

  const bodyHtml = fs.readFileSync(path.join(TEMPLATE_DIR, `${name}.html`), 'utf-8');
  const fullHtml = getBaseHtml().replace('{{{body}}}', bodyHtml);
  const compiled = Handlebars.compile(fullHtml);
  templateCache.set(name, compiled);
  return compiled;
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

export async function sendEmail(opts: SendEmailOptions): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  // Refuse before touching the SMTP server when the channel cannot work: the attempt
  // would fail with a credentials error on every call and drown the log line the
  // operator actually needs (`ALERT_EMAIL_DISABLED`), and callers that ignore the
  // result would behave identically either way.
  try {
    // Inside the try on purpose: `sendEmail` promises never to throw, and a readiness
    // lookup must not be the one path that breaks that promise.
    const readiness = await getEmailReadiness();
    if (!readiness.configured) {
      noteEmailUnusable(readiness.reason);
      return { ok: false, error: 'ALERT_EMAIL_DISABLED', skipped: true };
    }

    const template = loadTemplate(opts.template);
    const html = template(opts.variables);
    const from = await getSetting('mail_from', process.env.MAIL_FROM || 'noreply@dzhoof.local');

    const transporter = await getTransporter();
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html,
    });
    return { ok: true };
  } catch (err) {
    console.error('[email] send failed:', (err as Error).message);
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers (fire-and-forget, never throw)
// ---------------------------------------------------------------------------

const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';

export function sendWelcomeEmail(to: string, vars: { username: string }): void {
  sendEmail({
    to,
    subject: 'Welcome to DZ HOOF',
    template: 'welcome',
    variables: {
      username: vars.username,
      loginUrl: `${APP_URL()}/login`,
    },
  }).catch((err: Error) => {
    console.error('[email] Failed to send welcome email:', err.message);
  });
}

export function sendVerificationEmail(
  to: string,
  vars: { username: string; verificationUrl: string },
): void {
  sendEmail({
    to,
    subject: 'Verify your email - DZ HOOF',
    template: 'verification',
    variables: {
      username: vars.username,
      verificationUrl: vars.verificationUrl,
      expiresIn: '24 hours',
    },
  }).catch((err: Error) => {
    console.error('[email] Failed to send verification email:', err.message);
  });
}

export function sendPasswordResetEmail(
  to: string,
  vars: { username: string; resetUrl: string },
): void {
  sendEmail({
    to,
    subject: 'Reset your password - DZ HOOF',
    template: 'password-reset',
    variables: {
      username: vars.username,
      resetUrl: vars.resetUrl,
      expiresIn: '1 hour',
    },
  }).catch((err: Error) => {
    console.error('[email] Failed to send password reset email:', err.message);
  });
}

module.exports = {
  sendEmail,
  getEmailReadiness,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
};
