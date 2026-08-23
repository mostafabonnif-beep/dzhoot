const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Movie = require('../models/Movie');
const Series = require('../models/Series');
const Season = require('../models/Season');
const Episode = require('../models/Episode');
const { requireAuth, requireAdmin } = require('./auth');
const { audit } = require('../services/audit-log');

// Admin management for VOD content (movies / series) — browse-only until now.
// All routes are admin-only. Every mutating action is audit-logged.
// NOTE: bulk routes are registered BEFORE any '/:id' route so 'bulk' never
// shadow-matches the :id parameter (same convention as admin.js channels).
router.use(requireAuth);
router.use(requireAdmin);

const MAX_BULK_IDS = 2000;

function parseIdList(body) {
  const rawIds = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : [];
  const ids = rawIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  return { rawCount: rawIds.length, ids };
}

function parseCategoryList(body) {
  if (!Array.isArray(body?.categories)) return [];
  return body.categories
    .map((c) => String(c || '').trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 500);
}

function auditVod(req, action, resourceId, after) {
  audit({
    userId: req.user.id,
    action,
    resource: 'vod',
    resourceId,
    changes: after ? { after } : undefined,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

/* ------------------------------- MOVIES ------------------------------- */

// Bulk enable/disable movies by explicit ID list.
router.patch('/movies/bulk', async (req, res) => {
  try {
    const { rawCount, ids } = parseIdList(req.body);
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids[] is required (valid ObjectIds)' });
    }
    if (rawCount > MAX_BULK_IDS) {
      return res.status(400).json({ success: false, error: `Too many ids (max ${MAX_BULK_IDS})` });
    }
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive (boolean) is required' });
    }
    const isActive = req.body.isActive;
    if (!isActive && req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Disabling movies requires { "confirmed": true } in request body',
      });
    }

    const result = await Movie.updateMany({ _id: { $in: ids } }, { $set: { isActive } });
    auditVod(req, isActive ? 'bulk_enable_movies' : 'bulk_disable_movies', `${result.modifiedCount} movies`);

    return res.json({
      success: true,
      isActive,
      updatedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });
  } catch (error) {
    console.error('Error bulk-updating movies:', error);
    return res.status(500).json({ success: false, error: 'Failed to bulk-update movies' });
  }
});

// Bulk delete movies by explicit ID list (requires { confirmed: true }).
router.delete('/movies/bulk', async (req, res) => {
  try {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }
    const { rawCount, ids } = parseIdList(req.body);
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids[] is required (valid ObjectIds)' });
    }
    if (rawCount > MAX_BULK_IDS) {
      return res.status(400).json({ success: false, error: `Too many ids (max ${MAX_BULK_IDS})` });
    }

    const result = await Movie.deleteMany({ _id: { $in: ids } });
    auditVod(req, 'bulk_delete_movies', `${result.deletedCount} movies`);

    return res.json({
      success: true,
      message: `Deleted ${result.deletedCount} movies`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Error bulk-deleting movies:', error);
    return res.status(500).json({ success: false, error: 'Failed to bulk-delete movies' });
  }
});

// Bulk enable/disable movies by category (requires { confirmed: true }).
// Lets an admin hide whole junk categories (e.g. "BG - بلبغاريا فيلم") in one shot.
router.patch('/movies/bulk-by-category', async (req, res) => {
  try {
    const categories = parseCategoryList(req.body);
    if (categories.length === 0) {
      return res.status(400).json({ success: false, error: 'categories[] is required (non-empty)' });
    }
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive (boolean) is required' });
    }
    const isActive = req.body.isActive;
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Category-wide update requires { "confirmed": true } in request body',
      });
    }

    const filter = { category: { $in: categories } };
    if (req.body?.sourceId && mongoose.Types.ObjectId.isValid(String(req.body.sourceId))) {
      filter.sourceId = String(req.body.sourceId);
    }
    const result = await Movie.updateMany(filter, { $set: { isActive } });
    auditVod(
      req,
      isActive ? 'bulk_enable_movies_by_category' : 'bulk_disable_movies_by_category',
      `${result.modifiedCount} movies`,
      { categories, isActive },
    );

    return res.json({ success: true, isActive, updatedCount: result.modifiedCount, matchedCount: result.matchedCount });
  } catch (error) {
    console.error('Error bulk-updating movies by category:', error);
    return res.status(500).json({ success: false, error: 'Failed to bulk-update movies by category' });
  }
});

// Bulk delete movies by category (requires { confirmed: true }).
router.delete('/movies/bulk-by-category', async (req, res) => {
  try {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }
    const categories = parseCategoryList(req.body);
    if (categories.length === 0) {
      return res.status(400).json({ success: false, error: 'categories[] is required (non-empty)' });
    }

    const filter = { category: { $in: categories } };
    if (req.body?.sourceId && mongoose.Types.ObjectId.isValid(String(req.body.sourceId))) {
      filter.sourceId = String(req.body.sourceId);
    }
    const result = await Movie.deleteMany(filter);
    auditVod(req, 'bulk_delete_movies_by_category', `${result.deletedCount} movies`, { categories });

    return res.json({ success: true, message: `Deleted ${result.deletedCount} movies`, deletedCount: result.deletedCount });
  } catch (error) {
    console.error('Error bulk-deleting movies by category:', error);
    return res.status(500).json({ success: false, error: 'Failed to bulk-delete movies by category' });
  }
});

// Toggle one movie.
router.patch('/movies/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, error: 'Invalid movie id' });
  }
  try {
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive (boolean) is required' });
    }
    const isActive = req.body.isActive;
    if (!isActive && req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Disabling a movie requires { "confirmed": true } in request body',
      });
    }

    const movie = await Movie.findOneAndUpdate(
      { _id: req.params.id },
      { $set: { isActive } },
      { new: true },
    ).select('title isActive');
    if (!movie) {
      return res.status(404).json({ success: false, error: 'Movie not found' });
    }

    auditVod(req, isActive ? 'enable_movie' : 'disable_movie', movie.title);
    return res.json({ success: true, data: { _id: movie._id, title: movie.title, isActive: movie.isActive } });
  } catch (error) {
    console.error('Error updating movie:', error);
    return res.status(500).json({ success: false, error: 'Failed to update movie' });
  }
});

// Delete one movie (requires { confirmed: true }).
router.delete('/movies/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, error: 'Invalid movie id' });
  }
  try {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }
    const movie = await Movie.findByIdAndDelete(req.params.id).select('title');
    if (!movie) {
      return res.status(404).json({ success: false, error: 'Movie not found' });
    }
    auditVod(req, 'delete_movie', movie.title);
    return res.json({ success: true, message: `Deleted movie "${movie.title}"` });
  } catch (error) {
    console.error('Error deleting movie:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete movie' });
  }
});

/* ------------------------------- SERIES ------------------------------- */

// Cascade helper: seasons + episodes belonging to the given series ids.
async function cascadeSeries(seriesIds, op) {
  if (seriesIds.length === 0) return { seasons: 0, episodes: 0 };
  if (op === 'delete') {
    const [seasons, episodes] = await Promise.all([
      Season.deleteMany({ seriesId: { $in: seriesIds } }),
      Episode.deleteMany({ seriesId: { $in: seriesIds } }),
    ]);
    return { seasons: seasons.deletedCount, episodes: episodes.deletedCount };
  }
  return { seasons: 0, episodes: 0 };
}

// Bulk enable/disable series by explicit ID list.
router.patch('/series/bulk', async (req, res) => {
  try {
    const { rawCount, ids } = parseIdList(req.body);
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids[] is required (valid ObjectIds)' });
    }
    if (rawCount > MAX_BULK_IDS) {
      return res.status(400).json({ success: false, error: `Too many ids (max ${MAX_BULK_IDS})` });
    }
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive (boolean) is required' });
    }
    const isActive = req.body.isActive;
    if (!isActive && req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Disabling series requires { "confirmed": true } in request body',
      });
    }

    const result = await Series.updateMany({ _id: { $in: ids } }, { $set: { isActive } });
    auditVod(req, isActive ? 'bulk_enable_series' : 'bulk_disable_series', `${result.modifiedCount} series`);

    return res.json({
      success: true,
      isActive,
      updatedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });
  } catch (error) {
    console.error('Error bulk-updating series:', error);
    return res.status(500).json({ success: false, error: 'Failed to bulk-update series' });
  }
});

// Bulk delete series by explicit ID list — cascades to seasons + episodes.
router.delete('/series/bulk', async (req, res) => {
  try {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }
    const { rawCount, ids } = parseIdList(req.body);
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids[] is required (valid ObjectIds)' });
    }
    if (rawCount > MAX_BULK_IDS) {
      return res.status(400).json({ success: false, error: `Too many ids (max ${MAX_BULK_IDS})` });
    }

    const existing = await Series.find({ _id: { $in: ids } }).distinct('_id');
    const cascaded = await cascadeSeries(existing, 'delete');
    const result = await Series.deleteMany({ _id: { $in: existing } });
    auditVod(req, 'bulk_delete_series', `${result.deletedCount} series`, { cascaded });

    return res.json({
      success: true,
      message: `Deleted ${result.deletedCount} series (+ ${cascaded.seasons} seasons, ${cascaded.episodes} episodes)`,
      deletedCount: result.deletedCount,
      cascaded,
    });
  } catch (error) {
    console.error('Error bulk-deleting series:', error);
    return res.status(500).json({ success: false, error: 'Failed to bulk-delete series' });
  }
});

// Bulk enable/disable series by category (requires { confirmed: true }).
router.patch('/series/bulk-by-category', async (req, res) => {
  try {
    const categories = parseCategoryList(req.body);
    if (categories.length === 0) {
      return res.status(400).json({ success: false, error: 'categories[] is required (non-empty)' });
    }
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive (boolean) is required' });
    }
    const isActive = req.body.isActive;
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Category-wide update requires { "confirmed": true } in request body',
      });
    }

    const filter = { category: { $in: categories } };
    if (req.body?.sourceId && mongoose.Types.ObjectId.isValid(String(req.body.sourceId))) {
      filter.sourceId = String(req.body.sourceId);
    }
    const result = await Series.updateMany(filter, { $set: { isActive } });
    auditVod(
      req,
      isActive ? 'bulk_enable_series_by_category' : 'bulk_disable_series_by_category',
      `${result.modifiedCount} series`,
      { categories, isActive },
    );

    return res.json({ success: true, isActive, updatedCount: result.modifiedCount, matchedCount: result.matchedCount });
  } catch (error) {
    console.error('Error bulk-updating series by category:', error);
    return res.status(500).json({ success: false, error: 'Failed to bulk-update series by category' });
  }
});

// Bulk delete series by category — cascades to seasons + episodes.
router.delete('/series/bulk-by-category', async (req, res) => {
  try {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }
    const categories = parseCategoryList(req.body);
    if (categories.length === 0) {
      return res.status(400).json({ success: false, error: 'categories[] is required (non-empty)' });
    }

    const filter = { category: { $in: categories } };
    if (req.body?.sourceId && mongoose.Types.ObjectId.isValid(String(req.body.sourceId))) {
      filter.sourceId = String(req.body.sourceId);
    }
    const existing = await Series.find(filter).distinct('_id');
    const cascaded = await cascadeSeries(existing, 'delete');
    const result = await Series.deleteMany({ _id: { $in: existing } });
    auditVod(req, 'bulk_delete_series_by_category', `${result.deletedCount} series`, { categories, cascaded });

    return res.json({
      success: true,
      message: `Deleted ${result.deletedCount} series (+ ${cascaded.seasons} seasons, ${cascaded.episodes} episodes)`,
      deletedCount: result.deletedCount,
      cascaded,
    });
  } catch (error) {
    console.error('Error bulk-deleting series by category:', error);
    return res.status(500).json({ success: false, error: 'Failed to bulk-delete series by category' });
  }
});

// Toggle one series.
router.patch('/series/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, error: 'Invalid series id' });
  }
  try {
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive (boolean) is required' });
    }
    const isActive = req.body.isActive;
    if (!isActive && req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Disabling a series requires { "confirmed": true } in request body',
      });
    }

    const series = await Series.findOneAndUpdate(
      { _id: req.params.id },
      { $set: { isActive } },
      { new: true },
    ).select('title isActive');
    if (!series) {
      return res.status(404).json({ success: false, error: 'Series not found' });
    }

    auditVod(req, isActive ? 'enable_series' : 'disable_series', series.title);
    return res.json({ success: true, data: { _id: series._id, title: series.title, isActive: series.isActive } });
  } catch (error) {
    console.error('Error updating series:', error);
    return res.status(500).json({ success: false, error: 'Failed to update series' });
  }
});

// Delete one series — cascades to seasons + episodes.
router.delete('/series/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, error: 'Invalid series id' });
  }
  try {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'Destructive operation requires { "confirmed": true } in request body',
      });
    }
    const series = await Series.findById(req.params.id).select('title');
    if (!series) {
      return res.status(404).json({ success: false, error: 'Series not found' });
    }
    const cascaded = await cascadeSeries([series._id], 'delete');
    await Series.deleteOne({ _id: series._id });
    auditVod(req, 'delete_series', series.title, { cascaded });
    return res.json({
      success: true,
      message: `Deleted series "${series.title}" (+ ${cascaded.seasons} seasons, ${cascaded.episodes} episodes)`,
      cascaded,
    });
  } catch (error) {
    console.error('Error deleting series:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete series' });
  }
});

module.exports = router;
