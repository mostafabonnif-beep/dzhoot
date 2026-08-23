const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { requireAuth } = require('./auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { epgService } = require('../services/epg-service');
const { audit, reqCtx } = require('../services/audit-log');
const Channel = require('../models/Channel');
const EpgProgram = require('../models/EpgProgram');
const { escapeRegex } = require('../utils/escapeRegex');

router.use(requireAuth);
router.use(requireAdmin);

// Get EPG status and stats
router.get('/status', async (req, res) => {
  try {
    const stats = await epgService.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching EPG stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch EPG stats' });
  }
});

// Trigger immediate EPG refresh
router.post('/refresh', async (req, res) => {
  try {
    audit({
      userId: req.user.id,
      action: 'refresh_epg',
      resource: 'epg',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Start refresh in background, respond immediately
    epgService.refreshEpg().catch((err) => {
      console.error('Manual EPG refresh failed:', err.message);
    });

    res.json({
      success: true,
      message: 'EPG refresh started. Check /status for progress.',
    });
  } catch (error) {
    console.error('Error triggering EPG refresh:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger EPG refresh' });
  }
});

// Get discovered EPG sources with per-source health + operator override state
router.get('/sources', async (req, res) => {
  try {
    const sources = await epgService.discoverEpgSources();
    res.json({
      success: true,
      count: sources.length,
      data: sources.map((s) => ({
        url: s.url,
        source: s.source,
        coveredChannels: s.coveredChannelIds.length,
        disabled: Boolean(s.disabled),
        lastOkAt: s.lastOkAt ?? null,
        lastFailedAt: s.lastFailedAt ?? null,
        lastError: s.lastError ?? null,
        lastTestedAt: s.lastTestedAt ?? null,
        lastTestResult: s.lastTestResult ?? null,
      })),
    });
  } catch (error) {
    console.error('Error discovering EPG sources:', error);
    res.status(500).json({ success: false, error: 'Failed to discover EPG sources' });
  }
});

// Disable a specific source (persisted override — excluded from future refreshes)
router.post('/sources/:key/disable', async (req, res) => {
  try {
    const url = String(req.params.key || '');
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ success: false, error: 'Invalid source URL' });
    }
    const note = req.body?.note ? String(req.body.note).slice(0, 500) : '';
    await epgService.setSourceDisabled(url, true, note);

    audit({
      userId: req.user.id,
      action: 'epg_source_disable',
      resource: 'epg-source',
      resourceId: url,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, url, disabled: true });
  } catch (error) {
    console.error('Error disabling EPG source:', error);
    res.status(500).json({ success: false, error: 'Failed to disable EPG source' });
  }
});

// Enable a previously disabled source
router.post('/sources/:key/enable', async (req, res) => {
  try {
    const url = String(req.params.key || '');
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ success: false, error: 'Invalid source URL' });
    }
    await epgService.setSourceDisabled(url, false);

    audit({
      userId: req.user.id,
      action: 'epg_source_enable',
      resource: 'epg-source',
      resourceId: url,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, url, disabled: false });
  } catch (error) {
    console.error('Error enabling EPG source:', error);
    res.status(500).json({ success: false, error: 'Failed to enable EPG source' });
  }
});

// Test a single source (fetch + parse on demand; result persisted)
router.post('/sources/:key/test', async (req, res) => {
  try {
    const url = String(req.params.key || '');
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ success: false, error: 'Invalid source URL' });
    }
    const result = await epgService.testSource(url);

    audit({
      userId: req.user.id,
      action: 'epg_source_test',
      resource: 'epg-source',
      resourceId: url,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, url, ...result });
  } catch (error) {
    console.error('Error testing EPG source:', error);
    res.status(500).json({ success: false, error: 'Failed to test EPG source' });
  }
});

// List catalog channels NOT covered by any EPG program, so an operator can
// fix them manually (set tvgId or add an alias).
router.get('/unmatched-channels', async (req, res) => {
  try {
    const { search, page, pageSize } = req.query;
    const p = parseInt(page, 10) || 1;
    const ps = Math.min(parseInt(pageSize, 10) || 50, 200);

    const [programIds, channels] = await Promise.all([
      EpgProgram.distinct('channelEpgId'),
      Channel.find({ ownerId: null }).select('channelId channelName tvgId channelGroup').lean(),
    ]);
    const programIdSet = new Set(programIds.map((id) => String(id).toLowerCase()));

    const unmatched = channels.filter((c) => {
      const identifiers = [c.tvgId, c.channelId].filter(Boolean).map((id) => String(id).toLowerCase());
      return identifiers.length === 0 || !identifiers.some((id) => programIdSet.has(id));
    });

    let filtered = unmatched;
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filtered = unmatched.filter(
        (c) => regex.test(c.channelName || '') || regex.test(c.channelId || '') || regex.test(c.channelGroup || ''),
      );
    }

    const totalCount = filtered.length;
    const pageData = filtered.slice((p - 1) * ps, p * ps).map((c) => ({
      _id: String(c._id),
      channelId: c.channelId || '',
      channelName: c.channelName || '',
      tvgId: c.tvgId || '',
      channelGroup: c.channelGroup || '',
    }));

    res.json({
      success: true,
      count: pageData.length,
      totalCount,
      page: p,
      pageSize: ps,
      data: pageData,
    });
  } catch (error) {
    console.error('Error listing unmatched EPG channels:', error);
    res.status(500).json({ success: false, error: 'Failed to list unmatched channels' });
  }
});

// Manually set the tvgId of a catalog channel (used to match EPG programs).
router.patch('/channels/:id/tvg-id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid channel id' });
    }
    const tvgId = String(req.body?.tvgId || '').trim().slice(0, 200);
    if (!tvgId) {
      return res.status(400).json({ success: false, error: 'tvgId is required' });
    }
    const channel = await Channel.findById(id);
    if (!channel || channel.ownerId) {
      return res.status(404).json({ success: false, error: 'Channel not found in catalog' });
    }
    const before = channel.tvgId || '';
    channel.tvgId = tvgId;
    await channel.save();

    audit({
      ...reqCtx(req),
      action: 'channel_set_tvg_id',
      resource: 'Channel',
      resourceId: String(channel._id),
      changes: { before: { tvgId: before }, after: { tvgId } },
    });

    res.json({ success: true, channelId: String(channel._id), tvgId });
  } catch (error) {
    console.error('Error setting channel tvgId:', error);
    res.status(500).json({ success: false, error: 'Failed to set channel tvgId' });
  }
});

module.exports = router;
