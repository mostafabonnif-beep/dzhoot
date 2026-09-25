const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AppSetting = require('../models/AppSetting');
const Channel = require('../models/Channel');
const Movie = require('../models/Movie');
const Series = require('../models/Series');
const { optionalAuth } = require('../middleware/resolveUser');
const { verifiedXtreamChannelQuery } = require('../utils/verified-channel-query');

// Dynamic home: /api/v1/home
// Sections are configured by the admin through AppSetting 'home':
//   { featuredChannelIds: [], featuredMovieIds: [], featuredSeriesIds: [] }
router.use(optionalAuth);

// How many items a fallback rail carries when the operator's featured list is missing.
const FEATURED_LIMIT = 20;

/**
 * The featured rails are operator configuration, and an absent or stale configuration used
 * to leave them empty: measured in production on 2026-09-25, there was no `home` AppSetting
 * at all, so the first screen a customer sees showed three empty sections out of five while
 * the catalog held 84,545 movies. An operator who has not chosen featured titles wants a
 * useful home screen, not a hole, so each empty rail falls back to the newest eligible
 * titles — and says so once, so the configuration can be made deliberate.
 */
function pickNewestWhenEmpty(configured, fallbackQuery) {
  return configured.length > 0 ? Promise.resolve(configured) : fallbackQuery();
}

router.get('/', async (req, res) => {
  try {
    const setting = await AppSetting.findOne({ key: 'home' }).lean();
    const cfg = setting?.value || {};

    const channelIds = (cfg.featuredChannelIds || []).filter((x) => mongoose.Types.ObjectId.isValid(x));
    const movieIds = (cfg.featuredMovieIds || []).filter((x) => mongoose.Types.ObjectId.isValid(x));
    const seriesIds = (cfg.featuredSeriesIds || []).filter((x) => mongoose.Types.ObjectId.isValid(x));

    const [featuredChannels, featuredMovies, featuredSeries] = await Promise.all([
      channelIds.length
        ? Channel.find(await verifiedXtreamChannelQuery({ _id: { $in: channelIds } })).limit(FEATURED_LIMIT).lean()
        : [],
      movieIds.length
        ? Movie.find({ _id: { $in: movieIds }, isActive: true }).limit(FEATURED_LIMIT).lean()
        : [],
      seriesIds.length
        ? Series.find({ _id: { $in: seriesIds }, isActive: true }).limit(FEATURED_LIMIT).lean()
        : [],
    ]).then(async ([channels, movies, series]) => [
      await pickNewestWhenEmpty(
        channels,
        async () => Channel.find(await verifiedXtreamChannelQuery({}))
          .sort({ order: 1 })
          .limit(FEATURED_LIMIT)
          .lean(),
      ),
      await pickNewestWhenEmpty(
        movies,
        async () => Movie.find({ isActive: true, poster: { $nin: [null, ''] } })
          .sort({ createdAt: -1 })
          .limit(FEATURED_LIMIT)
          .lean(),
      ),
      await pickNewestWhenEmpty(
        series,
        async () => Series.find({ isActive: true, poster: { $nin: [null, ''] } })
          .sort({ createdAt: -1 })
          .limit(FEATURED_LIMIT)
          .lean(),
      ),
    ]);

    if (channelIds.length === 0 || movieIds.length === 0 || seriesIds.length === 0) {
      console.warn(
        '[home] featured configuration is missing or does not resolve — filled the empty ' +
          'rail(s) with the newest titles instead of showing an empty section. ' +
          'Configure AppSetting "home" to choose them deliberately.',
      );
    }

    const [latestMovies, latestSeries] = await Promise.all([
      Movie.find({ isActive: true }).sort({ createdAt: -1 }).limit(12).lean(),
      Series.find({ isActive: true }).sort({ createdAt: -1 }).limit(12).lean(),
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
