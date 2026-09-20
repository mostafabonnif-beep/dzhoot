const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { requireTvOrSessionAuth } = require('../middleware/requireTvOrSessionAuth');

// `channel_ids` is written verbatim onto the hot User document
// (`user.metadata.favorites`) and is re-sent in full on every sync, so an
// unbounded array is an account-document bloat vector: the JSON body limit is
// 5 MB, so one POST could otherwise store ~500k ids that EVERY authenticated
// request for that account then loads. 2000 entries is an order of magnitude
// above any human-curated favourites list (and a user's whole playlist is
// itself capped at USER_CHANNELS_MAX = 5000), while bounding the stored array
// to ~256 KB worst case at the per-id cap below — ~48 KB for real ObjectId ids.
const MAX_FAVORITES = 2000;
// A favourites entry is either a Mongo ObjectId (the web client stores
// `channel._id`: 24 hex chars) or the catalog `channelId` slug (the Android
// client stores `ChannelDto.id`, which is `channelId`). Both are far shorter
// than this cap; it exists only so a request body cannot stuff the document.
const MAX_FAVORITE_ID_LENGTH = 128;
// Device ids are client-generated (`Settings.Secure.ANDROID_ID`, 16 hex chars).
const MAX_DEVICE_ID_LENGTH = 128;

/** True for NUL, newlines and the rest of the C0/C1 control range. */
function hasControlCharacter(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** A non-empty string that could plausibly be a channel identifier. */
function isPlausibleChannelId(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_FAVORITE_ID_LENGTH &&
    // Control characters (incl. NUL/newlines) never appear in an id and are a
    // cheap way to smuggle oversized or log-breaking content into the doc.
    !hasControlCharacter(value)
  );
}

// Sync favorites from TV app or web UI
router.post('/', requireTvOrSessionAuth, async (req, res) => {
  try {
    const { channel_ids, device_id } = req.body;

    if (!Array.isArray(channel_ids)) {
      return res.status(400).json({
        success: false,
        error: 'channel_ids must be an array',
      });
    }

    if (channel_ids.length > MAX_FAVORITES) {
      return res.status(400).json({
        success: false,
        error: `channel_ids cannot contain more than ${MAX_FAVORITES} entries`,
      });
    }

    if (!channel_ids.every(isPlausibleChannelId)) {
      return res.status(400).json({
        success: false,
        error: 'channel_ids must contain valid channel identifiers',
      });
    }

    if (device_id && (typeof device_id !== 'string' || device_id.length > MAX_DEVICE_ID_LENGTH)) {
      return res.status(400).json({
        success: false,
        error: `device_id must be a string of at most ${MAX_DEVICE_ID_LENGTH} characters`,
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const now = Date.now();
    user.metadata = user.metadata || {};
    user.metadata.favorites = channel_ids;
    user.metadata.favoritesLastModified = now;
    if (device_id) {
      user.metadata.favoritesDeviceId = device_id;
    }
    user.markModified('metadata');
    await user.save();

    res.json({ success: true, message: 'Favorites synced', timestamp: now });
  } catch (error) {
    console.error('Error syncing favorites:', error);
    res.status(500).json({ success: false, error: 'Failed to sync favorites' });
  }
});

// Get favorites for current user
router.get('/', requireTvOrSessionAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      channel_ids: user.metadata?.favorites || [],
      timestamp: user.metadata?.favoritesLastModified || null,
    });
  } catch (error) {
    console.error('Error fetching favorites:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch favorites' });
  }
});

module.exports = router;
module.exports._private = { MAX_FAVORITES, MAX_FAVORITE_ID_LENGTH, isPlausibleChannelId };
