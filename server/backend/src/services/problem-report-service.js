const crypto = require('crypto');
const { redactSensitiveText } = require('./audit-log');

/**
 * Shared ingest rules for customer problem reports.
 *
 * The report is the only path by which a customer's own words and a device snapshot reach
 * the database, so every rule that keeps credentials out of storage lives here and is
 * applied on the way in — the client's own redaction is a first line, never the only one
 * (a client can be older than the server, and a crashed app cannot be trusted to have
 * scrubbed its payload).
 */

/** Longest accepted user description. Bounded so one report can never dominate a document. */
const MESSAGE_MAX = 2000;

/** Fields the client may send for the device/version context. Anything else is dropped. */
const TEXT_FIELDS = {
  deviceId: 128,
  appVersion: 40,
  platform: 30,
  deviceModel: 80,
  deviceBrand: 80,
  androidVersion: 40,
  feature: 60,
  screen: 100,
  errorCode: 64,
  severity: 20,
  correlationId: 64,
};

const NUMBER_FIELDS = ['appVersionCode', 'sdkInt'];
const SEVERITIES = ['critical', 'error', 'warning', 'info'];

/**
 * Diagnostic keys a report may carry. The list is closed on purpose: a report is a
 * customer-facing surface, so the server decides what a snapshot may contain rather than
 * storing whatever the client happened to send. None of these can identify a content
 * source, a stream URL or a credential; `host` names are kept because "which upstream was
 * unreachable" is unanswerable without them.
 */
const DIAGNOSTIC_SHAPE = {
  strings: {
    appVersion: 40,
    appVersionCode: 12,
    releaseChannel: 20,
    distribution: 30,
    serverVersion: 40,
    serverCommit: 40,
    lastCheckOutcome: 60,
    updateErrorCode: 64,
    deviceClass: 20,
    playbackErrorCode: 64,
    playerName: 40,
  },
  numbers: ['sdkInt', 'freeStorageMb', 'totalRamMb', 'freeRamMb', 'droppedFrames', 'rebufferCount'],
  booleans: ['serverReachable', 'checksumVerified', 'tvDevice', 'isTv'],
};

/** A short, human-quotable id. Crockford-safe alphabet, no look-alike characters. */
function generateReportId() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  // `randomInt` is rejection-sampled, so every character is equally likely. `bytes[i] %
  // alphabet.length` is biased, which CodeQL flags (and which would matter the moment the
  // alphabet length changed).
  for (let i = 0; i < 8; i += 1) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return `DZR-${out}`;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const redacted = redactSensitiveText(value, max).trim();
  return redacted === '' ? null : redacted;
}

function cleanNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function cleanBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function cleanSeverity(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SEVERITIES.includes(normalized) ? normalized : null;
}

/** Keeps only the documented diagnostic keys, redacting and bounding each one. */
function cleanDiagnostics(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const [key, max] of Object.entries(DIAGNOSTIC_SHAPE.strings)) {
    const value = cleanText(input[key], max);
    if (value !== null) out[key] = value;
  }
  for (const key of DIAGNOSTIC_SHAPE.numbers) {
    const value = cleanNumber(input[key]);
    if (value !== null) out[key] = value;
  }
  for (const key of DIAGNOSTIC_SHAPE.booleans) {
    const value = cleanBoolean(input[key]);
    if (value !== null) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Groups reports of the same failure so a spike is visible without reading free text.
 * Deliberately coarse: the same error code on the same feature and build is one class,
 * whichever device hit it.
 */
function buildDedupeKey({ errorCode, feature, appVersionCode }) {
  if (!errorCode && !feature) return null;
  return [errorCode || 'unknown', feature || 'unknown', appVersionCode ?? 'unknown'].join('|');
}

/**
 * Validates and normalises an inbound report.
 *
 * Returns `{ ok: true, report }` or `{ ok: false, error, details }`. A report must say
 * *something*: the previous crash endpoint accepted an empty body and stored a document
 * whose every field was null (observation of 2026-09-15, record
 * `6aa9ce27004c6f39fe9c9dfc`), which is a row no operator can act on and a free way to
 * fill the collection.
 */
function validateReport(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  const message = cleanText(input.message ?? input.description, MESSAGE_MAX);
  const errorCode = cleanText(input.errorCode, TEXT_FIELDS.errorCode);
  const diagnostics = cleanDiagnostics(input.diagnostics);

  if (!message && !errorCode && !diagnostics) {
    return {
      ok: false,
      error: 'A report must include a description, an error code or a diagnostic snapshot',
      code: 'REPORT_CONTENT_REQUIRED',
    };
  }

  const report = {
    message: message || '',
    errorCode,
    severity: cleanSeverity(input.severity),
    retryable: cleanBoolean(input.retryable),
    diagnostics,
  };

  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    report[field] = cleanText(input[field], max);
  }
  for (const field of NUMBER_FIELDS) {
    report[field] = cleanNumber(input[field]);
  }

  report.dedupeKey = buildDedupeKey(report);
  return { ok: true, report };
}

/** Report groups seen in a window — the raw material for "the same problem keeps happening". */
async function summariseGroups(ProblemReport, { since, limit = 20 } = {}) {
  return ProblemReport.aggregate([
    { $match: since ? { createdAt: { $gte: since } } : {} },
    {
      $group: {
        _id: { errorCode: '$errorCode', feature: '$feature', appVersionCode: '$appVersionCode' },
        count: { $sum: 1 },
        devices: { $addToSet: '$deviceId' },
        lastSeenAt: { $max: '$createdAt' },
      },
    },
    { $sort: { count: -1, lastSeenAt: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        errorCode: '$_id.errorCode',
        feature: '$_id.feature',
        appVersionCode: '$_id.appVersionCode',
        count: 1,
        deviceCount: { $size: '$devices' },
        lastSeenAt: 1,
      },
    },
  ]);
}

module.exports = {
  MESSAGE_MAX,
  DIAGNOSTIC_SHAPE,
  generateReportId,
  cleanText,
  cleanDiagnostics,
  buildDedupeKey,
  validateReport,
  summariseGroups,
};
