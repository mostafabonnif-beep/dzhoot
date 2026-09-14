import { APP_VERSION_DISTRIBUTIONS, APP_VERSION_RELEASE_CHANNELS } from '@dzhoof/shared';

/**
 * Release-metadata rules for the admin versions panel.
 *
 * These helpers are pure and framework-free by design: they decide which
 * release rows look publishable (`missingProvenance`) and what `versionCode` an
 * artifact gets from its semantic `versionName` (`deriveVersionCode`), plus the
 * small display/validation utilities the panel shares with them. The API
 * contract they mirror — including the `release_artifact_complete` and
 * `release_version_code` diagnostics — is documented in
 * `server/docs/API_DOCUMENTATION.md` §6 ("Admin: Manage Release Metadata").
 */

export type ReleaseChannel = (typeof APP_VERSION_RELEASE_CHANNELS)[number];
export type Distribution = (typeof APP_VERSION_DISTRIBUTIONS)[number];

/**
 * Platform scope selectable in this panel. The shared enum additionally accepts
 * `android-mobile`; rows that already carry it keep it (see `platformOptionsFor`).
 */
export const PLATFORM_OPTIONS = ['android', 'android-tv', 'fire-tv'] as const;

/** Release row as returned by GET /admin/app-versions. */
export interface AppVersionRow {
  _id: string;
  versionName: string;
  versionCode: number;
  apkFileName: string | null;
  apkFileSize: number;
  downloadUrl: string | null;
  releaseNotes: string;
  isActive: boolean;
  isMandatory: boolean;
  minCompatibleVersion: number;
  releasedAt: string | null;
  sha256: string | null;
  releaseChannel: ReleaseChannel;
  distribution: Distribution;
  platforms: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type MissingField = 'sha256' | 'apkFileSize' | 'apkFileName' | 'downloadUrl';

/**
 * Same completeness rule the backend diagnostics use (`release_artifact_complete`):
 * sha256 + a positive size + apkFileName + downloadUrl must all be present.
 */
export function missingProvenance(row: AppVersionRow): MissingField[] {
  const missing: MissingField[] = [];
  if (!row.sha256) missing.push('sha256');
  if (!row.apkFileSize || row.apkFileSize <= 0) missing.push('apkFileSize');
  if (!row.apkFileName) missing.push('apkFileName');
  if (!row.downloadUrl) missing.push('downloadUrl');
  return missing;
}

/** Documented derivation: major*10000 + minor*100 + patch. */
export function deriveVersionCode(versionName: string): number | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(versionName.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every((n) => Number.isSafeInteger(n))) return null;
  return major * 10000 + minor * 100 + patch;
}

export function shortSha(sha: string | null): string {
  if (!sha) return '—';
  return sha.length > 14 ? `${sha.slice(0, 10)}…${sha.slice(-4)}` : sha;
}

export function urlHost(url: string | null): string {
  if (!url) return '—';
  try {
    return new URL(url).host;
  } catch {
    return '—';
  }
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

export function platformOptionsFor(existing: string[] | null | undefined): string[] {
  const base: readonly string[] = PLATFORM_OPTIONS;
  const extras = (existing || []).filter((p) => !base.includes(p));
  return [...base, ...extras];
}

const PLATFORM_LABELS: Record<string, [string, string, string]> = {
  android: ['أندرويد', 'Android', 'android'],
  'android-tv': ['أندرويد TV', 'Android TV', 'android-tv'],
  'android-mobile': ['أندرويد جوال', 'Android mobile', 'android-mobile'],
  'fire-tv': ['Fire TV', 'Fire TV', 'fire-tv'],
};

/** Tuple-safe lookup so it can be spread into `pick(ar, fr, en)`. */
export function platformLabel(platform: string): [string, string, string] {
  return PLATFORM_LABELS[platform] || [platform, platform, platform];
}
