const express = require('express');
const router = express.Router();
const Movie = require('../models/Movie');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');
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

    const [movies, total] = await Promise.all([
      Movie.find(query).select('-streamUrl').sort({ title: 1 }).skip(skip).limit(limit).lean(),
      Movie.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: movies,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error fetching movies:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch movies' });
  }
});

router.get('/categories', requireTvOrSessionAuth, async (_req, res) => {
  try {
    const categories = await Movie.distinct('category', { isActive: true });
    return res.json({
      success: true,
      data: categories.filter(Boolean).map(String).sort((a, b) => a.localeCompare(b)),
    });
  } catch (error) {
    console.error('Error fetching movie categories:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

router.get('/:id', requireTvOrSessionAuth, async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, error: 'Invalid movie id' });
  }

  try {
    const movie = await Movie.findOne({ _id: req.params.id, isActive: true }).select('-streamUrl').lean();
    if (!movie) {
      return res.status(404).json({ success: false, error: 'Movie not found' });
    }
    return res.json({ success: true, data: movie });
  } catch (error) {
    console.error('Error fetching movie detail:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch movie detail' });
  }
});

module.exports = router;
