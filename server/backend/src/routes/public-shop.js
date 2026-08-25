/**
 * Public shop endpoints — no auth.
 *
 * Powers the customer-facing landing/buy pages and the printed shop QR cards:
 *   GET /api/v1/shop/plans            active plans + brand + main WhatsApp
 *   GET /api/v1/shop/plans?shop=<id>  + the reseller's name/phone for QR cards
 */
const express = require('express');
const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const Reseller = require('../models/Reseller');
const AppSetting = require('../models/AppSetting');

const router = express.Router();

async function appSetting(key, fallback) {
  const doc = await AppSetting.findOne({ key }).lean();
  const v = doc?.value;
  return v === undefined || v === null || v === '' ? fallback : v;
}

router.get('/plans', async (req, res) => {
  try {
    const [plans, brand, whatsapp] = await Promise.all([
      Plan.find({ status: 'Active', price: { $gt: 0 } })
        .sort({ price: 1 })
        .select('name durationDays price')
        .lean(),
      appSetting('shop_brand', 'DZ HOOF'),
      appSetting('shop_whatsapp', ''),
    ]);

    const data = {
      brand,
      whatsapp,
      shop: null,
      plans: plans.map((p) => ({ _id: p._id, name: p.name, durationDays: p.durationDays, price: p.price ?? 0 })),
    };

    const shopId = req.query.shop ? String(req.query.shop).trim() : '';
    if (shopId && mongoose.Types.ObjectId.isValid(shopId)) {
      const reseller = await Reseller.findOne({ _id: shopId, status: 'Active' })
        .select('name phone')
        .lean();
      if (reseller) {
        data.shop = { name: reseller.name, phone: reseller.phone || '' };
      }
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[shop] plans error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
