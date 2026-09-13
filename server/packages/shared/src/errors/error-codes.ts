/**
 * Central, searchable error taxonomy (operations brief §11).
 *
 * Every failure the app, the update pipeline or the API reports should carry one of
 * these codes instead of free text, so decisions — retry? roll back? which Arabic
 * message? — are made on a stable identifier and never by parsing message strings.
 *
 * Definitions are non-sensitive by construction: no credentials, no raw stream URLs,
 * no user identifiers. Runtime facts (correlation id, HTTP status, duration) are added
 * by `buildErrorReport`, never baked into the registry.
 */

export const ERROR_SEVERITIES = ['warn', 'error', 'fatal'] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

export const ERROR_FEATURES = [
  'update',
  'auth',
  'pairing',
  'catalog',
  'epg',
  'playback',
  'cache',
  'api',
] as const;
export type ErrorFeature = (typeof ERROR_FEATURES)[number];

export interface ErrorDefinition {
  /** i18n key a client resolves to a user-facing (Arabic-first) message. */
  userMessageKey: string;
  /** Non-sensitive explanation for developers and logs. */
  developerMessage: string;
  /** Whether repeating the same operation can plausibly succeed. */
  retryable: boolean;
  severity: ErrorSeverity;
  feature: ErrorFeature;
  /** What the user or operator should do about it. */
  remediation: string;
}

function define(
  feature: ErrorFeature,
  code: string,
  definition: Omit<ErrorDefinition, 'feature' | 'userMessageKey'>,
): ErrorDefinition {
  return {
    userMessageKey: `errors.${feature}.${code.toLowerCase()}`,
    feature,
    ...definition,
  };
}

export const ERROR_CODES = {
  // --- App update pipeline -------------------------------------------------
  UPDATE_CHECK_NETWORK: define('update', 'UPDATE_CHECK_NETWORK', {
    developerMessage: 'The update check request failed (network or release provider unavailable).',
    retryable: true,
    severity: 'warn',
    remediation: 'Retry later; the app keeps working on the installed version.',
  }),
  UPDATE_METADATA_INVALID: define('update', 'UPDATE_METADATA_INVALID', {
    developerMessage: 'The release metadata was missing, malformed or failed schema validation.',
    retryable: false,
    severity: 'error',
    remediation: 'Fix or republish the release metadata; devices must not act on it.',
  }),
  UPDATE_NOT_SUPPORTED: define('update', 'UPDATE_NOT_SUPPORTED', {
    developerMessage: 'This device/version cannot take the offered update path.',
    retryable: false,
    severity: 'warn',
    remediation: 'Install the supported distribution (Play or external APK) manually.',
  }),
  UPDATE_DOWNLOAD_FAILED: define('update', 'UPDATE_DOWNLOAD_FAILED', {
    developerMessage: 'The APK download did not complete (network, storage or server error).',
    retryable: true,
    severity: 'warn',
    remediation: 'Check connectivity and free storage, then retry the download.',
  }),
  UPDATE_CHECKSUM_MISMATCH: define('update', 'UPDATE_CHECKSUM_MISMATCH', {
    developerMessage: 'The downloaded APK SHA-256 does not match the published checksum.',
    retryable: true,
    severity: 'error',
    remediation: 'Delete the partial download and retry; if it repeats, the release is bad.',
  }),
  UPDATE_SIGNATURE_MISMATCH: define('update', 'UPDATE_SIGNATURE_MISMATCH', {
    developerMessage: 'The APK signing certificate does not match the installed application.',
    retryable: false,
    severity: 'error',
    remediation: 'Do not install; uninstall and install the official signed build instead.',
  }),
  UPDATE_PACKAGE_MISMATCH: define('update', 'UPDATE_PACKAGE_MISMATCH', {
    developerMessage: 'The downloaded APK package name or versionCode is not the expected one.',
    retryable: false,
    severity: 'error',
    remediation: 'Do not install; verify the release artifact server-side.',
  }),
  UPDATE_DOWNGRADE_BLOCKED: define('update', 'UPDATE_DOWNGRADE_BLOCKED', {
    developerMessage: 'The offered version is older than or equal to the installed versionCode.',
    retryable: false,
    severity: 'warn',
    remediation: 'No action; the device is already on an equal or newer build.',
  }),
  UPDATE_USER_ACTION_REQUIRED: define('update', 'UPDATE_USER_ACTION_REQUIRED', {
    developerMessage: 'Android requires explicit user confirmation before installing the APK.',
    retryable: true,
    severity: 'warn',
    remediation: 'Approve the system installer prompt to finish the update.',
  }),
  UPDATE_STORAGE_INSUFFICIENT: define('update', 'UPDATE_STORAGE_INSUFFICIENT', {
    developerMessage: 'Not enough free storage to download or stage the APK.',
    retryable: true,
    severity: 'warn',
    remediation: 'Free device storage, then retry the update.',
  }),
  UPDATE_INSTALL_FAILED: define('update', 'UPDATE_INSTALL_FAILED', {
    developerMessage: 'PackageInstaller reported a failure while installing the APK.',
    retryable: true,
    severity: 'error',
    remediation: 'Retry the install; if it repeats, collect a diagnostics report.',
  }),
  UPDATE_ROLLBACK_REQUIRED: define('update', 'UPDATE_ROLLBACK_REQUIRED', {
    developerMessage: 'A published release is faulty and the previous version must be restored.',
    retryable: false,
    severity: 'fatal',
    remediation: 'Unpublish the release in the admin panel and roll back to the last good version.',
  }),

  // --- Auth / pairing ------------------------------------------------------
  AUTH_SESSION_EXPIRED: define('auth', 'AUTH_SESSION_EXPIRED', {
    developerMessage: 'The session or token is no longer valid.',
    retryable: false,
    severity: 'warn',
    remediation: 'Sign in again to obtain a fresh session.',
  }),
  PAIRING_EXPIRED: define('pairing', 'PAIRING_EXPIRED', {
    developerMessage: 'The pairing PIN or request expired before it was confirmed.',
    retryable: true,
    severity: 'warn',
    remediation: 'Start pairing again to get a new PIN.',
  }),

  // --- Catalog / EPG -------------------------------------------------------
  CATALOG_SYNC_FAILED: define('catalog', 'CATALOG_SYNC_FAILED', {
    developerMessage: 'The channel catalog sync did not complete.',
    retryable: true,
    severity: 'error',
    remediation: 'Retry the sync; check the source status in the admin panel.',
  }),
  EPG_SYNC_FAILED: define('epg', 'EPG_SYNC_FAILED', {
    developerMessage: 'The EPG refresh did not complete.',
    retryable: true,
    severity: 'warn',
    remediation: 'Retry later; existing guide data stays available.',
  }),

  // --- Playback ------------------------------------------------------------
  PLAYBACK_SOURCE_TIMEOUT: define('playback', 'PLAYBACK_SOURCE_TIMEOUT', {
    developerMessage: 'The stream source did not respond within the timeout.',
    retryable: true,
    severity: 'warn',
    remediation: 'Retry the stream or switch to another source for this channel.',
  }),
  PLAYBACK_MANIFEST_INVALID: define('playback', 'PLAYBACK_MANIFEST_INVALID', {
    developerMessage: 'The HLS manifest was missing, malformed or unparsable.',
    retryable: true,
    severity: 'error',
    remediation: 'Retry the stream; report the channel if it keeps failing.',
  }),
  PLAYBACK_DRM_OR_POLICY_BLOCKED: define('playback', 'PLAYBACK_DRM_OR_POLICY_BLOCKED', {
    developerMessage: 'Playback was blocked by DRM or by the subscription/policy gate.',
    retryable: false,
    severity: 'warn',
    remediation: 'Check the subscription/plan for this content.',
  }),

  // --- Cache / API ---------------------------------------------------------
  CACHE_READ_FAILED: define('cache', 'CACHE_READ_FAILED', {
    developerMessage: 'Reading from the cache layer failed; the caller fell back to the origin.',
    retryable: true,
    severity: 'warn',
    remediation: 'No action needed; caching is best-effort.',
  }),
  CACHE_WRITE_FAILED: define('cache', 'CACHE_WRITE_FAILED', {
    developerMessage: 'Writing to the cache layer failed.',
    retryable: true,
    severity: 'warn',
    remediation: 'No action needed; caching is best-effort.',
  }),
  API_UNAVAILABLE: define('api', 'API_UNAVAILABLE', {
    developerMessage: 'The backend API could not be reached or returned an unusable response.',
    retryable: true,
    severity: 'error',
    remediation: 'Retry with backoff; check /health/ready if it persists.',
  }),
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

export function getErrorDefinition(code: ErrorCode): ErrorDefinition {
  return ERROR_CODES[code];
}

/** Flat, primitive-only context — keeps accidentally sensitive objects out of reports. */
export type ErrorReportDetails = Record<string, string | number | boolean | null>;

export interface ErrorReportContext {
  /** Random per-operation id that links app, API and log lines. Never a user identity. */
  correlationId?: string;
  httpStatus?: number;
  durationMs?: number;
  details?: ErrorReportDetails;
}

export interface ErrorReport extends ErrorDefinition {
  errorCode: ErrorCode;
  correlationId: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  details: ErrorReportDetails | null;
}

/** Builds the safe, non-sensitive shape shared by telemetry and diagnostics reports. */
export function buildErrorReport(code: ErrorCode, context: ErrorReportContext = {}): ErrorReport {
  return {
    ...getErrorDefinition(code),
    errorCode: code,
    correlationId: context.correlationId ?? null,
    httpStatus: context.httpStatus ?? null,
    durationMs: context.durationMs ?? null,
    details: context.details ?? null,
  };
}
