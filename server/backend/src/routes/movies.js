const express = require('express');
const router = express.Router();
const Movie = require('../models/Movie');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');

// Get all movies with pagination, category filter, and search
router.get('/', requireTvOrSessionAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, category, search } = req.query;
    const query = { isActive: true };

    if (category && category !== 'All') {
      query.category = category;
    }

    if (search) {
      query.title = { $regex: String(search), $options: 'i' };
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [movies, total] = await Promise.all([
      Movie.find(query).sort({ title: 1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      Movie.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: movies,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error('Error fetching movies:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch movies' });
  }
});

// Get movie categories
router.get('/categories', requireTvOrSessionAuth, async (req, res) => {
  try {
    const categories = await Movie.distinct('category', { isActive: true });
    res.json({ success: true, data: categories.sort() });
  } catch (error) {
    console.error('Error fetching movie categories:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

// Get single movie detail
router.get('/:id', requireTvOrSessionAuth, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id).lean();
    if (!movie) {
      return res.status(404).json({ success: false, error: 'Movie not found' });
    }
    res.json({ success: true, data: movie });
  } catch (error) {
    console.error('Error fetching movie detail:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch movie detail' });
  }
});

module.exports = router;
