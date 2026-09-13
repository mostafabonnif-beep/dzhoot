const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AppVersion = require('../models/AppVersion');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx } = require('../services/audit-log');
const { createAppVersionSchema, updateAppVersionSchema } = require('@dzhoof/shared');

// Admin-only app release metadata: /api/v1/admin/app-versions
//
// This is the only writer for the AppVersion collection. Every write is audited
// because these rows decide which APK a device installs.
//
// routes/admin.js already authenticates everything under /api/v1/admin/*, so only
// authenticate here when the request arrives unauthenticated (keeps the router safe
// on its own without a second session lookup); the admin role is always enforced.
router.use((req, res, next) => (req.user ? next() : requireAuth(req, res, next)));
router.use(requireAdmin);

/**
 * Fields an operator may change after publication. The artifact identity
 * (versionName, versionCode, apkFileName, apkFileSize, downloadUrl, sha256) is
 * intentionally immutable: re-pointing a checksum or URL at the same versionCode
 * would let a device install bytes that no longer match the reviewed release, so a
 * new artifact requires a new versionCode.
 */
const MUTABLE_FIELDS = [
  'releaseNotes',
  'isActive',
  'isMandatory',
  'minCompatibleVersion',
  'releaseChannel',
  'distribution',
  'platforms',
  'releasedAt',
];

function parseId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

function publicShape(version) {
  return {
    _id: version._id,
    versionName: version.versionName,
    versionCode: version.versionCode,
    apkFileName: version.apkFileName || null,
    apkFileSize: Number(version.apkFileSize) || 0,
    downloadUrl: version.downloadUrl || null,
    releaseNotes: version.releaseNotes || '',
    isActive: version.isActive !== false,
    isMandatory: version.isMandatory === true,
    minCompatibleVersion: Number(version.minCompatibleVersion) || 1,
    releasedAt: version.releasedAt || null,
    sha256: version.sha256 || null,
    releaseChannel: version.releaseChannel === 'beta' ? 'beta' : 'stable',
    distribution:
      version.distribution === 'play' || version.distribution === 'managed_device'
        ? version.distribution
        : 'external_apk',
    platforms: Array.isArray(version.platforms) && version.platforms.length > 0 ? version.platforms : null,
    createdAt: version.createdAt || null,
    updatedAt: version.updatedAt || null,
  };
}

function validationError(res, error) {
  const issues = error.issues || error.errors || [];
  return res.status(400).json({
    success: false,
    error: 'Validation failed',
    details: issues.map((issue) => ({
      path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path),
      message: issue.message,
    })),
  });
}

/** `platforms: []` is stored as absent so "no scope" has exactly one representation. */
function normalisePlatforms(platforms) {
  return Array.isArray(platforms) && platforms.length > 0 ? platforms : undefined;
}

// GET / — newest first, bounded
router.get('/', async (req, res) => {
  try {
    const versions = await AppVersion.find().sort({ versionCode: -1 }).limit(100).lean();
    return res.json({ success: true, data: versions.map(publicShape) });
  } catch (err) {
    console.error('[app-versions] list error:', err.message || err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST / — publish a new release record
router.post('/', async (req, res) => {
  try {
    const parsed = createAppVersionSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed.error);
    const input = parsed.data;

    const duplicate = await AppVersion.findOne({
      $or: [{ versionCode: input.versionCode }, { versionName: input.versionName }],
    })
      .select('versionCode versionName')
      .lean();
    if (duplicate) {
      return res.status(409).json({
        success: false,
        error: 'A version with this versionCode or versionName already exists',
      });
    }

    const created = await AppVersion.create({
      ...input,
      sha256: input.sha256 || null,
      platforms: normalisePlatforms(input.platforms),
    });

    const shaped = publicShape(created.toObject());
    audit({
      ...reqCtx(req),
      action: 'APP_VERSION_PUBLISH',
      resource: 'AppVersion',
      resourceId: String(created._id),
      changes: { after: shaped },
    });
    return res.status(201).json({ success: true, data: shaped });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, error: 'A version with this versionCode already exists' });
    }
    console.error('[app-versions] publish error:', err.message || err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// PATCH /:id — update the mutable metadata (channel, distribution, notes, flags)
router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid version id' });

    const parsed = updateAppVersionSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed.error);

    const version = await AppVersion.findById(id).exec();
    if (!version) return res.status(404).json({ success: false, error: 'Version not found' });

    const body = req.body || {};
    if (body.versionName !== undefined && String(body.versionName) !== version.versionName) {
      return res.status(400).json({ success: false, error: 'versionName is immutable; publish a new version' });
    }
    if (body.versionCode !== undefined && Number(body.versionCode) !== Number(version.versionCode)) {
      return res.status(400).json({ success: false, error: 'versionCode is immutable; publish a new version' });
    }
    const immutableTouched = ['apkFileName', 'apkFileSize', 'downloadUrl', 'sha256'].filter(
      (field) => body[field] !== undefined,
    );
    if (immutableTouched.length > 0) {
      return res.status(400).json({
        success: false,
        error: `${immutableTouched.join(', ')} cannot be changed; publish a new version`,
      });
    }

    const before = publicShape(version.toObject());
    for (const field of MUTABLE_FIELDS) {
      if (parsed.data[field] === undefined) continue;
      if (field === 'platforms') {
        version.platforms = normalisePlatforms(parsed.data.platforms);
      } else {
        version[field] = parsed.data[field];
      }
    }
    await version.save();

    const after = publicShape(version.toObject());
    audit({
      ...reqCtx(req),
      action: 'APP_VERSION_UPDATE',
      resource: 'AppVersion',
      resourceId: String(id),
      changes: { before, after },
    });
    return res.json({ success: true, data: after });
  } catch (err) {
    console.error('[app-versions] update error:', err.message || err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
module.exports._private = { publicShape, normalisePlatforms, MUTABLE_FIELDS };
