const express = require('express');
const router = express.Router();

// Get public configuration defaults
router.get('/defaults', async (req, res) => {
  try {
    // Only expose a code from an explicit, dedicated demo/public env var.
    // Never fall back to a real Admin account's channelListCode (a live credential).
    const defaultTvCode = process.env.DEFAULT_TV_CODE || process.env.DEMO_CHANNEL_LIST_CODE || '';

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
