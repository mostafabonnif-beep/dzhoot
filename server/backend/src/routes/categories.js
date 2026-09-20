const express = require('express');
const router = express.Router();
const Channel = require('../models/Channel');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');

// Get all categories (derived from distinct channelGroup values)
router.get('/', requireTvOrSessionAuth, async (req, res) => {
  try {
    // Scope to what the caller can actually see: admin/allCatalog → shared catalog
    // (ownerId:null); every other caller → their own selection. This mirrors
    // GET /channels so counts line up.
    //
    // `channelListCode` is deliberately NOT part of the condition: it is a field on
    // every user document (models/User.ts marks it required), so testing it treated
    // every authenticated session as a catalog viewer — a user with zero channels
    // received the full group structure (383 groups observed in production) while
    // GET /channels correctly returned an empty selection.
    const catalogView = req.user.role === 'Admin' || req.user.allCatalog === true;
    const { publicCatalogHideQuery, publicCatalogDedupQuery, cleanDisplayText } = require('../utils/catalog-presentation');
    const dedupMatch = req.user.role !== 'Admin' ? await publicCatalogDedupQuery() : {};
    // Plan/free-tier group scope (freemium): a code limited to a set of groups
    // must not see the rest of the catalog's structure (which would leak every
    // supplier group name + count).
    const { groupScopeClause } = require('../services/channel-scope');
    const scopeClause = await groupScopeClause(req.user);
    const scopeMatch = scopeClause || {};
    const match = catalogView
      ? { isActive: { $ne: false }, ownerId: null, ...publicCatalogHideQuery(), ...dedupMatch, ...scopeMatch }
      : {
          isActive: { $ne: false },
          _id: { $in: (req.user.channels || []).filter(Boolean) },
          ...publicCatalogHideQuery(),
          ...dedupMatch,
          ...scopeMatch,
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
