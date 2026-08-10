const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Movie = require('../models/Movie');
const Series = require('../models/Series');
const Season = require('../models/Season');
const Episode = require('../models/Episode');
const { optionalAuth } = require('../middleware/resolveUser');

// Browseable catalog (movies / series / seasons / episodes / unified search).
// Auth is optional — anonymous browsing is allowed; subscription gating is
// enforced separately at /streams/authorize.
router.use(optionalAuth);

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

function paginate(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
  return { page, limit, skip: (page - 1) * limit };
}

function buildSearchFilter(search) {
  if (!search) return {};
  const q = String(search).trim();
  if (!q) return {};
  return {
    $or: [
      { title: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
    ],
  };
}

// GET /api/v1/catalog/movies/categories
router.get('/movies/categories', async (req, res) => {
  try {
    const cats = await Movie.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return res.json({
      success: true,
      data: cats.map((c) => ({ name: c._id || 'Uncategorized', count: c.count })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/catalog/movies?page&limit&category&search
router.get('/movies', async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req.query);
    const filter = { isActive: true };
    if (req.query.category) filter.category = String(req.query.category);
    Object.assign(filter, buildSearchFilter(req.query.search));

    const [totalCount, data] = await Promise.all([
      Movie.countDocuments(filter),
      Movie.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);
    return res.json({ success: true, data, totalCount, page, limit });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/catalog/movies/:id
router.get('/movies/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid movie id' });
    const movie = await Movie.findOne({ _id: id, isActive: true }).lean();
    if (!movie) return res.status(404).json({ success: false, error: 'Movie not found' });
    return res.json({ success: true, data: movie });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/catalog/series/categories
router.get('/series/categories', async (req, res) => {
  try {
    const cats = await Series.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return res.json({
      success: true,
      data: cats.map((c) => ({ name: c._id || 'Uncategorized', count: c.count })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/catalog/series?page&limit&category&search
router.get('/series', async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req.query);
    const filter = { isActive: true };
    if (req.query.category) filter.category = String(req.query.category);
    Object.assign(filter, buildSearchFilter(req.query.search));

    const [totalCount, data] = await Promise.all([
      Series.countDocuments(filter),
      Series.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);
    return res.json({ success: true, data, totalCount, page, limit });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/catalog/series/:id
router.get('/series/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid series id' });
    const series = await Series.findOne({ _id: id, isActive: true }).lean();
    if (!series) return res.status(404).json({ success: false, error: 'Series not found' });
    return res.json({ success: true, data: series });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/catalog/series/:id/seasons
router.get('/series/:id/seasons', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid series id' });
    const series = await Series.findOne({ _id: id, isActive: true }).lean();
    if (!series) return res.status(404).json({ success: false, error: 'Series not found' });
    const seasons = await Season.find({ seriesId: id }).sort({ seasonNumber: 1 }).lean();
    return res.json({ success: true, data: seasons });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/catalog/seasons/:id/episodes
router.get('/seasons/:id/episodes', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid season id' });
    const episodes = await Episode.find({ seasonId: id }).sort({ episodeNumber: 1 }).lean();
    return res.json({ success: true, data: episodes });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/v1/catalog/search?q= — unified search across live + movies + series
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.json({ success: true, data: { channels: [], movies: [], series: [] } });
    }

    const Channel = require('../models/Channel');
    const regex = { $regex: q, $options: 'i' };

    const [channels, movies, series] = await Promise.all([
      Channel.find({ isActive: { $ne: false }, ownerId: null, channelName: regex })
        .sort({ order: 1 })
        .limit(20)
        .lean(),
      Movie.find({ isActive: true, title: regex }).sort({ createdAt: -1 }).limit(20).lean(),
      Series.find({ isActive: true, title: regex }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    return res.json({
      success: true,
      data: {
        channels: channels.map((c) => ({
          _id: c._id,
          type: 'LIVE',
          name: c.channelName,
          logo: c.channelImg,
          group: c.channelGroup,
        })),
        movies: movies.map((m) => ({
          _id: m._id,
          type: 'MOVIE',
          name: m.title,
          poster: m.poster,
          category: m.category,
        })),
        series: series.map((s) => ({
          _id: s._id,
          type: 'SERIES',
          name: s.title,
          poster: s.poster,
          category: s.category,
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
