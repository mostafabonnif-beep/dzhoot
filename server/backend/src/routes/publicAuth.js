const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const User = require('../models/User');
const { signAccessToken, signRefreshToken, persistRefreshToken } = require('../utils/jwtUtil');
const { sendVerificationEmail } = require('../services/email');
const { verifyRecaptchaToken } = require('../utils/recaptcha');

// Rate limiter for signup to mitigate abuse. `parseInt` always gets an explicit
// radix: without one an env value like `0x10` is read as hex (16 attempts).
const SIGNUP_RATE_LIMIT_MAX = Number.parseInt(process.env.SIGNUP_RATE_LIMIT_MAX || '10', 10);
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number.isFinite(SIGNUP_RATE_LIMIT_MAX) && SIGNUP_RATE_LIMIT_MAX > 0 ? SIGNUP_RATE_LIMIT_MAX : 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Basic validators.
//
// The previous shape regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) is ambiguous —
// its character classes also match '.' — so CodeQL flagged it as a polynomial
// ReDoS. This validator is length-bounded and uses only anchored, unambiguous
// character classes, so the work is linear in the input.
const EMAIL_LOCAL_MAX = 64;
const EMAIL_TOTAL_MAX = 254;
const EMAIL_LABEL = /^[A-Za-z0-9-]+$/;

function validateEmail(email) {
  if (typeof email !== 'string') return false;
  const value = email.trim();
  if (value.length < 6 || value.length > EMAIL_TOTAL_MAX) return false;
  if (/\s/.test(value)) return false;

  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local || local.length > EMAIL_LOCAL_MAX) return false;
  if (domain.includes('..')) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0 && label.length <= 63 && EMAIL_LABEL.test(label));
}

function validateUsername(username) {
  return /^[A-Za-z0-9_]{3,50}$/.test(username);
}

function validatePassword(pw) {
  if (typeof pw !== 'string') return false;
  return pw.length >= 8; // Could enhance with complexity checks later
}

// POST /api/v1/public/signup
router.post('/signup', signupLimiter, async (req, res) => {
  try {
    // Public self-service registration is disabled by default in production
    // (audit-remediation-v1) — same rule as /api/v1/auth/register.
    const { publicRegistrationEnabled } = require('../utils/registration-config');
    if (!publicRegistrationEnabled()) {
      return res.status(403).json({
        success: false,
        error: 'Registration is currently disabled. Please contact the administrator.',
      });
    }

    const { username, email, password, recaptchaToken } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'username, email, password required' });
    }
    if (!validateUsername(username)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid username (3-50 chars, alphanumeric + underscore)',
      });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }
    if (!validatePassword(password)) {
      return res
        .status(400)
        .json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Prevent creating reserved super admin username if defined
    const reserved = process.env.SUPER_ADMIN_USERNAME;
    if (reserved && username.toLowerCase() === reserved.toLowerCase()) {
      return res.status(403).json({ success: false, error: 'Username reserved' });
    }

    // reCAPTCHA: this route is the sibling of /api/v1/auth/register and used to
    // skip the check entirely, so an attacker could mass-register here and get a
    // channel-list code plus JWTs with no bot protection. Same helper, same rules.
    const captcha = await verifyRecaptchaToken(recaptchaToken, req.ip);
    if (!captcha.ok) {
      if (captcha.reason === 'missing_token') {
        return res.status(400).json({ success: false, error: 'reCAPTCHA verification is required' });
      }
      if (captcha.reason === 'verification_unavailable') {
        console.error('reCAPTCHA verification unavailable:', captcha.error?.message || captcha.error);
        return res
          .status(503)
          .json({ success: false, error: 'Registration is temporarily unavailable. Please try again later.' });
      }
      console.warn(`reCAPTCHA failed for public signup: score=${captcha.score}, IP: ${req.ip}`);
      return res.status(403).json({
        success: false,
        error: 'Registration blocked — suspected bot activity. Please try again.',
      });
    }

    // Uniqueness checks
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'Username or email already in use' });
    }

    // Generate channel list code
    const channelListCode = await User.generateChannelListCode();

    // Create user with role User only
    const user = new User({
      username,
      email,
      password,
      role: 'User',
      channelListCode,
      channels: [],
    });
    await user.save();

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = crypto
      .createHash('sha256')
      .update(verificationToken)
      .digest('hex');
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    // Fire-and-forget verification email (includes welcome content)
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const verificationUrl = `${appUrl}/verify-email?token=${verificationToken}`;
    sendVerificationEmail(email, { username, verificationUrl });

    // Issue JWT tokens
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    await persistRefreshToken(refreshToken, user, req);

    return res.status(201).json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        channelListCode: user.channelListCode,
        emailVerified: false,
      },
      tokens: { accessToken, refreshToken },
    });
  } catch (err) {
    console.error('Signup error', err);
    return res.status(500).json({ success: false, error: 'Signup failed' });
  }
});

module.exports = router;
