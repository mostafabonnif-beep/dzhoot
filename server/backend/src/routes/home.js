const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AppSetting = require('../models/AppSetting');
const Channel = require('../models/Channel');
const Movie = require('../models/Movie');
const Series = require('../models/Series');
const { optionalAuth } = require('../middleware/resolveUser');
const { sanitizeManagedContent } = require('../utils/playback-security');

// Dynamic home: /api/v1/home
// Sections are configured by the admin through AppSetting 'home':
//   { featuredChannelIds: [], featuredMovieIds: [], featuredSeriesIds: [] }
router.use(optionalAuth);

router.get('/', async (req, res) => {
  try {
    const setting = await AppSetting.findOne({ key: 'home' }).lean();
    const cfg = setting?.value || {};

    const channelIds = (cfg.featuredChannelIds || []).filter((x) => mongoose.Types.ObjectId.isValid(x));
    const movieIds = (cfg.featuredMovieIds || []).filter((x) => mongoose.Types.ObjectId.isValid(x));
    const seriesIds = (cfg.featuredSeriesIds || []).filter((x) => mongoose.Types.ObjectId.isValid(x));

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

    const [latestMovies, latestSeries] = await Promise.all([
      Movie.find({ isActive: true }).sort({ createdAt: -1 }).limit(12).lean(),
      Series.find({ isActive: true }).sort({ createdAt: -1 }).limit(12).lean(),
    ]);

    return res.json({
      success: true,
      data: {
        featuredChannels: featuredChannels.map((c) => sanitizeManagedContent(c, 'LIVE', req)),
        featuredMovies: featuredMovies.map((m) => sanitizeManagedContent(m, 'MOVIE', req)),
        featuredSeries: featuredSeries.map((s) => sanitizeManagedContent(s, 'SERIES', req)),
        latestMovies: latestMovies.map((m) => sanitizeManagedContent(m, 'MOVIE', req)),
        latestSeries: latestSeries.map((s) => sanitizeManagedContent(s, 'SERIES', req)),
      },
    });
  } catch (err) {
    console.error('[home] error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
