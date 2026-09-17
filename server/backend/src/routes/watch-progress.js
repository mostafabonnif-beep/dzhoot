const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const {
  upsertProgress,
  listContinueWatching,
  getProgress,
  removeProgress,
  clearProgress,
} = require('../services/watch-progress-service');

// All watch-progress routes require a logged-in user.
router.use(requireAuth);

/**
 * PUT /api/v1/watch-progress/:contentType/:contentId
 * Body: { positionSec, durationSec? }
 * Upserts the resume position for the current user.
 */
router.put('/:contentType/:contentId', async (req, res) => {
  try {
    const { contentType, contentId } = req.params;
    const { positionSec, durationSec } = req.body || {};
    const userId = req.user?._id?.toString() || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const doc = await upsertProgress({
      userId,
      contentId,
      contentType,
      positionSec: Number(positionSec),
      durationSec: durationSec != null ? Number(durationSec) : null,
    });

    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[watch-progress] save failed', err);
    return res.status(400).json({ success: false, error: 'Failed to save watch progress' });
  }
});

/**
 * GET /api/v1/watch-progress
 * Returns the Continue Watching list for the current user.
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const limit = Number(req.query.limit) || 20;
    const items = await listContinueWatching(userId, limit);
    return res.json({ success: true, data: items });
  } catch (err) {
    console.error('[watch-progress] list failed', err);
    return res.status(400).json({ success: false, error: 'Failed to load continue watching' });
  }
});

/**
 * GET /api/v1/watch-progress/:contentType/:contentId
 * Returns a single resume point.
 */
router.get('/:contentType/:contentId', async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const doc = await getProgress(userId, req.params.contentId);
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[watch-progress] get failed', err);
    return res.status(400).json({ success: false, error: 'Failed to load watch progress' });
  }
});

/**
 * DELETE /api/v1/watch-progress/:contentType/:contentId
 * Removes a single item from Continue Watching.
 */
router.delete('/:contentType/:contentId', async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const removed = await removeProgress(userId, req.params.contentId);
    return res.json({ success: true, data: { removed } });
  } catch (err) {
    console.error('[watch-progress] remove failed', err);
    return res.status(400).json({ success: false, error: 'Failed to remove watch progress' });
  }
});

/**
 * DELETE /api/v1/watch-progress
 * Clears the entire Continue Watching list.
 */
router.delete('/', async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const removed = await clearProgress(userId);
    return res.json({ success: true, data: { removed } });
  } catch (err) {
    console.error('[watch-progress] clear failed', err);
    return res.status(400).json({ success: false, error: 'Failed to clear watch progress' });
  }
});

module.exports = router;
