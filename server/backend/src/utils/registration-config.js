/**
 * Central registration / auth-provider capability flags (audit-remediation-v1).
 *
 * PUBLIC_REGISTRATION_ENABLED is the master switch for open signup. Even when
 * set to 'true' it only takes effect if BOTH an effective email provider and
 * reCAPTCHA are configured — otherwise the "open" signup would hand out free
 * channel-list codes with no bot protection and no way to verify users.
 */
'use strict';

function mailConfigured() {
  const provider = String(process.env.MAIL_PROVIDER || '').trim().toLowerCase();
  if (provider === 'brevo') {
    return Boolean(process.env.BREVO_USER && process.env.BREVO_PASSWORD);
  }
  // Anything other than an explicit, credential-backed provider is treated as
  // unconfigured for production purposes (mailhog/localhost default).
  return false;
}

function recaptchaConfigured() {
  return Boolean(
    process.env.GOOGLE_RECAPTCHA_SITE_KEY && process.env.GOOGLE_RECAPTCHA_SECRET_KEY,
  );
}

function googleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function githubOAuthConfigured() {
  return Boolean(process.env.GH_OAUTH_CLIENT_ID && process.env.GH_OAUTH_CLIENT_SECRET);
}

function publicRegistrationEnabled() {
  const flag = String(process.env.PUBLIC_REGISTRATION_ENABLED || '')
    .trim()
    .toLowerCase();
  if (flag !== 'true') return false;

  const mailOk = mailConfigured();
  const captchaOk = recaptchaConfigured();
  if (!mailOk || !captchaOk) {
    console.warn(
      `[registration] PUBLIC_REGISTRATION_ENABLED=true but required protection is missing ` +
        `(mailConfigured=${mailOk}, recaptchaConfigured=${captchaOk}) — registration stays disabled`,
    );
    return false;
  }
  return true;
}

module.exports = {
  mailConfigured,
  recaptchaConfigured,
  googleOAuthConfigured,
  githubOAuthConfigured,
  publicRegistrationEnabled,
};
