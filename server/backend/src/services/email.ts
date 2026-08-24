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
// SMTP transporter (singleton)
// ---------------------------------------------------------------------------

let transporter: Transporter | null = null;

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

async function getTransporter(): Promise<Transporter> {
  if (!transporter) {
    transporter = nodemailer.createTransport(await getSmtpConfig());
  }
  return transporter;
}

// ---------------------------------------------------------------------------
// Template loading & caching
// ---------------------------------------------------------------------------

const TEMPLATE_DIR = path.resolve(__dirname, '../templates/email');
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

export async function sendEmail(opts: SendEmailOptions): Promise<{ ok: boolean; error?: string }> {
  try {
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

module.exports = { sendEmail, sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail };
