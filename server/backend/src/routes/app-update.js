const express = require('express');
const router = express.Router();
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const AppVersion = require('../models/AppVersion');
const { CacheService } = require('../services/cache');
const { appVersionQuerySchema, buildErrorReport } = require('@dzhoof/shared');
const https = require('https');
const http = require('http');
const { validateUrlForSSRF, createPinnedLookup } = require('../utils/ssrf-guard');
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
//
// `release-assets.githubusercontent.com` is where GitHub *currently* sends release
// downloads: the asset URL on github.com answers 302 to a signed URL on that host.
// Leaving it out was the production defect of 2026-09-15 — every checksum fetch
// followed one hop and then failed the allowlist, so
// GET /api/v1/app/version kept answering `sha256: null` while the release carried a
// valid `.sha256` asset. Keep the GitHub hosts in sync with the redirect chain
// (`curl -sI <asset url>`).
const GITHUB_ASSET_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
];

const DEFAULT_DOWNLOAD_HOSTS = [...GITHUB_ASSET_HOSTS];

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

/**
 * Error body built from the central taxonomy (see @dzhoof/shared/errors), so a client
 * branches on `errorCode`/`retryable` instead of parsing `error` text. The legacy
 * `error` string is preserved verbatim for already-shipped clients.
 */
function errorBody(code, req, extra = {}) {
  const report = buildErrorReport(code, { correlationId: req?.requestId });
  return {
    success: false,
    errorCode: report.errorCode,
    userMessageKey: report.userMessageKey,
    retryable: report.retryable,
    requestId: report.correlationId,
    ...extra,
  };
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
    // Provenance of the checksum. `checksumSource` is null when nothing could be
    // verified, so a client (and an operator) can tell "no checksum" apart from
    // "checksum from a source I trust".
    checksumSource: latest.sha256 ? latest.checksumSource || 'db' : null,
    signerSha256: latest.signerSha256 || null,
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

/**
 * The release pipeline also publishes `<apk-base>.release.json` — the provenance
 * manifest described in docs/RELEASE_PROVENANCE.md. It is the only source that binds
 * versionName, versionCode, apkFileName, sizeBytes, sha256 and the signing
 * certificate together, so it is preferred over the bare `.sha256` asset.
 */
const RELEASE_MANIFEST_SUFFIX = '.release.json';
const RELEASE_MANIFEST_SCHEMA_VERSION = 1;
const EXPECTED_PACKAGE_NAME = process.env.GH_APP_PACKAGE_NAME || 'com.dzhoof.iptv';

/**
 * Optional pin for the production signing certificate (the `signerSha256` the release
 * manifest records). When set, a release signed by any other key is refused here as
 * well as on the device — a re-signed APK must never be offered silently.
 */
function expectedSignerSha256() {
  return normalizeSha256(process.env.APP_RELEASE_SIGNER_SHA256);
}

function pickManifestAsset(release, apkAsset) {
  if (!release || !Array.isArray(release.assets) || !apkAsset) return null;
  if (!String(apkAsset.name).toLowerCase().endsWith('.apk')) return null;
  const manifestName = `${apkAsset.name.slice(0, -'.apk'.length)}${RELEASE_MANIFEST_SUFFIX}`;
  return release.assets.find((a) => a && a.name === manifestName && a.browser_download_url) || null;
}

/** Parses a manifest body; `null` means "unusable", never "trust it anyway". */
function parseReleaseManifest(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const raw = JSON.parse(text);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Binds a manifest's claims to the asset a device will actually download. Any
 * disagreement — swapped APK, wrong size, another package, a versionCode that does
 * not match its version name, a truncated checksum — means the identity of the
 * bytes cannot be proven, so the caller must treat the release as unverifiable.
 */
function validateManifestAgainstAsset(manifest, apkAsset) {
  const problems = [];
  if (Number(manifest.schemaVersion) !== RELEASE_MANIFEST_SCHEMA_VERSION) {
    problems.push(`unsupported schemaVersion (${manifest.schemaVersion})`);
  }
  if (manifest.packageName !== EXPECTED_PACKAGE_NAME) {
    problems.push(`packageName is not ${EXPECTED_PACKAGE_NAME}`);
  }
  const sha256 = normalizeSha256(manifest.sha256);
  if (!sha256) problems.push('sha256 is not 64 lowercase hex characters');

  const manifestVersionName = normalizeVersion(manifest.versionName);
  if (!manifestVersionName) {
    problems.push('versionName is missing');
  } else if (versionNameToCode(manifestVersionName) !== Number(manifest.versionCode)) {
    problems.push(
      `versionCode ${manifest.versionCode} does not match versionName ${manifestVersionName}`,
    );
  }
  if (apkAsset) {
    if (manifest.apkFileName !== apkAsset.name) problems.push('apkFileName does not match the APK asset');
    if (Number(manifest.sizeBytes) !== Number(apkAsset.size)) {
      problems.push('sizeBytes does not match the APK asset');
    }
  }
  return {
    ok: problems.length === 0,
    problems,
    sha256,
    signerSha256: normalizeSha256(manifest.signerSha256),
  };
}

const checksumCache = new CacheService('ghsha:', 600); // 10 minutes, same window as the release cache
// Bumped when the cached value's shape changes, so entries written by an older
// build (which stored a bare string) are ignored instead of misread as verified.
const CHECKSUM_CACHE_VERSION = 2;

/**
 * Downloads one small text asset, following redirects manually so *every hop* is
 * checked against the HTTPS allowlist and the SSRF guard before it is requested.
 * NOTE: the hop after github.com is `release-assets.githubusercontent.com` — keep
 * that host in GITHUB_ASSET_HOSTS or every checksum silently resolves to null.
 */
async function fetchTextFollowingValidatedRedirects(url, { maxRedirects = 3, timeout = 8000, maxBytes = 4096 } = {}) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isAllowedDownloadUrl(current)) return null;
    const ssrf = await validateUrlForSSRF(current);
    if (!ssrf.safe) return null;

    // Connect to the address the guard actually validated. Resolving again inside
    // axios would let a DNS answer change between the check and the request (rebinding
    // TOCTOU) for an allowlisted host.
    const parsedHop = new URL(current);
    const pinnedLookup = createPinnedLookup(ssrf.resolvedAddresses || []);
    const hopAgent = pinnedLookup
      ? parsedHop.protocol === 'https:'
        ? new https.Agent({ lookup: pinnedLookup })
        : new http.Agent({ lookup: pinnedLookup })
      : undefined;

    let response;
    try {
      response = await axios.get(current, {
        headers: { Accept: 'text/plain', 'User-Agent': 'DZ-HOOF-Server' },
        timeout,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        responseType: 'text',
        maxRedirects: 0,
        httpAgent: parsedHop.protocol === 'http:' ? hopAgent : undefined,
        httpsAgent: parsedHop.protocol === 'https:' ? hopAgent : undefined,
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

function warnChecksumUnavailable(candidate, reason) {
  console.warn(
    `[app-update] checksum unavailable for ${candidate?.versionName || candidate?.versionCode || 'release'}: ${reason}`,
  );
}

/**
 * Resolves a *verified* SHA-256 for a GitHub candidate, or `null`.
 *
 * Order of trust: the provenance manifest, then the published `.sha256` asset.
 * A manifest that exists but cannot be read or disagrees with its APK is a failure,
 * not a reason to fall back — silently downgrading to the weaker source would hide
 * exactly the tampering this check exists to catch.
 */
async function loadGithubChecksum(candidate) {
  if (!candidate) return null;
  const apkAsset = { name: candidate.apkFileName, size: candidate.apkFileSize };

  if (candidate.manifestAssetUrl) {
    const manifest = parseReleaseManifest(
      await fetchTextFollowingValidatedRedirects(candidate.manifestAssetUrl),
    );
    if (!manifest) {
      warnChecksumUnavailable(candidate, 'the release manifest could not be read');
      return null;
    }
    const verdict = validateManifestAgainstAsset(manifest, apkAsset);
    if (!verdict.ok) {
      warnChecksumUnavailable(candidate, `the release manifest is inconsistent (${verdict.problems.join('; ')})`);
      return null;
    }
    const expectedSigner = expectedSignerSha256();
    // Fail closed on the pin: a manifest that carries no (or an unreadable) signer
    // must not slip past a configured `APP_RELEASE_SIGNER_SHA256` — dropping the field
    // is exactly what a re-signed APK would do.
    if (expectedSigner && verdict.signerSha256 !== expectedSigner) {
      warnChecksumUnavailable(
        candidate,
        verdict.signerSha256
          ? 'the release was signed by an unexpected certificate'
          : 'the release manifest does not carry the pinned signing certificate',
      );
      return null;
    }
    // The pipeline publishes the manifest and the bare `.sha256` asset from the same
    // bytes, so the two only ever disagree when one of them was replaced or
    // mispublished. That is a failure, not a reason to prefer the manifest silently.
    // An *unreadable* `.sha256` is not evidence of tampering — the manifest is the
    // stronger source and the device verifies the downloaded APK itself — so it is
    // reported and the verified manifest still wins.
    if (candidate.sha256AssetUrl) {
      const published = normalizeSha256(
        await fetchTextFollowingValidatedRedirects(candidate.sha256AssetUrl),
      );
      if (published && published !== verdict.sha256) {
        warnChecksumUnavailable(candidate, 'the .sha256 asset disagrees with the release manifest');
        return null;
      }
      if (!published) {
        console.warn(
          `[app-update] the .sha256 asset could not be read for ` +
            `${candidate.versionName || candidate.versionCode}; using the verified manifest instead`,
        );
      }
    }

    return {
      sha256: verdict.sha256,
      source: 'manifest',
      signerSha256: verdict.signerSha256,
      sizeBytes: Number(manifest.sizeBytes) || null,
      apkFileName: manifest.apkFileName || null,
    };
  }

  if (candidate.sha256AssetUrl) {
    const sha256 = normalizeSha256(await fetchTextFollowingValidatedRedirects(candidate.sha256AssetUrl));
    if (sha256) {
      return { sha256, source: 'sha256-asset', signerSha256: null, sizeBytes: null, apkFileName: candidate.apkFileName || null };
    }
    warnChecksumUnavailable(candidate, 'the .sha256 asset could not be read');
    return null;
  }

  warnChecksumUnavailable(candidate, 'the release publishes neither a manifest nor a .sha256 asset');
  return null;
}

/** Cached wrapper around {@link loadGithubChecksum}. */
async function fetchReleaseSha256(candidate) {
  if (!candidate) return null;
  const cacheKey = `v${candidate.versionCode}`;
  const cached = await checksumCache.get(cacheKey);
  if (cached && typeof cached === 'object' && cached.cacheVersion === CHECKSUM_CACHE_VERSION && cached.sha256) {
    return cached;
  }
  const resolved = await loadGithubChecksum(candidate);
  if (resolved) await checksumCache.set(cacheKey, { ...resolved, cacheVersion: CHECKSUM_CACHE_VERSION });
  return resolved;
}

const REQUIRE_CHECKSUM_ENV = 'APP_UPDATE_REQUIRE_CHECKSUM';
/**
 * Whether an update may be advertised without a verified checksum.
 *
 * Default `true` (fail-closed): an APK a device cannot verify is worse than no
 * update at all — the client refuses it, and the operator learns nothing. Set
 * `APP_UPDATE_REQUIRE_CHECKSUM=false` only as a deliberate, temporary escape hatch
 * while a release is fixed.
 */
function requireChecksumFromEnv() {
  const raw = String(process.env[REQUIRE_CHECKSUM_ENV] ?? 'true')
    .trim()
    .toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

const warnedAboutUnverifiedVersions = new Set();
function warnChecksumGate(versionKey) {
  const key = String(versionKey || 'unknown');
  if (warnedAboutUnverifiedVersions.has(key)) return;
  warnedAboutUnverifiedVersions.add(key);
  console.warn(
    `[app-update] withholding update to ${key}: no verified checksum was available ` +
      `(set ${REQUIRE_CHECKSUM_ENV}=false to advertise it anyway)`,
  );
}

const MIN_SUPPORTED_ENV = 'APP_MIN_SUPPORTED_VERSION_CODE';
let warnedAboutMinSupported = false;
let warnedAboutUnreachableFloor = false;

/**
 * The oldest app build the operator still supports (operations brief §4: a device below
 * this must be forced to update). Production serves releases straight from the GitHub
 * fallback, which carries no per-release metadata, so this floor is deployment policy:
 * `APP_MIN_SUPPORTED_VERSION_CODE` in `/etc/dzhoot/.env.production`.
 *
 * An unset, non-numeric or below-1 value keeps the previous behaviour (1 = nothing is
 * forced) and warns once. A typo must never force every installed device to update.
 */
function minSupportedVersionFromEnv() {
  const raw = process.env[MIN_SUPPORTED_ENV];
  if (raw === undefined || String(raw).trim() === '') return 1;

  const parsed = Number(String(raw).trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    if (!warnedAboutMinSupported) {
      warnedAboutMinSupported = true;
      console.warn(
        `[app-update] ignoring ${MIN_SUPPORTED_ENV}: it must be an integer >= 1 (no device is forced to update)`,
      );
    }
    return 1;
  }
  return parsed;
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
    // The deployment-wide floor may raise a release's own minimum, never lower it.
    minCompatibleVersion: Math.max(
      Number(version.minCompatibleVersion) || 1,
      minSupportedVersionFromEnv(),
    ),
    releasedAt: version.releasedAt,
    releaseChannel: normalizeChannel(version.releaseChannel),
    distribution: version.distribution === 'play' || version.distribution === 'managed_device'
      ? version.distribution
      : 'external_apk',
    sha256: normalizeSha256(version.sha256),
    // Recorded so the response can state where a checksum came from; a row without
    // one stays null and the route refuses to advertise the update (see the gate).
    checksumSource: normalizeSha256(version.sha256) ? 'db' : null,
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
    // No per-release metadata on this path, so the operator's floor is the policy.
    minCompatibleVersion: minSupportedVersionFromEnv(),
    releasedAt: release.published_at,
    releaseChannel: 'stable',
    distribution: 'external_apk',
    sha256: null,
    checksumSource: null,
    signerSha256: null,
    sha256AssetUrl: pickSha256Asset(release, apkAsset)?.browser_download_url || null,
    manifestAssetUrl: pickManifestAsset(release, apkAsset)?.browser_download_url || null,
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
      return res.status(400).json(
        errorBody('UPDATE_METADATA_INVALID', req, {
          error: suppliedVersion ? 'Invalid version code' : 'Current version is required',
        }),
      );
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
    // `mandatory` means "the device must take this update", so it only applies when there
    // is an update to take: a floor raised above the newest published build would otherwise
    // strand every device on a blocking prompt with nothing to install.
    const mandatory =
      updateAvailable &&
      (!!latest.isMandatory || currentVersionCode < minimumSupportedVersionCode);

    if (!updateAvailable && currentVersionCode < minimumSupportedVersionCode && !warnedAboutUnreachableFloor) {
      warnedAboutUnreachableFloor = true;
      console.warn(
        '[app-update] the configured minimum supported version is above the newest published release; no device is forced to update',
      );
    }

    // Only pay for the checksum lookup when the device can actually act on it.
    if (updateAvailable && !latest.sha256) {
      const resolved = await fetchReleaseSha256(latest);
      if (resolved) {
        latest.sha256 = resolved.sha256;
        latest.checksumSource = resolved.source;
        latest.signerSha256 = resolved.signerSha256 || null;
      }
    }

    // Release gate: never advertise an update whose bytes cannot be verified. The
    // Android client refuses a null/invalid checksum anyway (UpdateVerifier), so
    // advertising one only produces a download that must be thrown away.
    const checksumRequired = requireChecksumFromEnv();
    const blockedByChecksum = updateAvailable && checksumRequired && !latest.sha256;
    if (blockedByChecksum) warnChecksumGate(latest.versionName || latest.versionCode);

    const updateOffered = updateAvailable && !blockedByChecksum;
    const publicLatest = toPublicLatestVersion(latest, req);

    return res.json({
      success: true,
      updateAvailable: updateOffered,
      mandatory: updateOffered ? mandatory : false,
      currentVersionCode,
      latestVersion: publicLatest,
      ...(blockedByChecksum
        ? {
            updateBlockedReason: 'CHECKSUM_UNAVAILABLE',
            message:
              'A newer release exists but its checksum could not be verified, so it is not offered yet',
          }
        : {}),
      // Legacy top-level fields kept for shipped clients (AppUpdater reads isMandatory).
      currentVersion: currentVersionCode,
      isMandatory: updateOffered ? mandatory : false,
      releaseNotes: publicLatest.releaseNotes,
      downloadUrl: publicLatest.downloadUrl,
      minCompatibleVersion: publicLatest.minCompatibleVersion,
      source: latest.source,
    });
  } catch (error) {
    console.error('Error checking version via GitHub:', error.message || error);
    return res.status(500).json(
      errorBody('UPDATE_CHECK_NETWORK', req, { error: 'Failed to check version from GitHub' }),
    );
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
const { redactSensitiveText } = require('../services/audit-log');

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

/**
 * Free-text fields (exception message, stack trace, screen, thread) are the only
 * place a secret can reach the database through a crash report: a throwable
 * message routinely embeds the URL or token that caused the failure. A crashed
 * app cannot be trusted to have scrubbed its own payload, so redaction happens
 * here, before storage — the operator must never gain credentials from a report.
 */
function cleanReportText(value, max) {
  if (typeof value !== 'string') return null;
  const redacted = redactSensitiveText(value, max).trim();
  return redacted === '' ? null : redacted;
}

function cleanReportNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

const CRASH_SEVERITIES = ['critical', 'error', 'warning', 'info'];

/** Only a known label is stored; anything else becomes null rather than free text. */
function cleanReportSeverity(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CRASH_SEVERITIES.includes(normalized) ? normalized : null;
}

/** Tri-state: an unknown/missing value stays null instead of defaulting to false. */
function cleanReportBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

router.post('/crash-report', crashReportLimiter, async (req, res) => {
  try {
    const body = req.body || {};

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
      // Correlation. A client that cannot name a request id still gets one: the API's
      // own request id is the value the log line for this very upload carries, so a
      // report is never orphaned.
      correlationId: cleanReportField(body.correlationId || body.requestId, 64) || req.requestId || null,
      errorCode: cleanReportField(body.errorCode, 64),
      feature: cleanReportField(body.feature, 60),
      retryable: cleanReportBoolean(body.retryable),
      severity: cleanReportSeverity(body.severity),
      exceptionType: cleanReportText(body.exceptionType, 200),
      exceptionMessage: cleanReportText(body.exceptionMessage, 2000),
      stackTrace: cleanReportText(body.stackTrace, 50000),
      threadName: cleanReportField(body.threadName, 100),
      screen: cleanReportText(body.screen, 100),
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
  minSupportedVersionFromEnv,
  requireChecksumFromEnv,
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
  pickSha256Asset,
  pickManifestAsset,
  parseReleaseManifest,
  validateManifestAgainstAsset,
  GITHUB_ASSET_HOSTS,
};
