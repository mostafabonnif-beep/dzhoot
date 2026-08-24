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

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'username and password are required' });
    }
    const key = String(username).trim().toLowerCase();
    const now = Date.now();
    const attempts = (RATE_LIMIT.get(key) || []).filter((t) => now - t < WINDOW_MS);
    if (attempts.length >= MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
    }

    const reseller = await Reseller.findOne({ username: key }).select('+passwordHash').exec();
    if (!reseller || !reseller.passwordHash || !(await reseller.comparePassword(String(password)))) {
      RATE_LIMIT.set(key, [...attempts, now]);
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

module.exports = router;
