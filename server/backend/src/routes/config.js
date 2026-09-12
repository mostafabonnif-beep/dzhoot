const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Shared guard for public demo/TV codes. Mirrors the DEMO_TV_CODE validation in
// server.js (same minimum length and placeholder patterns) so both entry points
// apply identical strength rules instead of drifting apart.
const DEMO_CODE_MIN_LENGTH = 16;
const DEMO_CODE_PLACEHOLDER_PREFIX = /^(demo|change[-_]?me|test|default)/i;
const DEMO_CODE_PLACEHOLDER_SUBSTRINGS = ['example.com', 'your-', 'changeme', 'change-me', 'change_me'];

function isSafePublicDemoCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return false;
  if (code.length < DEMO_CODE_MIN_LENGTH) return false;
  if (DEMO_CODE_PLACEHOLDER_PREFIX.test(code)) return false;
  const lower = code.toLowerCase();
  if (DEMO_CODE_PLACEHOLDER_SUBSTRINGS.some((needle) => lower.includes(needle))) return false;
  return true;
}

/**
 * Returns a demo code that is safe to serve from an unauthenticated endpoint, or
 * '' when none may be served. Beyond the format/placeholder guard it refuses any
 * value that equals a real User.channelListCode (a live credential) — a
 * placeholder-looking env var must never hand out a real account's code.
 * The collision check is fail-closed: if it cannot run, the code is not served.
 */
async function resolvePublicDemoCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!isSafePublicDemoCode(code)) return '';
  try {
    const collision = await User.exists({ channelListCode: code.toUpperCase() });
    if (collision) {
      console.error(
        '[demo-code] refusing to serve a public demo code that matches a real user channelListCode',
      );
      return '';
    }
  } catch (error) {
    console.error(
      '[demo-code] credential-collision check failed; refusing to serve the demo code:',
      error?.message || error,
    );
    return '';
  }
  return code;
}


// Get public configuration defaults
router.get('/defaults', async (req, res) => {
  try {
    // Only expose a code from an explicit, dedicated demo/public env var, and
    // only after the strength/placeholder guard and the live-credential
    // collision check pass. Never fall back to a real Admin account's
    // channelListCode.
    const configuredDemoCode =
      process.env.DEFAULT_TV_CODE || process.env.DEMO_CHANNEL_LIST_CODE || '';
    const defaultTvCode = await resolvePublicDemoCode(configuredDemoCode);

    const {
      mailConfigured,
      recaptchaConfigured,
      googleOAuthConfigured,
      githubOAuthConfigured,
      publicRegistrationEnabled,
    } = require('../utils/registration-config');

    const defaults = {
      defaultTvCode,
      defaultServerUrl: process.env.DEFAULT_SERVER_URL || '',
      pairingPinExpiryMinutes: parseInt(process.env.PAIRING_PIN_EXPIRY_MINUTES || '10', 10),
      appName: 'DZ HOOF',
      version: process.env.APP_VERSION || '1.0.1',
      recaptchaSiteKey: process.env.GOOGLE_RECAPTCHA_SITE_KEY || null,
      // Capability flags drive UI visibility (audit-remediation-v1): features the
      // operator has not configured (OAuth providers, open registration, demo code)
      // are hidden instead of shown as broken buttons.
      registrationEnabled: publicRegistrationEnabled(),
      mailConfigured: mailConfigured(),
      recaptchaConfigured: recaptchaConfigured(),
      googleOAuthEnabled: googleOAuthConfigured(),
      githubOAuthEnabled: githubOAuthConfigured(),
    };

    res.json({
      success: true,
      data: defaults,
    });
  } catch (error) {
    console.error('Error fetching config defaults:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch configuration',
    });
  }
});

// Get server info (public endpoint)
router.get('/info', async (req, res) => {
  try {
    const info = {
      name: 'DZ HOOF Server',
      version: process.env.APP_VERSION || '1.0.1',
      status: 'online',
      features: {
        channelStreaming: true,
        pinBasedPairing: true,
        autoUpdates: true,
        userManagement: true,
      },
    };

    res.json({
      success: true,
      data: info,
    });
  } catch (error) {
    console.error('Error fetching server info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch server info',
    });
  }
});

module.exports = router;
module.exports.isSafePublicDemoCode = isSafePublicDemoCode;
module.exports.resolvePublicDemoCode = resolvePublicDemoCode;
