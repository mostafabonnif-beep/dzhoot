const express = require('express');
const router = express.Router();
const Channel = require('../models/Channel');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');

// Get all categories (derived from distinct channelGroup values)
router.get('/', requireTvOrSessionAuth, async (req, res) => {
  try {
    // Scope to what the caller can actually see: admin/demo → shared catalog (ownerId:null);
    // a user → their own selection. Mirrors GET /channels so counts line up.
    // TV clients (channelListCode) are served the shared catalog by /channels —
    // their personal `channels` array is empty, so categories must mirror the
    // catalog for them too, otherwise the category list comes back empty.
    const isAdmin = req.user.role === 'Admin' || req.user.allCatalog === true || Boolean(req.user.channelListCode);
    const { publicCatalogHideQuery, publicCatalogDedupQuery, cleanDisplayText } = require('../utils/catalog-presentation');
    const dedupMatch = req.user.role !== 'Admin' ? await publicCatalogDedupQuery() : {};
    // Demo callers must see only the curated groups, not the whole shared
    // catalog structure (which would leak every supplier group name + count).
    const DEMO_CHANNEL_GROUPS = (process.env.DEMO_CHANNEL_GROUPS || 'AR| ALGERIA الجزائر')
      .split(',').map((g) => g.trim()).filter(Boolean);
    const demoScope = req.user.demo === true ? { channelGroup: { $in: DEMO_CHANNEL_GROUPS } } : {};
    const match = isAdmin
      ? { isActive: { $ne: false }, ownerId: null, ...publicCatalogHideQuery(), ...dedupMatch, ...demoScope }
      : {
          isActive: { $ne: false },
          _id: { $in: (req.user.channels || []).filter(Boolean) },
          ...publicCatalogHideQuery(),
          ...dedupMatch,
          ...demoScope,
        };

    const groups = await Channel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$channelGroup',
          channel_count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Merge raw supplier groups that clean to the same display label (the
    // channel payloads carry the cleaned label too, so the sidebar group list
    // must mirror client-side grouping exactly — otherwise decorated variants
    // like "AR| BEIN SPORTS ᴮᴱ ⚽" show as phantom groups that never match).
    const mergedByName = new Map();
    for (const g of groups) {
      const rawGroup = g._id || '';
      const displayName = cleanDisplayText(rawGroup) || 'Uncategorized';
      const existing = mergedByName.get(displayName);
      if (existing) existing.channel_count += g.channel_count;
      else mergedByName.set(displayName, { channel_count: g.channel_count });
    }

    const categories = [...mergedByName.entries()].map(([name, meta], index) => ({
      id: name,
      name,
      display_order: index,
      channel_count: meta.channel_count,
    }));

    res.json({
      success: true,
      categories,
      total: categories.length,
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
    });
  }
});

module.exports = router;
