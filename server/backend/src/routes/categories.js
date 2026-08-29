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
    const { publicCatalogHideQuery, publicCatalogDedupQuery } = require('../utils/catalog-presentation');
    const dedupMatch = req.user.role !== 'Admin' ? await publicCatalogDedupQuery() : {};
    const match = isAdmin
      ? { isActive: { $ne: false }, ownerId: null, ...publicCatalogHideQuery(), ...dedupMatch }
      : {
          isActive: { $ne: false },
          _id: { $in: (req.user.channels || []).filter(Boolean) },
          ...publicCatalogHideQuery(),
          ...dedupMatch,
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

    const categories = groups.map((g, index) => ({
      id: g._id || 'uncategorized',
      name: g._id || 'Uncategorized',
      display_order: index,
      channel_count: g.channel_count,
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
