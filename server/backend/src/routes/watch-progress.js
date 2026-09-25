const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
// `requireTvOrSessionAuth`, not `requireAuth`: this is an app-facing surface and
// the Android/TV client authenticates with its paired channel-list code —
// `AppPreferences.setSessionId` has no caller anywhere in the app, so the
// session-only guard answered 401 for the one client that renders Continue
// Watching ("ولو وُصل، يعيد 401", docs/APP_QUALITY_REMEDIATION_PLAN_AR_2026-09-17.md
// item ع7 / plan item 10). This is the same guard `/api/v1/favorites` uses for
// the same reason: a per-user list written by a paired device.
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');
const {
  upsertProgress,
  listContinueWatching,
  getProgress,
  removeProgress,
  clearProgress,
} = require('../services/watch-progress-service');

// Continue-watching list bounds. The service clamps to 50 as well
// (`watch-progress-service.listContinueWatching`); the route clamps to the same
// ceiling so the accepted value is the one the query actually uses.
const DEFAULT_CONTINUE_WATCHING_LIMIT = 20;
const MAX_CONTINUE_WATCHING_LIMIT = 50;

/**
 * Bounded, positive-integer query param (same convention as
 * `routes/admin-error-reports.js` `boundedLimit`). Anything missing,
 * non-numeric, fractional, zero or negative falls back to the default rather
 * than reaching the query — `Number(raw) || 20` used to pass `-3` straight to
 * `limit()` (mongoose reads a negative limit as an absolute value).
 */
function boundedLimit(raw, fallback, max) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/**
 * Id of the authenticated user. `requireTvOrSessionAuth` puts it on
 * `req.user.id` for both the TV-code and the session path; `req.userId` is kept
 * as a fallback so a future guard swap does not silently break every handler.
 *
 * A demo session has no account: the middleware sets `req.user = { id: 'demo',
 * demo: true }`. Returning null turns that into the same 401 as "not signed in"
 * instead of handing `'demo'` to the model, where the ObjectId cast on `userId`
 * failed and the route answered 400 with a stack trace in the log.
 */
function currentUserId(req) {
  if (req.user?.demo === true) return null;
  const id = req.userId || req.user?.id || null;
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
  return String(id);
}

// All watch-progress routes need a resolved account: a session or a paired TV code.
router.use(requireTvOrSessionAuth);

/**
 * PUT /api/v1/watch-progress/:contentType/:contentId
 * Body: { positionSec, durationSec? }
 * Upserts the resume position for the current user.
 */
router.put('/:contentType/:contentId', async (req, res) => {
  try {
    const { contentType, contentId } = req.params;
    const { positionSec, durationSec } = req.body || {};
    const userId = currentUserId(req);
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
    const userId = currentUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const limit = boundedLimit(
      req.query.limit,
      DEFAULT_CONTINUE_WATCHING_LIMIT,
      MAX_CONTINUE_WATCHING_LIMIT,
    );
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
    const userId = currentUserId(req);
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
    const userId = currentUserId(req);
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
    const userId = currentUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const removed = await clearProgress(userId);
    return res.json({ success: true, data: { removed } });
  } catch (err) {
    console.error('[watch-progress] clear failed', err);
    return res.status(400).json({ success: false, error: 'Failed to clear watch progress' });
  }
});

module.exports = router;
module.exports._private = { boundedLimit, MAX_CONTINUE_WATCHING_LIMIT };
