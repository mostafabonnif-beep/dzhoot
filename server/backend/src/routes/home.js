const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AppSetting = require('../models/AppSetting');
const Channel = require('../models/Channel');
const Movie = require('../models/Movie');
const Series = require('../models/Series');
const { optionalAuth } = require('../middleware/resolveUser');
const { getContentScope, idsFor, applyScopeFilter } = require('../services/content-access');

// Dynamic home: /api/v1/home
// Sections are configured by the admin through AppSetting 'home':
//   { featuredChannelIds: [], featuredMovieIds: [], featuredSeriesIds: [] }
router.use(optionalAuth);

router.get('/', async (req, res) => {
  try {
    const setting = await AppSetting.findOne({ key: 'home' }).lean();
    const cfg = setting?.value || {};
    const scope = await getContentScope(req.user);

    const scopeIds = (type) => idsFor(scope, type);
    const visibleFeaturedIds = (ids, type) => {
      const allowed = scopeIds(type);
      return allowed === null ? ids : ids.filter((id) => allowed.includes(String(id)));
    };

    const channelIds = visibleFeaturedIds(
      (cfg.featuredChannelIds || []).filter((x) => mongoose.Types.ObjectId.isValid(x)),
      'channel',
    );
    const movieIds = visibleFeaturedIds(
      (cfg.featuredMovieIds || []).filter((x) => mongoose.Types.ObjectId.isValid(x)),
      'movie',
    );
    const seriesIds = visibleFeaturedIds(
      (cfg.featuredSeriesIds || []).filter((x) => mongoose.Types.ObjectId.isValid(x)),
      'series',
    );

    const [featuredChannels, featuredMovies, featuredSeries] = await Promise.all([
      channelIds.length
        ? Channel.find({ _id: { $in: channelIds }, isActive: { $ne: false } }).limit(20).lean()
        : [],
      movieIds.length
        ? Movie.find({ _id: { $in: movieIds }, isActive: true }).limit(20).lean()
        : [],
      seriesIds.length
        ? Series.find({ _id: { $in: seriesIds }, isActive: true }).limit(20).lean()
        : [],
    ]);

    const latestMovieFilter = applyScopeFilter({ isActive: true }, scope, 'movie');
    const latestSeriesFilter = applyScopeFilter({ isActive: true }, scope, 'series');
    const [latestMovies, latestSeries] = await Promise.all([
      Movie.find(latestMovieFilter).sort({ createdAt: -1 }).limit(12).lean(),
      Series.find(latestSeriesFilter).sort({ createdAt: -1 }).limit(12).lean(),
    ]);

    return res.json({
      success: true,
      data: {
        featuredChannels: featuredChannels.map((c) => ({
          _id: c._id,
          type: 'LIVE',
          name: c.channelName,
          logo: c.channelImg,
          group: c.channelGroup,
        })),
        featuredMovies: featuredMovies.map((m) => ({
          _id: m._id,
          type: 'MOVIE',
          name: m.title,
          poster: m.poster,
          category: m.category,
        })),
        featuredSeries: featuredSeries.map((s) => ({
          _id: s._id,
          type: 'SERIES',
          name: s.title,
          poster: s.poster,
          category: s.category,
        })),
        latestMovies: latestMovies.map((m) => ({
          _id: m._id,
          type: 'MOVIE',
          name: m.title,
          poster: m.poster,
          category: m.category,
        })),
        latestSeries: latestSeries.map((s) => ({
          _id: s._id,
          type: 'SERIES',
          name: s.title,
          poster: s.poster,
          category: s.category,
        })),
      },
    });
  } catch (err) {
    console.error('[home] error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
