const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const Reseller = require('../models/Reseller');
const { audit, reqCtx } = require('../services/audit-log');

// Reseller portal login: /api/v1/reseller/auth/login
// Body: { username, password }

const RATE_LIMIT = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Sliding-window rate limiter keyed by a composite string (e.g. `user|ip`).
 * Keying by username alone lets an attacker lock any reseller out (DoS) and
 * bypass per-IP limits; keying by IP alone would throttle a shared café IP for
 * everyone. Composite gives both protections. Only FAILED attempts count, so
 * a reseller who logs in successfully as often as they like is never locked out.
 */
function isRateLimited(key) {
  const now = Date.now();
  const attempts = (RATE_LIMIT.get(key) || []).filter((t) => now - t < WINDOW_MS);
  return attempts.length >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  const now = Date.now();
  const attempts = (RATE_LIMIT.get(key) || []).filter((t) => now - t < WINDOW_MS);
  RATE_LIMIT.set(key, [...attempts, now]);
}

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'username and password are required' });
    }
    const usernameKey = String(username).trim().toLowerCase();
    const rateKey = `${usernameKey}|${req.ip || 'unknown'}`;
    if (isRateLimited(rateKey)) {
      return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
    }

    const reseller = await Reseller.findOne({ username: usernameKey }).select('+passwordHash').exec();
    if (!reseller || !reseller.passwordHash || !(await reseller.comparePassword(String(password)))) {
      recordFailure(rateKey);
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
    if (reseller.status !== 'Active') {
      return res.status(403).json({ success: false, error: 'Account is inactive' });
    }

    const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
    if (!ACCESS_SECRET) {
      console.error('JWT_ACCESS_SECRET not configured');
      return res.status(500).json({ success: false, error: 'Server configuration error' });
    }
    const token = jwt.sign(
      { sub: String(reseller._id), role: 'reseller' },
      ACCESS_SECRET,
      { algorithm: 'HS256', expiresIn: '24h' },
    );

    reseller.lastLoginAt = new Date();
    await reseller.save();

    audit({
      ...reqCtx(req),
      action: 'RESELLER_LOGIN',
      resource: 'Reseller',
      resourceId: String(reseller._id),
      changes: { after: { name: reseller.name } },
    });

    res.json({
      success: true,
      data: {
        token,
        reseller: {
          _id: reseller._id,
          name: reseller.name,
          city: reseller.city || '',
        },
      },
    });
  } catch (err) {
    console.error('[reseller-auth] login error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /change-password — reseller self-service password change.
// Body: { currentPassword, newPassword } (Bearer token auth).
// Rate-limited per reseller+IP: a stolen token shouldn't allow unlimited
// guessing of the current password.
const CHANGE_PW_LIMIT = new Map();
const CHANGE_PW_MAX = 5;
const CHANGE_PW_WINDOW_MS = 15 * 60 * 1000;

function changePwLimited(key) {
  const now = Date.now();
  const attempts = (CHANGE_PW_LIMIT.get(key) || []).filter((t) => now - t < CHANGE_PW_WINDOW_MS);
  if (attempts.length >= CHANGE_PW_MAX) return true;
  CHANGE_PW_LIMIT.set(key, [...attempts, now]);
  return false;
}

router.post('/change-password', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const [, token] = auth.split(' ');
    if (!token) return res.status(401).json({ success: false, error: 'Missing bearer token' });

    const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
    if (!ACCESS_SECRET) return res.status(500).json({ success: false, error: 'Server configuration error' });

    const payload = jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
    if (!payload || payload.role !== 'reseller' || !payload.sub) {
      return res.status(403).json({ success: false, error: 'Not a reseller account' });
    }

    const rateKey = `${payload.sub}|${req.ip || 'unknown'}`;
    if (changePwLimited(rateKey)) {
      return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
    }

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, error: 'newPassword must be at least 6 characters' });
    }
    if (String(currentPassword) === String(newPassword)) {
      return res.status(400).json({ success: false, error: 'New password must differ from the current one' });
    }

    const reseller = await Reseller.findById(payload.sub).select('+passwordHash').exec();
    if (!reseller || reseller.status !== 'Active') {
      return res.status(403).json({ success: false, error: 'Reseller account inactive or missing' });
    }
    if (!reseller.passwordHash || !(await reseller.comparePassword(String(currentPassword)))) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    reseller.passwordHash = String(newPassword); // pre('save') hashes it
    await reseller.save();

    audit({
      ...reqCtx(req),
      action: 'RESELLER_PASSWORD_CHANGE',
      resource: 'Reseller',
      resourceId: String(reseller._id),
      changes: { after: { name: reseller.name } },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[reseller-auth] change-password error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;