const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const ProblemReport = require('../models/ProblemReport');
const CrashReport = require('../models/CrashReport');
const { audit, reqCtx } = require('../services/audit-log');
const { summariseGroups } = require('../services/problem-report-service');
const { requireAuth, requireAdmin } = require('./auth');

// Admin triage for what customers report: /api/v1/admin/error-reports
//
// Two collections are served through one view on purpose. `POST /app/crash-report` has
// been writing automatically-captured crashes since v1.0.39 and nothing ever read them
// (five real production crashes sat unread on 2026-09-15, including a repeated
// `Key "رياضة" was already used` LazyColumn failure and a
// `Only VectorDrawables and rasterized asset types are supported` failure). The operator
// surface must show both, or the automatic reports stay invisible.
//
// routes/admin.js already authenticates everything under /api/v1/admin/*, so only
// authenticate when the request arrives unauthenticated (same pattern as
// admin-app-versions); the admin role is always enforced.
router.use((req, res, next) => (req.user ? next() : requireAuth(req, res, next)));
router.use(requireAdmin);

const KINDS = new Set(['problem', 'crash']);
const STATUSES = new Set(['new', 'triaged', 'investigating', 'resolved', 'duplicate']);
const MAX_LIMIT = 200;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Uniform shape for the two collections, so the UI never branches on `kind`. */
function shapeProblemReport(doc) {
  return {
    id: String(doc._id),
    kind: 'problem',
    reportId: doc.reportId,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    appVersion: doc.appVersion,
    appVersionCode: doc.appVersionCode,
    platform: doc.platform,
    deviceModel: doc.deviceModel,
    deviceBrand: doc.deviceBrand,
    androidVersion: doc.androidVersion,
    sdkInt: doc.sdkInt,
    deviceId: doc.deviceId,
    feature: doc.feature,
    screen: doc.screen,
    errorCode: doc.errorCode,
    severity: doc.severity,
    retryable: doc.retryable,
    correlationId: doc.correlationId,
    dedupeKey: doc.dedupeKey,
    message: doc.message || '',
    diagnostics: doc.diagnostics || null,
    adminNotes: doc.adminNotes || null,
    resolvedInVersion: doc.resolvedInVersion || null,
    userId: doc.userId ? String(doc.userId) : null,
  };
}

/**
 * An automatic crash report is presented as a report that is already triaged-in: it has no
 * customer description (the app captured it) and its statuses are the crash's own.
 */
function shapeCrashReport(doc) {
  return {
    id: String(doc._id),
    kind: 'crash',
    reportId: `CR-${String(doc._id).slice(-8).toUpperCase()}`,
    status: 'new',
    createdAt: doc.createdAt,
    updatedAt: doc.createdAt,
    appVersion: doc.appVersion,
    appVersionCode: doc.appVersionCode,
    platform: doc.platform,
    deviceModel: doc.deviceModel,
    deviceBrand: doc.deviceBrand,
    androidVersion: doc.androidVersion,
    sdkInt: doc.sdkInt,
    deviceId: doc.deviceId,
    feature: doc.feature,
    screen: doc.screen,
    errorCode: doc.errorCode,
    severity: doc.severity,
    retryable: doc.retryable,
    correlationId: doc.correlationId,
    dedupeKey: [doc.exceptionType, doc.appVersionCode ?? 'unknown'].join('|'),
    message: doc.exceptionMessage || '',
    diagnostics: {
      exceptionType: doc.exceptionType,
      stackTrace: doc.stackTrace,
      threadName: doc.threadName,
      totalRamMb: doc.totalRamMb,
      freeRamMb: doc.freeRamMb,
      freeStorageMb: doc.freeStorageMb,
    },
    adminNotes: null,
    resolvedInVersion: null,
    userId: null,
  };
}

/** Query filters shared by the list endpoint and the group summary. */
function buildFilter(query) {
  const filter = {};
  const since = parseDate(query.since);
  const until = parseDate(query.until);
  if (since || until) {
    filter.createdAt = {};
    if (since) filter.createdAt.$gte = since;
    if (until) filter.createdAt.$lte = until;
  }
  if (typeof query.errorCode === 'string' && query.errorCode.trim()) {
    filter.errorCode = query.errorCode.trim().slice(0, 64);
  }
  if (typeof query.feature === 'string' && query.feature.trim()) {
    filter.feature = query.feature.trim().slice(0, 60);
  }
  if (typeof query.deviceId === 'string' && query.deviceId.trim()) {
    filter.deviceId = query.deviceId.trim().slice(0, 128);
  }
  const versionCode = Number.parseInt(query.appVersionCode, 10);
  if (Number.isFinite(versionCode)) filter.appVersionCode = versionCode;
  if (typeof query.correlationId === 'string' && query.correlationId.trim()) {
    filter.correlationId = query.correlationId.trim().slice(0, 64);
  }
  return filter;
}

function boundedLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, MAX_LIMIT);
}

function wantedKinds(query) {
  const requested = String(query.kind || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => KINDS.has(entry));
  return requested.length > 0 ? requested : ['problem', 'crash'];
}

// GET / — the triage list, newest first, with the failure classes seen in the window.
router.get('/', async (req, res) => {
  try {
    const kinds = wantedKinds(req.query);
    const limit = boundedLimit(req.query.limit);
    const filter = buildFilter(req.query);
    const statusFilter =
      typeof req.query.status === 'string' && STATUSES.has(req.query.status) ? req.query.status : null;

    const rows = [];
    if (kinds.includes('problem')) {
      const problemFilter = statusFilter ? { ...filter, status: statusFilter } : filter;
      const docs = await ProblemReport.find(problemFilter).sort({ createdAt: -1 }).limit(limit).lean();
      rows.push(...docs.map(shapeProblemReport));
    }
    // Crash reports have no triage status of their own; a status filter that excludes them
    // must not silently include them.
    if (kinds.includes('crash') && (!statusFilter || statusFilter === 'new')) {
      const docs = await CrashReport.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
      rows.push(...docs.map(shapeCrashReport));
    }

    rows.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

    const groups = kinds.includes('problem')
      ? await summariseGroups(ProblemReport, { since: filter.createdAt?.$gte || null })
      : [];

    const counts = await ProblemReport.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    return res.json({
      success: true,
      data: rows.slice(0, limit),
      groups,
      statusCounts: counts.reduce((acc, entry) => {
        acc[entry._id || 'new'] = entry.count;
        return acc;
      }, {}),
    });
  } catch (err) {
    console.error('[error-reports] list error:', err.message || err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /:id — one report, for the detail pane. `kind` selects the collection.
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid report id' });
    }
    const kind = KINDS.has(req.query.kind) ? req.query.kind : 'problem';
    if (kind === 'crash') {
      const doc = await CrashReport.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ success: false, error: 'Report not found' });
      return res.json({ success: true, data: shapeCrashReport(doc) });
    }
    const doc = await ProblemReport.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, error: 'Report not found' });
    return res.json({ success: true, data: shapeProblemReport(doc) });
  } catch (err) {
    console.error('[error-reports] detail error:', err.message || err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PATCH /:id — triage state: status, notes, and the build the fix shipped in.
router.patch('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid report id' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const update = {};

    if (body.status !== undefined) {
      if (!STATUSES.has(body.status)) {
        return res.status(400).json({ success: false, error: 'Invalid status' });
      }
      update.status = body.status;
    }
    if (body.adminNotes !== undefined) {
      const notes = String(body.adminNotes || '').trim();
      update.adminNotes = notes === '' ? null : notes.slice(0, 4000);
    }
    if (body.resolvedInVersion !== undefined) {
      const version = String(body.resolvedInVersion || '').trim();
      update.resolvedInVersion = version === '' ? null : version.slice(0, 40);
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    const before = await ProblemReport.findById(req.params.id).lean();
    if (!before) return res.status(404).json({ success: false, error: 'Report not found' });

    // `$set` with an explicitly built, whitelisted object: every field is sanitised above,
    // and an operator makes it impossible for a request-body key to be read as a query
    // operator (CodeQL reported taint on the bare update document).
    const after = await ProblemReport.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true },
    ).lean();

    audit({
      ...reqCtx(req),
      action: 'PROBLEM_REPORT_UPDATE',
      resource: 'ProblemReport',
      resourceId: String(req.params.id),
      changes: { before, after },
    });

    return res.json({ success: true, data: shapeProblemReport(after) });
  } catch (err) {
    console.error('[error-reports] update error:', err.message || err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
module.exports._private = {
  shapeProblemReport,
  shapeCrashReport,
  buildFilter,
  boundedLimit,
  wantedKinds,
  STATUSES,
};
