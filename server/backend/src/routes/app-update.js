const express = require('express');
const router = express.Router();
const axios = require('axios');
const AppVersion = require('../models/AppVersion');

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

async function fetchLatestRelease() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'DZ-HOOF-Server',
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await axios.get(url, { headers });
  return response.data;
}

function pickApkAsset(release) {
  if (!release || !Array.isArray(release.assets)) return null;
  return release.assets.find((a) => a.name && a.name.includes(GITHUB_APK_PATTERN)) || null;
}

router.get('/version', async (req, res) => {
  try {
    const { currentVersion } = req.query;

    if (!currentVersion) {
      return res.status(400).json({
        success: false,
        error: 'Current version is required',
      });
    }

    const currentVersionCode = parseInt(currentVersion, 10);

    if (isNaN(currentVersionCode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid version code',
      });
    }

    // 1) DB-managed versions (set from the admin dashboard) take precedence —
    //    this is how the server distributes APKs without needing a GitHub release.
    const dbLatest = await AppVersion.findOne({ isActive: true })
      .sort({ versionCode: -1 })
      .lean();
    if (dbLatest) {
      const updateAvailable = dbLatest.versionCode > currentVersionCode;
      return res.json({
        success: true,
        updateAvailable,
        latestVersion: {
          versionName: dbLatest.versionName,
          versionCode: dbLatest.versionCode,
          releaseNotes: dbLatest.releaseNotes || '',
          apkFileSize: dbLatest.apkFileSize,
          downloadUrl: dbLatest.downloadUrl,
        },
        currentVersion: currentVersionCode,
        isMandatory: dbLatest.isMandatory || currentVersionCode < dbLatest.minCompatibleVersion,
        releaseNotes: dbLatest.releaseNotes || '',
        downloadUrl: dbLatest.downloadUrl,
        minCompatibleVersion: dbLatest.minCompatibleVersion || 1,
        source: 'db',
      });
    }

    // 2) Fallback: GitHub releases (legacy path).
    const release = await fetchLatestRelease();
    const apkAsset = pickApkAsset(release);

    if (!apkAsset) {
      return res.json({
        success: true,
        updateAvailable: false,
        message: 'No APK asset found in latest GitHub release',
      });
    }

    const latestVersionName = normalizeVersion(release.tag_name || release.name || APP_VERSION);
    const latestVersionCode = versionNameToCode(latestVersionName);
    const updateAvailable = latestVersionCode > currentVersionCode;

    return res.json({
      success: true,
      updateAvailable,
      latestVersion: {
        versionName: latestVersionName,
        versionCode: latestVersionCode,
        releaseNotes: release.body || '',
        apkFileSize: apkAsset.size,
        downloadUrl: apkAsset.browser_download_url,
      },
      currentVersion: currentVersionCode,
      isMandatory: false,
      releaseNotes: release.body || '',
      downloadUrl: apkAsset.browser_download_url,
      minCompatibleVersion: 1,
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
    // DB-managed version takes precedence.
    const dbLatest = await AppVersion.findOne({ isActive: true })
      .sort({ versionCode: -1 })
      .lean();
    if (dbLatest) {
      return res.json({
        success: true,
        data: {
          versionName: dbLatest.versionName,
          versionCode: dbLatest.versionCode,
          releaseNotes: dbLatest.releaseNotes || '',
          apkFileName: dbLatest.apkFileName,
          apkFileSize: dbLatest.apkFileSize,
          downloadUrl: dbLatest.downloadUrl,
          isMandatory: dbLatest.isMandatory || false,
          releasedAt: dbLatest.releasedAt,
        },
        source: 'db',
      });
    }

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
        releaseNotes: release.body || '',
        apkFileName: apkAsset.name,
        apkFileSize: apkAsset.size,
        downloadUrl: apkAsset.browser_download_url,
        isMandatory: false,
        releasedAt: release.published_at,
      },
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

router.get('/demo-code', (req, res) => {
  // Only expose a code from the dedicated demo env var. Never fall back to a real
  // Admin/super-admin account's channelListCode — that is a live credential and
  // must not be handed out unauthenticated.
  const code = process.env.DEMO_CHANNEL_LIST_CODE;
  if (!code) {
    return res.status(404).json({ success: false, error: 'Demo code not configured' });
  }
  return res.json({ code });
});

module.exports = router;
module.exports._private = { normalizeVersion, compareVersions, versionNameToCode };
