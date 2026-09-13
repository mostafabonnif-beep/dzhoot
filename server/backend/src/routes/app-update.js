const express = require('express');
const router = express.Router();
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const AppVersion = require('../models/AppVersion');
const { CacheService } = require('../services/cache');
const { appVersionQuerySchema } = require('@dzhoof/shared');
const { validateUrlForSSRF } = require('../utils/ssrf-guard');
// Shared demo-code guard (same strength rules + live-credential collision check).
const { resolvePublicDemoCode } = require('./config');

// GitHub APK update routes

const GITHUB_OWNER = process.env.GH_APP_OWNER || 'mostafabonnif-beep';
const GITHUB_REPO = process.env.GH_APP_REPO || 'dzhoot';
const GITHUB_APK_PATTERN = process.env.GH_APP_APK_PATTERN || '.apk';
const GITHUB_TOKEN = process.env.GH_APP_TOKEN;

// APP_VERSION is injected at build time via Docker build arg (e.g. "1.2.3")
const APP_VERSION = process.env.APP_VERSION || '0.0.0';
function normalizeVersion(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
}

function compareVersions(left, right) {
  const a = normalizeVersion(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = normalizeVersion(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

// Android uses versionCode = major * 10000 + minor * 100 + patch (for example,
// 1.0.5 becomes 10005). GitHub release tags carry the semantic version, so map
// them to the same scale before deciding whether an update is available.
function versionNameToCode(version) {
  const parts = normalizeVersion(version).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [major = 0, minor = 0, patch = 0] = parts;
  return major * 10000 + minor * 100 + patch;
}

function getCanonicalDownloadUrl(req) {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(configuredBaseUrl)) {
    return `${configuredBaseUrl}/api/v1/app/download`;
  }
  const host = String(req.get('host') || '').trim();
  if (!host || /[\r\n]/.test(host)) return '/api/v1/app/download';
  return `${req.protocol === 'https' ? 'https' : 'http'}://${host}/api/v1/app/download`;
}

function isStaleLocalDownloadUrl(req, value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    const requestHost = String(req.get('host') || '').trim().toLowerCase();
    const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
    const configuredHost = configuredBaseUrl ? new URL(configuredBaseUrl).host.toLowerCase() : requestHost;
    return parsed.protocol === 'https:' &&
      parsed.host.toLowerCase() === configuredHost &&
      parsed.pathname.startsWith('/downloads/');
  } catch {
    return false;
  }
}

function publicDownloadUrl(req, value) {
  return isStaleLocalDownloadUrl(req, value) ? getCanonicalDownloadUrl(req) : value;
}

// ---------------------------------------------------------------------------
// Update-check contract helpers
// ---------------------------------------------------------------------------

// Dedicated, configurable limiter for update checks. Default matches the global
// /api/ budget (1000/15min) on purpose: large fleets behind one NAT IP all poll at
// boot, and a stricter default would throttle legitimate devices. Lower
// APP_UPDATE_RATE_LIMIT_MAX to tighten it.
const UPDATE_CHECK_RATE_LIMIT_MAX = Number.parseInt(process.env.APP_UPDATE_RATE_LIMIT_MAX || '1000', 10);
const updateCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:
    Number.isFinite(UPDATE_CHECK_RATE_LIMIT_MAX) && UPDATE_CHECK_RATE_LIMIT_MAX > 0
      ? UPDATE_CHECK_RATE_LIMIT_MAX
      : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many update checks, try again later' },
});

// Hosts an APK / checksum may be published on. GitHub is the default source; the
// operator's own PUBLIC_BASE_URL host and an explicit allowlist are added so a
// self-hosted mirror keeps working. Anything else is dropped from the response
// (fail-closed) so a poisoned DB row can never point a device at an untrusted host.
const DEFAULT_DOWNLOAD_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
];

function allowedDownloadHosts(req) {
  const hosts = new Set(DEFAULT_DOWNLOAD_HOSTS);
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configuredBaseUrl) {
    try {
      hosts.add(new URL(configuredBaseUrl).hostname.toLowerCase());
    } catch {
      /* ignore malformed base URL */
    }
  }
  // The canonical fallback URL is built from the request host (see
  // getCanonicalDownloadUrl), so the API's own hostname must be allowed too —
  // otherwise a stale /downloads/ row would be rewritten to a URL we then drop.
  const requestHostname = String(req?.get?.('host') || '')
    .split(':')[0]
    .trim()
    .toLowerCase();
  if (requestHostname && !/[\r\n]/.test(requestHostname)) hosts.add(requestHostname);
  for (const entry of String(process.env.APP_UPDATE_ALLOWED_HOSTS || '').split(',')) {
    const host = entry.trim().toLowerCase();
    if (host) hosts.add(host);
  }
  return hosts;
}

function isAllowedDownloadUrl(value, req) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) return false;
    const hosts = allowedDownloadHosts(req);
    return [...hosts].some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function normalizeSha256(value) {
  const match = String(value || '').match(/[a-fA-F0-9]{64}/);
  return match ? match[0].toLowerCase() : null;
}

function normalizeChannel(value) {
  return value === 'beta' ? 'beta' : 'stable';
}

function normalizePlatform(value) {
  return value === 'fire-tv' ? 'android-tv' : value;
}

const RELEASE_NOTES_MAX_ITEMS = 20;
const RELEASE_NOTES_MAX_LINE = 500;

/** Release notes as a bounded list of non-empty lines (contract) plus the raw string (legacy). */
function splitReleaseNotes(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim().slice(0, RELEASE_NOTES_MAX_LINE))
      .filter(Boolean)
      .slice(0, RELEASE_NOTES_MAX_ITEMS);
  }
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, RELEASE_NOTES_MAX_ITEMS)
    .map((line) => line.slice(0, RELEASE_NOTES_MAX_LINE));
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function matchesChannel(latest, channel) {
  if (!channel) return true;
  return latest.releaseChannel === normalizeChannel(channel);
}

function matchesPlatform(latest, platform) {
  if (!platform) return true;
  if (!Array.isArray(latest.platforms) || latest.platforms.length === 0) return true;
  return latest.platforms.includes(normalizePlatform(platform));
}

/** Highest versionCode among the candidates that match the requested channel/platform. */
function pickLatestVersion(candidates, { channel = null, platform = null } = {}) {
  const matching = (candidates || [])
    .filter((candidate) => candidate && matchesChannel(candidate, channel) && matchesPlatform(candidate, platform))
    .sort((left, right) => right.versionCode - left.versionCode);
  return matching[0] || null;
}

function toPublicLatestVersion(latest, req) {
  const minimumSupportedVersionCode = Math.max(1, Number(latest.minCompatibleVersion) || 1);
  const sizeBytes = Number(latest.apkFileSize) || 0;
  const publishedAt = toIsoString(latest.releasedAt);
  return {
    // Contract fields
    versionName: latest.versionName,
    versionCode: latest.versionCode,
    minimumSupportedVersionCode,
    releaseChannel: latest.releaseChannel,
    distribution: latest.distribution,
    // Fail-closed: an off-allowlist or non-HTTPS URL is never handed to a device.
    downloadUrl: isAllowedDownloadUrl(latest.downloadUrl, req) ? latest.downloadUrl : null,
    sha256: latest.sha256 || null,
    sizeBytes,
    releaseNotesList: splitReleaseNotes(latest.releaseNotes),
    publishedAt,
    // Legacy fields kept for clients shipped before the contract change.
    // AppUpdater in the field reads latestVersion.releaseNotes as a string and
    // latestVersion.apkFileSize as a number, so both names/types are preserved.
    releaseNotes: latest.releaseNotes || '',
    apkFileName: latest.apkFileName || null,
    apkFileSize: sizeBytes,
    isMandatory: !!latest.isMandatory,
    minCompatibleVersion: minimumSupportedVersionCode,
    releasedAt: publishedAt,
    source: latest.source,
  };
}

// Cache GitHub release lookups in Redis (short TTL). Under load (every device
// polling /version at boot) a live api.github.com call per request exhausts the
// API rate limit and the app-update endpoints degrade to HTTP 429 — seen in the
// 2026-09-05 production load test (0% success at 25 concurrent users).
const ghReleaseCache = new CacheService('ghrel:', 600); // 10 minutes

async function fetchLatestRelease() {
  const cached = await ghReleaseCache.get('latest');
  if (cached) return cached;

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'DZ-HOOF-Server',
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await axios.get(url, { headers });
  await ghReleaseCache.set('latest', response.data);
  return response.data;
}

function pickApkAsset(release) {
  if (!release || !Array.isArray(release.assets)) return null;
  return release.assets.find((a) => a.name && a.name.endsWith('.apk') && a.name.includes(GITHUB_APK_PATTERN)) || null;
}

/** The release pipeline publishes `<apk>.sha256` next to the APK (see android-release.yml). */
function pickSha256Asset(release, apkAsset) {
  if (!release || !Array.isArray(release.assets) || !apkAsset) return null;
  return release.assets.find((a) => a && a.name === `${apkAsset.name}.sha256` && a.browser_download_url) || null;
}

const sha256Cache = new CacheService('ghsha:', 600); // 10 minutes, same window as the release cache

/**
 * Downloads one small text asset, following redirects manually so *every hop* is
 * checked against the HTTPS allowlist and the SSRF guard before it is requested.
 */
async function fetchTextFollowingValidatedRedirects(url, { maxRedirects = 3, timeout = 8000, maxBytes = 4096 } = {}) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isAllowedDownloadUrl(current)) return null;
    const ssrf = await validateUrlForSSRF(current);
    if (!ssrf.safe) return null;

    let response;
    try {
      response = await axios.get(current, {
        headers: { Accept: 'text/plain', 'User-Agent': 'DZ-HOOF-Server' },
        timeout,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        responseType: 'text',
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      });
    } catch {
      return null;
    }

    const location = response?.headers?.location;
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        current = new URL(location, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    return typeof response.data === 'string' ? response.data : String(response.data ?? '');
  }
  return null;
}

/** SHA-256 for a GitHub release, read from its published `.sha256` asset. Best-effort. */
async function fetchReleaseSha256(candidate) {
  if (!candidate || !candidate.sha256AssetUrl) return null;
  const cacheKey = `v${candidate.versionCode}`;
  const cached = await sha256Cache.get(cacheKey);
  if (typeof cached === 'string' && cached) return cached;

  const text = await fetchTextFollowingValidatedRedirects(candidate.sha256AssetUrl);
  const sha256 = normalizeSha256(text);
  if (sha256) await sha256Cache.set(cacheKey, sha256);
  return sha256;
}

function mapDbVersion(req, version) {
  if (!version) return null;
  return {
    versionName: version.versionName,
    versionCode: Number(version.versionCode) || 0,
    releaseNotes: version.releaseNotes || '',
    apkFileName: version.apkFileName,
    apkFileSize: Number(version.apkFileSize) || 0,
    downloadUrl: publicDownloadUrl(req, version.downloadUrl),
    isMandatory: version.isMandatory || false,
    minCompatibleVersion: Number(version.minCompatibleVersion) || 1,
    releasedAt: version.releasedAt,
    releaseChannel: normalizeChannel(version.releaseChannel),
    distribution: version.distribution === 'play' || version.distribution === 'managed_device'
      ? version.distribution
      : 'external_apk',
    sha256: normalizeSha256(version.sha256),
    // Optional per-version platform scope; absent means "all platforms".
    platforms: Array.isArray(version.platforms) ? version.platforms : null,
    source: 'db',
  };
}

function mapGitHubVersion(release, apkAsset) {
  if (!release || !apkAsset) return null;
  const versionName = normalizeVersion(release.tag_name || release.name || APP_VERSION);
  return {
    versionName,
    versionCode: versionNameToCode(versionName),
    releaseNotes: release.body || '',
    apkFileName: apkAsset.name,
    apkFileSize: Number(apkAsset.size) || 0,
    downloadUrl: apkAsset.browser_download_url,
    isMandatory: false,
    minCompatibleVersion: 1,
    releasedAt: release.published_at,
    releaseChannel: 'stable',
    distribution: 'external_apk',
    sha256: null,
    sha256AssetUrl: pickSha256Asset(release, apkAsset)?.browser_download_url || null,
    platforms: null,
    source: 'github',
  };
}

/**
 * Every published candidate from the active sources. GitHub failure is swallowed
 * only when a DB candidate exists, so a total provider outage still surfaces 500.
 */
async function getVersionCandidates(req) {
  const candidates = [];
  const dbLatest = mapDbVersion(
    req,
    await AppVersion.findOne({ isActive: true }).sort({ versionCode: -1 }).lean(),
  );
  if (dbLatest) candidates.push(dbLatest);

  try {
    const release = await fetchLatestRelease();
    const githubLatest = mapGitHubVersion(release, pickApkAsset(release));
    if (githubLatest) candidates.push(githubLatest);
  } catch (error) {
    if (candidates.length === 0) throw error;
  }
  return candidates;
}

async function getLatestPublishedVersion(req) {
  return pickLatestVersion(await getVersionCandidates(req));
}

router.get('/version', updateCheckLimiter, async (req, res) => {
  try {
    const parsedQuery = appVersionQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      // Keep the historic error strings: shipped clients only branch on the HTTP
      // status, but external integrations match these messages.
      const suppliedVersion =
        req.query.currentVersionCode !== undefined || req.query.currentVersion !== undefined;
      return res.status(400).json({
        success: false,
        error: suppliedVersion ? 'Invalid version code' : 'Current version is required',
      });
    }

    const { channel, platform } = parsedQuery.data;
    const currentVersionCode =
      parsedQuery.data.currentVersionCode !== undefined
        ? parsedQuery.data.currentVersionCode
        : parsedQuery.data.currentVersion;

    const latest = pickLatestVersion(await getVersionCandidates(req), { channel, platform });

    if (!latest) {
      return res.json({
        success: true,
        updateAvailable: false,
        mandatory: false,
        latestVersion: null,
        message: 'No APK asset found in the active release sources',
      });
    }

    const minimumSupportedVersionCode = Math.max(1, Number(latest.minCompatibleVersion) || 1);
    const updateAvailable = latest.versionCode > currentVersionCode;
    const mandatory = !!latest.isMandatory || currentVersionCode < minimumSupportedVersionCode;

    // Only pay for the checksum lookup when the device can actually act on it.
    if (updateAvailable && !latest.sha256) {
      latest.sha256 = await fetchReleaseSha256(latest);
    }

    const publicLatest = toPublicLatestVersion(latest, req);

    return res.json({
      success: true,
      updateAvailable,
      mandatory,
      currentVersionCode,
      latestVersion: publicLatest,
      // Legacy top-level fields kept for shipped clients (AppUpdater reads isMandatory).
      currentVersion: currentVersionCode,
      isMandatory: mandatory,
      releaseNotes: publicLatest.releaseNotes,
      downloadUrl: publicLatest.downloadUrl,
      minCompatibleVersion: publicLatest.minCompatibleVersion,
      source: latest.source,
    });
  } catch (error) {
    console.error('Error checking version via GitHub:', error.message || error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check version from GitHub',
    });
  }
});

router.get('/latest', async (req, res) => {
  try {
    const latest = await getLatestPublishedVersion(req);
    if (!latest) {
      return res.status(404).json({
        success: false,
        error: 'No APK asset available in active release sources',
      });
    }

    return res.json({
      success: true,
      data: latest,
      source: latest.source,
    });
  } catch (error) {
    console.error('Error fetching latest version from GitHub:', error.message || error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch latest version from GitHub',
    });
  }
});

router.get('/versions', async (req, res) => {
  try {
    const versions = await AppVersion.find({})
      .sort({ versionCode: -1 })
      .limit(20)
      .lean();
    if (versions.length > 0) {
      return res.json({
        success: true,
        data: versions,
        source: 'db',
      });
    }
    return res.json({
      success: true,
      data: [],
      source: 'github',
      message: 'Version history is managed via GitHub Releases',
    });
  } catch (error) {
    console.error('Error fetching versions from GitHub:', error.message || error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch versions from GitHub',
    });
  }
});

router.get('/download', async (req, res) => {
  try {
    const release = await fetchLatestRelease();
    const apkAsset = pickApkAsset(release);

    if (!apkAsset) {
      return res.status(404).json({
        success: false,
        error: 'No APK asset available in latest GitHub release',
      });
    }

    return res.redirect(apkAsset.browser_download_url);
  } catch (error) {
    console.error('Error redirecting to APK on GitHub:', error.message || error);
    return res.status(500).json({
      success: false,
      error: 'Failed to redirect to APK on GitHub',
    });
  }
});

router.get('/download-url', async (req, res) => {
  try {
    const release = await fetchLatestRelease();
    const apkAsset = pickApkAsset(release);

    if (!apkAsset) {
      return res.status(404).json({
        success: false,
        error: 'No APK asset available in latest GitHub release',
      });
    }

    const latestVersionName = release.tag_name || release.name || APP_VERSION;

    return res.json({
      success: true,
      data: {
        versionName: latestVersionName,
        downloadUrl: apkAsset.browser_download_url,
        fileSize: apkAsset.size,
        releaseNotes: release.body || '',
        isMandatory: false,
      },
    });
  } catch (error) {
    console.error('Error getting download URL from GitHub:', error.message || error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get download URL from GitHub',
    });
  }
});

router.get('/apk', async (req, res) => {
  try {
    const release = await fetchLatestRelease();
    const apkAsset = pickApkAsset(release);

    if (!apkAsset) {
      return res.status(404).send('No APK asset available in latest GitHub release.');
    }

    return res.redirect(apkAsset.browser_download_url);
  } catch (error) {
    console.error('Error redirecting to APK on GitHub via /apk endpoint:', error.message || error);
    return res.status(500).send('Failed to redirect to APK on GitHub. Please try again later.');
  }
});

router.get('/demo-code', async (req, res) => {
  // Only expose a code from the dedicated demo env var, and only after the
  // strength/placeholder guard and the live-credential collision check pass.
  // Never fall back to a real Admin/super-admin account's channelListCode —
  // that is a live credential and must not be handed out unauthenticated.
  const code = await resolvePublicDemoCode(process.env.DEMO_CHANNEL_LIST_CODE);
  if (!code) {
    return res.status(404).json({ success: false, error: 'Demo code not configured' });
  }
  return res.json({ code });
});

// ---------------------------------------------------------------------------
// Crash reports from the Android app (v1.0.39+). A crashed app often has no
// session, so this endpoint is intentionally public; it is rate-limited per IP
// and every field is trimmed/sized so the payload can never be abused.
// ---------------------------------------------------------------------------
const CrashReport = require('../models/CrashReport');

const crashReportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many crash reports, try again later' },
});

function cleanReportField(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed === '' ? null : trimmed;
}

function cleanReportNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

router.post('/crash-report', crashReportLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const stackTrace =
      typeof body.stackTrace === 'string' && body.stackTrace.length > 0
        ? body.stackTrace.slice(0, 50000)
        : null;

    const report = await CrashReport.create({
      deviceId: cleanReportField(body.deviceId, 128),
      appVersion: cleanReportField(body.appVersion, 40),
      appVersionCode: cleanReportNumber(body.appVersionCode),
      platform: cleanReportField(body.platform, 30),
      deviceModel: cleanReportField(body.deviceModel, 80),
      deviceBrand: cleanReportField(body.deviceBrand, 80),
      androidVersion: cleanReportField(body.androidVersion, 40),
      sdkInt: cleanReportNumber(body.sdkInt),
      totalRamMb: cleanReportNumber(body.totalRamMb),
      freeRamMb: cleanReportNumber(body.freeRamMb),
      freeStorageMb: cleanReportNumber(body.freeStorageMb),
      exceptionType: cleanReportField(body.exceptionType, 200),
      exceptionMessage: cleanReportField(body.exceptionMessage, 2000),
      stackTrace,
      threadName: cleanReportField(body.threadName, 100),
      screen: cleanReportField(body.screen, 100),
    });

    return res.status(201).json({ ok: true, id: String(report._id) });
  } catch (error) {
    console.error('[app-crash] failed to store crash report:', error.message || error);
    return res.status(500).json({ error: 'Failed to store crash report' });
  }
});

module.exports = router;
module.exports._private = {
  normalizeVersion,
  compareVersions,
  versionNameToCode,
  getCanonicalDownloadUrl,
  isStaleLocalDownloadUrl,
  publicDownloadUrl,
  normalizeSha256,
  normalizeChannel,
  normalizePlatform,
  splitReleaseNotes,
  isAllowedDownloadUrl,
  pickLatestVersion,
  toPublicLatestVersion,
};
