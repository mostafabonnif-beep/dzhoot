const express = require('express');
const router = express.Router();
const Channel = require('../models/Channel');
const { channelCache } = require('../services/cache');
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
    const { verifiedXtreamChannelQuery } = require('../utils/verified-channel-query');
    const dedupMatch = req.user.role !== 'Admin' ? await publicCatalogDedupQuery() : {};
    // Plan/free-tier group scope (freemium): a code limited to a set of groups
    // must not see the rest of the catalog's structure (which would leak every
    // supplier group name + count).
    const { groupScopeClause } = require('../services/channel-scope');
    const scopeClause = await groupScopeClause(req.user);
    const scopeMatch = scopeClause || {};
    // The caller-specific restriction is applied LAST, after the shared filters, and that
    // order is load-bearing: `publicCatalogDedupQuery()` returns `{ _id: { $nin: [...] } }`
    // whenever the catalog has duplicates to hide (i.e. in production, always), and an
    // object spread of that over a selection `_id` silently REPLACES it. That is how a user
    // with zero channels kept reading the whole catalog's group structure — measured live on
    // 2026-09-20: 192 groups for an account whose `GET /channels` returned count 0.
    const selectionFilter = catalogView
      ? { ownerId: null }
      : { _id: { $in: (req.user.channels || []).filter(Boolean) } };
    const scopeFilter = {
      ...publicCatalogHideQuery(),
      ...dedupMatch,
      ...scopeMatch,
      ...selectionFilter,
    };
    // The health gate belongs here too: without it the rail advertised groups whose
    // channels the list endpoint refuses to serve, so the counts could not line up with
    // GET /channels (which this endpoint's own comment promises) and the customer could
    // open a group only to find dead or unavailable entries in it.
    const match = await verifiedXtreamChannelQuery(scopeFilter, {
      dedup: req.user.role !== 'Admin',
    });

    // The rail is the same aggregation over the same ~32k rows for every caller that
    // sees the whole catalog, and it is not cheap: measured on production 2026-09-20 at
    // ~91 ms (78-118 ms) per call, on a path every dashboard/discover load hits. Cache it
    // exactly like the list endpoint does, and only for the shared-catalog view.
    //
    // The key carries the dedup dimension because the payload differs with it (admins get
    // the raw catalog, everyone else the deduplicated one). Sharing one key across both is
    // how the list cache ended up serving whichever flavour warmed it first — see the
    // matching fix in routes/channels.js.
    const dedupApplied = req.user.role !== 'Admin';
    const cacheable = catalogView && !scopeClause;
    const cacheKey = `catalog:categories:presentation-v1:${dedupApplied ? 'dedup' : 'raw'}`;
    if (cacheable) {
      const cached = await channelCache.get(cacheKey);
      if (cached) return res.json(cached);
    }

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

    const payload = {
      success: true,
      categories,
      total: categories.length,
    };

    // Same guard as the read above; `catalog:*` invalidation (channel/xtream mutations,
    // the health watchdog, admin edits) already clears this key with the other catalog caches.
    if (cacheable) await channelCache.set(cacheKey, payload);

    res.json(payload);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
    });
  }
});

module.exports = router;
