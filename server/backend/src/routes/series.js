const express = require('express');
const router = express.Router();
const Series = require('../models/Series');
const Season = require('../models/Season');
const Episode = require('../models/Episode');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');

// Get all series with pagination and search
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
    const [seriesList, total] = await Promise.all([
      Series.find(query).sort({ title: 1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      Series.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: seriesList,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error('Error fetching series:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch series' });
  }
});

// Get series categories
router.get('/categories', requireTvOrSessionAuth, async (req, res) => {
  try {
    const categories = await Series.distinct('category', { isActive: true });
    res.json({ success: true, data: categories.sort() });
  } catch (error) {
    console.error('Error fetching series categories:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

// Get single series detail with seasons
router.get('/:id', requireTvOrSessionAuth, async (req, res) => {
  try {
    const series = await Series.findById(req.params.id).lean();
    if (!series) {
      return res.status(404).json({ success: false, error: 'Series not found' });
    }

    const seasons = await Season.find({ seriesId: series._id }).sort({ seasonNumber: 1 }).lean();
    res.json({ success: true, data: { ...series, seasons } });
  } catch (error) {
    console.error('Error fetching series detail:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch series detail' });
  }
});

// Get episodes for a specific season
router.get('/seasons/:seasonId/episodes', requireTvOrSessionAuth, async (req, res) => {
  try {
    const episodes = await Episode.find({ seasonId: req.params.seasonId }).sort({ episodeNumber: 1 }).lean();
    res.json({ success: true, data: episodes });
  } catch (error) {
    console.error('Error fetching episodes:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch episodes' });
  }
});

module.exports = router;
