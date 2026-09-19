/**
 * Google reCAPTCHA verification, shared by every public registration path.
 *
 * `utils/registration-config.js` only *enables* open signup when reCAPTCHA is
 * configured — it is a capability gate, not an enforcement point. Both signup
 * handlers must therefore verify the token themselves. `POST /api/v1/auth/register`
 * did; `POST /api/v1/public/signup` did not, so bots could mass-register on that
 * route (each account comes back with a channel-list code and JWTs). Both routes
 * now call this helper.
 *
 * Policy: fail closed. A missing token, a rejected token, a low score and a
 * verification outage are all refusals. When no secret is configured the check
 * is skipped — but `publicRegistrationEnabled()` already refuses to open signup
 * in that state, so an unconfigured deployment never reaches this code.
 */
'use strict';

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
/** reCAPTCHA v3 scores below this are treated as bots. */
const MIN_SCORE = 0.5;

function recaptchaSecret() {
  return process.env.GOOGLE_RECAPTCHA_SECRET_KEY || '';
}

function recaptchaConfigured() {
  return Boolean(process.env.GOOGLE_RECAPTCHA_SITE_KEY && recaptchaSecret());
}

/**
 * Verify a reCAPTCHA token.
 *
 * @returns {Promise<{ok: boolean, skipped?: boolean, score?: number, reason?: string}>}
 *   `reason` is one of `missing_token`, `rejected`, `verification_unavailable`.
 */
async function verifyRecaptchaToken(token, remoteIp) {
  const secret = recaptchaSecret();
  if (!secret) return { ok: true, skipped: true };
  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, reason: 'missing_token' };
  }

  let data;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(remoteIp ? { remoteip: String(remoteIp) } : {}),
      }),
    });
    data = await res.json();
  } catch (error) {
    // Never open registration because Google's endpoint is unreachable.
    return { ok: false, reason: 'verification_unavailable', error };
  }

  const score = typeof data?.score === 'number' ? data.score : undefined;
  if (!data?.success) return { ok: false, reason: 'rejected', score };
  // v2 responses carry no score — only enforce the threshold when one is given.
  if (score !== undefined && score < MIN_SCORE) {
    return { ok: false, reason: 'rejected', score };
  }
  return { ok: true, score };
}

module.exports = { verifyRecaptchaToken, recaptchaConfigured, MIN_SCORE };
