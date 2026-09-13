import {
  ERROR_CODES,
  ERROR_FEATURES,
  ERROR_SEVERITIES,
  buildErrorReport,
  getErrorDefinition,
  isErrorCode,
} from '@dzhoof/shared';

const REQUIRED_CODES = [
  'UPDATE_CHECK_NETWORK',
  'UPDATE_METADATA_INVALID',
  'UPDATE_NOT_SUPPORTED',
  'UPDATE_DOWNLOAD_FAILED',
  'UPDATE_CHECKSUM_MISMATCH',
  'UPDATE_SIGNATURE_MISMATCH',
  'UPDATE_PACKAGE_MISMATCH',
  'UPDATE_DOWNGRADE_BLOCKED',
  'UPDATE_USER_ACTION_REQUIRED',
  'UPDATE_STORAGE_INSUFFICIENT',
  'UPDATE_INSTALL_FAILED',
  'UPDATE_ROLLBACK_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'PAIRING_EXPIRED',
  'CATALOG_SYNC_FAILED',
  'EPG_SYNC_FAILED',
  'PLAYBACK_SOURCE_TIMEOUT',
  'PLAYBACK_MANIFEST_INVALID',
  'PLAYBACK_DRM_OR_POLICY_BLOCKED',
  'CACHE_READ_FAILED',
  'CACHE_WRITE_FAILED',
  'API_UNAVAILABLE',
] as const;

describe('error taxonomy registry', () => {
  it('defines every code required by the operations brief', () => {
    for (const code of REQUIRED_CODES) {
      expect(Object.prototype.hasOwnProperty.call(ERROR_CODES, code)).toBe(true);
    }
  });

  it('gives every code a complete, non-empty definition', () => {
    for (const [code, definition] of Object.entries(ERROR_CODES)) {
      expect(definition.userMessageKey).toBeTruthy();
      expect(definition.developerMessage.length).toBeGreaterThan(10);
      expect(definition.remediation.length).toBeGreaterThan(10);
      expect(typeof definition.retryable).toBe('boolean');
      expect(ERROR_SEVERITIES).toContain(definition.severity);
      expect(ERROR_FEATURES).toContain(definition.feature);
      // Stable, predictable i18n key derived from the feature and the code.
      expect(definition.userMessageKey).toBe(`errors.${definition.feature}.${code.toLowerCase()}`);
    }
  });

  it('keeps definitions non-sensitive', () => {
    // The intent is "no embedded secrets or raw URLs", not "never mention the word
    // token" — a definition may legitimately describe an expired token.
    const forbidden = [
      /https?:\/\//i, // raw URLs / hostnames
      /[\w.+-]+@[\w-]+\.[\w.]+/, // email addresses
      /\b(password|secret|api[_-]?key)\s*[:=]/i, // credential assignments
      /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i, // bearer tokens
      /\b[a-f0-9]{64}\b/i, // checksums / hex secrets
    ];
    for (const definition of Object.values(ERROR_CODES)) {
      const text = `${definition.developerMessage} ${definition.remediation}`;
      for (const pattern of forbidden) {
        expect(text).not.toMatch(pattern);
      }
    }
  });

  it('isErrorCode accepts only known codes', () => {
    expect(isErrorCode('API_UNAVAILABLE')).toBe(true);
    expect(isErrorCode('NOT_A_REAL_CODE')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(42)).toBe(false);
    // Guards against prototype-chain false positives.
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode('constructor')).toBe(false);
  });

  it('getErrorDefinition returns the registered definition', () => {
    expect(getErrorDefinition('UPDATE_CHECKSUM_MISMATCH')).toEqual(
      expect.objectContaining({ feature: 'update', retryable: true, severity: 'error' }),
    );
  });
});

describe('buildErrorReport', () => {
  it('merges the definition with the runtime context', () => {
    const report = buildErrorReport('UPDATE_CHECK_NETWORK', {
      correlationId: 'corr-1',
      httpStatus: 500,
      durationMs: 1200,
      details: { appVersion: '1.4.2' },
    });

    expect(report).toEqual(
      expect.objectContaining({
        errorCode: 'UPDATE_CHECK_NETWORK',
        feature: 'update',
        retryable: true,
        severity: 'warn',
        correlationId: 'corr-1',
        httpStatus: 500,
        durationMs: 1200,
        details: { appVersion: '1.4.2' },
      }),
    );
  });

  it('defaults absent context to null instead of undefined', () => {
    const report = buildErrorReport('API_UNAVAILABLE');

    expect(report.correlationId).toBeNull();
    expect(report.httpStatus).toBeNull();
    expect(report.durationMs).toBeNull();
    expect(report.details).toBeNull();
  });

  it('exposes exactly the documented, non-sensitive fields', () => {
    const report = buildErrorReport('PAIRING_EXPIRED');

    expect(Object.keys(report).sort()).toEqual(
      [
        'correlationId',
        'details',
        'developerMessage',
        'durationMs',
        'errorCode',
        'feature',
        'httpStatus',
        'remediation',
        'retryable',
        'severity',
        'userMessageKey',
      ].sort(),
    );
  });
});
