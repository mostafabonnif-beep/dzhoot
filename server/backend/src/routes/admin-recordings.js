const express = require('express');
const router = express.Router();
const fs = require('fs');
const mongoose = require('mongoose');
const Recording = require('../models/Recording');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx } = require('../services/audit-log');
const recordingService = require('../services/recording-service');

// Admin-only recordings: /api/v1/admin/recordings
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

// GET / — list recordings (+ stats)
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const [list, stats] = await Promise.all([
      recordingService.listRecordings(filter, page, pageSize),
      recordingService.getRecordingStats(),
    ]);
    return res.json({ success: true, data: list.data, totalCount: list.totalCount, stats });
  } catch (err) {
    console.error('Error listing recordings:', err);
    return res.status(500).json({ success: false, error: 'Failed to list recordings' });
  }
});

// POST / — start recording a catalog channel { channelId }
router.post('/', async (req, res) => {
  try {
    const channelId = String(req.body?.channelId || '').trim();
    if (!channelId || channelId.length > 200) {
      return res.status(400).json({ success: false, error: 'channelId is required' });
    }
    const { rec, alreadyActive } = await recordingService.startRecording(channelId, String(req.user.id));
    audit({
      ...reqCtx(req),
      action: alreadyActive ? 'RECORDING_ALREADY_ACTIVE' : 'RECORDING_START',
      resource: 'Recording',
      resourceId: String(rec._id),
      metadata: { channelId, alreadyActive: Boolean(alreadyActive) },
    });
    return res.status(alreadyActive ? 200 : 201).json({
      success: true,
      data: {
        id: String(rec._id),
        slug: rec.slug,
        channelId: rec.channelId,
        channelName: rec.channelName,
        status: rec.status,
        startedAt: rec.startedAt,
        alreadyActive: Boolean(alreadyActive),
      },
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message || 'Failed to start recording' });
  }
});

// POST /:id/stop — stop an active recording (finalizes MP4)
router.post('/:id/stop', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const rec = await recordingService.stopRecording(String(id));
    audit({ ...reqCtx(req), action: 'RECORDING_STOP', resource: 'Recording', resourceId: String(rec._id) });
    return res.json({ success: true, data: { id: String(rec._id), status: rec.status } });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message || 'Failed to stop recording' });
  }
});

// DELETE /:id — delete recording (file + doc)
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const rec = await Recording.findById(id).lean();
    await recordingService.deleteRecording(String(id));
    audit({
      ...reqCtx(req),
      action: 'RECORDING_DELETE',
      resource: 'Recording',
      resourceId: String(id),
      metadata: rec ? { channelName: rec.channelName } : undefined,
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete recording' });
  }
});

// GET /:id/download — download the finished MP4
router.get('/:id/download', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const rec = await Recording.findById(id).lean();
    if (!rec) return res.status(404).json({ success: false, error: 'Recording not found' });
    if (rec.status !== 'ready' || !rec.fileName) {
      return res.status(409).json({ success: false, error: 'Recording is not ready yet' });
    }
    const file = recordingService.recordingFilePath(rec.slug, rec.fileName);
    if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'File missing' });
    // ASCII-only filename: unicode channel names (ᴴᴰ etc.) break the
    // Content-Disposition header (Node rejects non-ISO-8859-1 bytes).
    const safe = (rec.channelName || 'recording').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 60) || 'recording';
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}-${rec.slug}.mp4"`);
    res.setHeader('Content-Length', fs.statSync(file).size);
    audit({ ...reqCtx(req), action: 'RECORDING_DOWNLOAD', resource: 'Recording', resourceId: String(rec._id) });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error('Error downloading recording:', err);
    return res.status(500).json({ success: false, error: 'Failed to download recording' });
  }
});

// GET /:id/watch — inline play (stable link like youtube.com/live/<slug>)
router.get('/:id/watch', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const rec = await Recording.findById(id).lean();
    if (!rec) return res.status(404).json({ success: false, error: 'Recording not found' });
    if (rec.status !== 'ready' || !rec.fileName) {
      return res.status(409).json({ success: false, error: 'Recording is not ready yet' });
    }
    const file = recordingService.recordingFilePath(rec.slug, rec.fileName);
    if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'File missing' });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Length', fs.statSync(file).size);
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to stream recording' });
  }
});

module.exports = router;
