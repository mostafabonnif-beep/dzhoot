import {
  deriveVersionCode,
  isHttpsUrl,
  missingProvenance,
  platformOptionsFor,
  shortSha,
  urlHost,
  PLATFORM_OPTIONS,
  type AppVersionRow,
} from '@/lib/release-metadata';

/**
 * Real values taken from the v1.4.2 release row so the cases below double as a
 * regression fixture for the documented `release_artifact_complete` /
 * `release_version_code` rules (server/docs/API_DOCUMENTATION.md §6).
 */
const SHA256 = 'f0494df3f964b5f16ccb50be945e98cc25fa95a8fa187189c399a81a1b481e85';
const APK_FILE_NAME = 'dzhoof-tv-v1.4.2-official.apk';
const APK_FILE_SIZE = 26840396;
const DOWNLOAD_URL =
  'https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.4.2/dzhoof-tv-v1.4.2-official.apk';

function makeRow(overrides: Partial<AppVersionRow> = {}): AppVersionRow {
  return {
    _id: 'row-1',
    versionName: '1.4.2',
    versionCode: 10402,
    apkFileName: APK_FILE_NAME,
    apkFileSize: APK_FILE_SIZE,
    downloadUrl: DOWNLOAD_URL,
    releaseNotes: 'Release notes',
    isActive: true,
    isMandatory: false,
    minCompatibleVersion: 1,
    releasedAt: null,
    sha256: SHA256,
    releaseChannel: 'stable',
    distribution: 'external_apk',
    platforms: ['android', 'android-tv', 'fire-tv'],
    ...overrides,
  };
}

describe('deriveVersionCode', () => {
  it('derives major*10000 + minor*100 + patch', () => {
    expect(deriveVersionCode('1.4.2')).toBe(10402);
    expect(deriveVersionCode('1.3.1')).toBe(10301);
    expect(deriveVersionCode('2.0.0')).toBe(20000);
  });

  it('returns null for empty or garbage input', () => {
    expect(deriveVersionCode('')).toBeNull();
    expect(deriveVersionCode('   ')).toBeNull();
    expect(deriveVersionCode('not-a-version')).toBeNull();
    expect(deriveVersionCode('v1.4.2')).toBeNull();
  });

  it('accepts a semver prefix and tolerates surrounding whitespace', () => {
    expect(deriveVersionCode('1.4.2-beta')).toBe(10402);
    expect(deriveVersionCode('  1.4.2  ')).toBe(10402);
  });
});

describe('missingProvenance', () => {
  it('returns [] for a complete row', () => {
    expect(missingProvenance(makeRow())).toEqual([]);
  });

  it('reports each missing field on its own', () => {
    expect(missingProvenance(makeRow({ sha256: null }))).toEqual(['sha256']);
    expect(missingProvenance(makeRow({ apkFileSize: 0 }))).toEqual(['apkFileSize']);
    expect(missingProvenance(makeRow({ apkFileName: '' }))).toEqual(['apkFileName']);
    expect(missingProvenance(makeRow({ downloadUrl: '' }))).toEqual(['downloadUrl']);
  });

  it('keeps the field order when several are missing at once', () => {
    expect(
      missingProvenance(
        makeRow({ sha256: null, apkFileSize: 0, apkFileName: '', downloadUrl: '' }),
      ),
    ).toEqual(['sha256', 'apkFileSize', 'apkFileName', 'downloadUrl']);
  });

  it('treats a negative size as missing too', () => {
    expect(missingProvenance(makeRow({ apkFileSize: -1 }))).toEqual(['apkFileSize']);
  });
});

describe('isHttpsUrl', () => {
  it('is true only for an https URL', () => {
    expect(isHttpsUrl(DOWNLOAD_URL)).toBe(true);
    expect(isHttpsUrl('  https://example.com/app.apk  ')).toBe(true);
  });

  it('is false for http, relative paths and garbage', () => {
    expect(isHttpsUrl('http://example.com/app.apk')).toBe(false);
    expect(isHttpsUrl('/downloads/app.apk')).toBe(false);
    expect(isHttpsUrl('not a url')).toBe(false);
    expect(isHttpsUrl('')).toBe(false);
  });
});

describe('urlHost', () => {
  it('returns the host of a full URL', () => {
    expect(urlHost(DOWNLOAD_URL)).toBe('github.com');
  });

  it('returns an em dash for null and garbage', () => {
    expect(urlHost(null)).toBe('—');
    expect(urlHost('not a url')).toBe('—');
    expect(urlHost('')).toBe('—');
  });
});

describe('platformOptionsFor', () => {
  it('returns the base options when given null or undefined', () => {
    expect(platformOptionsFor(null)).toEqual([...PLATFORM_OPTIONS]);
    expect(platformOptionsFor(undefined)).toEqual([...PLATFORM_OPTIONS]);
  });

  it('appends extras not already in the base list, without duplicates', () => {
    expect(platformOptionsFor(['android', 'fire-tv'])).toEqual([
      'android',
      'android-tv',
      'fire-tv',
    ]);
    expect(platformOptionsFor(['android-mobile', 'roku'])).toEqual([
      'android',
      'android-tv',
      'fire-tv',
      'android-mobile',
      'roku',
    ]);
  });
});

describe('shortSha', () => {
  it('shortens a long digest to first 10 + ellipsis + last 4', () => {
    expect(shortSha(SHA256)).toBe('f0494df3f9…1e85');
  });

  it('returns the em dash for null', () => {
    expect(shortSha(null)).toBe('—');
  });

  it('leaves short digests untouched and only shortens above 14 chars', () => {
    expect(shortSha('abc123')).toBe('abc123');
    expect(shortSha('abcdefghijklmn')).toBe('abcdefghijklmn');
    expect(shortSha('abcdefghijklmno')).toBe('abcdefghij…lmno');
  });
});
