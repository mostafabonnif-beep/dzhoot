const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AppVersion = require('../models/AppVersion');
const { requireAuth, requireAdmin } = require('./auth');
const { audit, reqCtx } = require('../services/audit-log');
const { createAppVersionSchema, updateAppVersionSchema } = require('@dzhoof/shared');
const { invalidateReleaseCaches } = require('../services/app-release-cache');

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

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Publish gate for a *served* release record.
 *
 * The update API withholds an update it cannot verify (routes/app-update.js,
 * `APP_UPDATE_REQUIRE_CHECKSUM`), and the Android client refuses a null/invalid
 * checksum outright. Publishing an active row without one therefore produces a
 * release no device will ever install, while the operator believes it shipped.
 * An inactive row is a draft and may omit it.
 */
function checksumGateError(version) {
  if (version?.isActive === false) return null;
  const sha256 = String(version?.sha256 || '').trim().toLowerCase();
  if (SHA256_PATTERN.test(sha256)) return null;
  return {
    success: false,
    errorCode: 'APP_VERSION_CHECKSUM_REQUIRED',
    error:
      'sha256 is required to publish an active version: it must be the 64-character lowercase hex ' +
      'digest of the APK (publish it as inactive, or as a draft, if the checksum is not known yet)',
  };
}

/**
 * Drop the cached GitHub release lookup after a write that changes what the update
 * endpoints should answer.
 *
 * `GET /app/version`, `/app/latest`, `/app/download` and `/app/download-url` read the
 * GitHub release through a 10-minute Redis cache (`ghrel:latest`) so a fleet polling at
 * boot does not exhaust the GitHub API rate limit. Nothing invalidated it, so after a
 * publish the API kept advertising the previous release until the TTL expired — and
 * `docs/AI_AGENT_OPERATIONS_AR.md` §3 told the operator to clear the key by hand.
 *
 * Invalidating here rather than behind an operator-triggered endpoint makes it
 * automatic: the cache is cleared by the write that made it stale, so it cannot be
 * forgotten. A release published only on GitHub (no `AppVersion` row written) still
 * waits out the TTL; ten minutes is the documented bound.
 */
async function invalidateReleaseCacheAfterWrite() {
  try {
    await invalidateReleaseCaches();
  } catch (err) {
    // A stale cache is a ten-minute delay, not a failed publish: never fail the write.
    console.error('[app-versions] could not invalidate the release cache:', err.message || err);
  }
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

    // Publish gate: an active release must carry a verifiable checksum.
    const gateError = checksumGateError(input);
    if (gateError) return res.status(400).json(gateError);

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
      // Stored lowercase: the model's pattern is case-sensitive, so an uppercase digest
      // that passed the gate would otherwise surface as a 500 instead of a clean 400.
      sha256: input.sha256 ? String(input.sha256).toLowerCase() : null,
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
    await invalidateReleaseCacheAfterWrite();
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
    // Only a *transition* into the active state is gated: an existing active row that
    // predates the checksum rule must stay editable (release notes, channel), while
    // promoting a checksum-less draft would serve a release devices cannot verify.
    // Whether this request *activates* the row has to be read from the stored document,
    // not from the hydrated one: `isActive` carries a schema default, so a legacy row
    // inserted without the field reports `true` when hydrated even though
    // `findOne({ isActive: true })` never serves it. Only a PATCH that sets isActive
    // true pays for the extra (indexed, by _id) lookup.
    let activating = false;
    if (parsed.data.isActive === true) {
      const stored = await AppVersion.collection.findOne(
        { _id: version._id },
        { projection: { isActive: 1 } },
      );
      const wasActive = stored ? stored.isActive === true : version.isActive === true;
      activating = !wasActive;
    }
    for (const field of MUTABLE_FIELDS) {
      if (parsed.data[field] === undefined) continue;
      if (field === 'platforms') {
        version.platforms = normalisePlatforms(parsed.data.platforms);
      } else {
        version[field] = parsed.data[field];
      }
    }

    if (activating) {
      const gateError = checksumGateError({ isActive: true, sha256: version.sha256 });
      if (gateError) return res.status(400).json(gateError);
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
    await invalidateReleaseCacheAfterWrite();
    return res.json({ success: true, data: after });
  } catch (err) {
    console.error('[app-versions] update error:', err.message || err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
module.exports._private = { publicShape, normalisePlatforms, MUTABLE_FIELDS };
