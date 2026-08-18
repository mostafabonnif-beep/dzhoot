const express = require('express');
const router = express.Router();
const Series = require('../models/Series');
const Season = require('../models/Season');
const Episode = require('../models/Episode');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');
const { ensureSeriesSeasons, ensureSeasonEpisodes } = require('../services/xtream-service');
const {
  addSearchFilter,
  isValidObjectId,
  parsePagination,
} = require('./catalog-helpers');

router.get('/', requireTvOrSessionAuth, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const requestedStatus = String(req.query.status || 'active');
    const isAdmin = req.user?.role === 'Admin';
    const query = { isActive: requestedStatus === 'all' && isAdmin ? { $in: [true, false] } : requestedStatus === 'inactive' && isAdmin ? false : true };

    if (req.query.sourceId && isValidObjectId(String(req.query.sourceId))) {
      query.sourceId = String(req.query.sourceId);
    }
    if (req.query.category && String(req.query.category) !== 'All') {
      query.category = String(req.query.category).trim().slice(0, 100);
    }
    addSearchFilter(query, req.query.search);

    const [seriesList, total] = await Promise.all([
      Series.find(query).select('-streamUrl').sort({ title: 1 }).skip(skip).limit(limit).lean(),
      Series.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: seriesList,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error fetching series:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch series' });
  }
});

router.get('/categories', requireTvOrSessionAuth, async (_req, res) => {
  try {
    const categories = await Series.distinct('category', { isActive: true });
    return res.json({
      success: true,
      data: categories.filter(Boolean).map(String).sort((a, b) => a.localeCompare(b)),
    });
  } catch (error) {
    console.error('Error fetching series categories:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

router.get('/:id', requireTvOrSessionAuth, async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, error: 'Invalid series id' });
  }

  try {
    const series = await Series.findOne({ _id: req.params.id, isActive: true }).select('-streamUrl').lean();
    if (!series) {
      return res.status(404).json({ success: false, error: 'Series not found' });
    }

    let seasons = await Season.find({ seriesId: series._id }).sort({ seasonNumber: 1 }).lean();

    // Lazy seasons: if none are stored yet, fetch them (and episodes) from the
    // Xtream panel on demand for admins. Best-effort.
    if (seasons.length === 0 && req.user?.role === 'Admin') {
      try {
        const fetched = await ensureSeriesSeasons(String(series._id));
        if (fetched.length > 0) {
          seasons = fetched;
        } else {
          return res.json({ success: true, data: { ...series, seasons: [], lazyError: 'لا توجد مواسم متاحة من المصدر.' } });
        }
      } catch (err) {
        console.warn(`[series] lazy seasons fetch failed for series ${series._id}:`, err.message);
        return res.json({ success: true, data: { ...series, seasons: [], lazyError: 'تعذر جلب المواسم من المصدر الآن. تحقق من حالة المصدر.' } });
      }
    }

    return res.json({ success: true, data: { ...series, seasons } });
  } catch (error) {
    console.error('Error fetching series detail:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch series detail' });
  }
});

router.get('/seasons/:seasonId/episodes', requireTvOrSessionAuth, async (req, res) => {
  if (!isValidObjectId(req.params.seasonId)) {
    return res.status(400).json({ success: false, error: 'Invalid season id' });
  }

  try {
    const season = await Season.findById(req.params.seasonId).select('_id seriesId').lean();
    if (!season) {
      return res.status(404).json({ success: false, error: 'Season not found' });
    }
    const series = await Series.findOne({ _id: season.seriesId, isActive: true }).select('_id').lean();
    if (!series) {
      return res.status(404).json({ success: false, error: 'Series not found' });
    }
    let episodes = await Episode.find({ seasonId: season._id, seriesId: season.seriesId })
      .select('-streamUrl')
      .sort({ episodeNumber: 1 })
      .lean();

    // Lazy episodes: if this season has none stored yet and the requester is an
    // admin, fetch them from the panel on demand (fast for a single series),
    // persist, and re-query. Best-effort — a blocked source returns an empty
    // list with an explanatory flag instead of failing the request.
    if (episodes.length === 0 && req.user?.role === 'Admin') {
      try {
        const stored = await ensureSeasonEpisodes(String(season._id));
        if (stored > 0) {
          episodes = await Episode.find({ seasonId: season._id, seriesId: season.seriesId })
            .select('-streamUrl')
            .sort({ episodeNumber: 1 })
            .lean();
        }
      } catch (err) {
        console.warn(`[series] lazy episodes fetch failed for season ${season._id}:`, err.message);
        return res.json({
          success: true,
          data: [],
          lazyError: 'تعذر جلب الحلقات من المصدر الآن. تحقق من حالة المصدر.',
        });
      }
    }

    return res.json({ success: true, data: episodes });
  } catch (error) {
    console.error('Error fetching episodes:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch episodes' });
  }
});

module.exports = router;
