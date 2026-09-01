'use strict';

// Admin control for the customer channel-list ordering: which countries come
// first (e.g. DZ → AR → FR → …) and which categories come first (رياضة →
// أفلام ومسلسلات → …). Stored in AppSetting (`catalog_country_priority` /
// `catalog_category_priority`), applied live by catalog-presentation with an
// env fallback. GET returns the CURRENT effective ordering + the available
// options; PUT persists a new ordering (empty list = clear → env/default).

const express = require('express');
const router = express.Router();
const AppSetting = require('../models/AppSetting');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx } = require('../services/audit-log');
const {
  getCatalogOrdering,
  refreshCatalogOrdering,
  REGION_LABELS,
  CATEGORY_LABELS,
} = require('../utils/catalog-presentation');

router.use(requireAuth);
router.use(requireAdmin);

function countryOptions() {
  return Object.entries(REGION_LABELS).map(([code, label]) => ({ code, label }));
}

// GET / — effective ordering + available options
router.get('/', async (req, res) => {
  try {
    const current = await getCatalogOrdering();
    return res.json({
      success: true,
      data: {
        countryPriority: current.countryPriority,
        categoryPriority: current.categoryPriority,
        availableCountries: countryOptions(),
        availableCategories: CATEGORY_LABELS,
        refreshMs: 60_000,
      },
    });
  } catch (err) {
    console.error('[catalog-ordering] read error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PUT / — save ordering. Body: { countryPriority?: string[], categoryPriority?: string[] }
// Empty array (or key omitted) = clear the panel override for that axis.
router.put('/', async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    const hasCountry = Array.isArray(body.countryPriority);
    const hasCategory = Array.isArray(body.categoryPriority);
    if (!hasCountry && !hasCategory) {
      return res.status(400).json({ success: false, error: 'Provide countryPriority and/or categoryPriority arrays' });
    }

    const saved = {};
    for (const [key, rawValue, upper] of [
      ['catalog_country_priority', body.countryPriority, true],
      ['catalog_category_priority', body.categoryPriority, false],
    ]) {
      if (!Array.isArray(rawValue)) continue;
      const value = rawValue
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
        .map((v) => (upper ? v.toUpperCase() : v));
      // De-duplicate while preserving order.
      const unique = [...new Set(value)];
      if (unique.length === 0) {
        await AppSetting.deleteOne({ key }).exec();
        saved[key] = [];
        continue;
      }
      const doc = await AppSetting.findOneAndUpdate(
        { key },
        { $set: { value: unique, updatedBy: req.user.id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).exec();
      saved[key] = doc.value;
    }

    // Apply immediately (next customer requests see the new order).
    await refreshCatalogOrdering();
    const current = await getCatalogOrdering();

    audit({
      ...reqCtx(req),
      action: 'CATALOG_ORDERING_UPDATE',
      resource: 'AppSetting',
      changes: { after: saved },
    });
    return res.json({ success: true, data: current });
  } catch (err) {
    console.error('[catalog-ordering] update error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
