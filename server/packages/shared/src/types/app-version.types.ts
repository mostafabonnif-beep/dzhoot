import { Types, Document } from 'mongoose';

/** Release channels a version can be published on. */
export const APP_VERSION_RELEASE_CHANNELS = ['stable', 'beta'] as const;
export type AppVersionReleaseChannel = (typeof APP_VERSION_RELEASE_CHANNELS)[number];

/** How a build reaches devices. Mirrors the client's three update paths. */
export const APP_VERSION_DISTRIBUTIONS = ['play', 'external_apk', 'managed_device'] as const;
export type AppVersionDistribution = (typeof APP_VERSION_DISTRIBUTIONS)[number];

/** Client platforms the update API accepts. `fire-tv` is normalised to android-tv. */
export const APP_VERSION_PLATFORMS = ['android', 'android-tv', 'android-mobile', 'fire-tv'] as const;
export type AppVersionPlatform = (typeof APP_VERSION_PLATFORMS)[number];

export interface IAppVersion {
  versionName: string;
  versionCode: number;
  apkFileName: string;
  apkFileSize: number;
  downloadUrl: string;
  releaseNotes: string;
  isActive: boolean;
  isMandatory: boolean;
  minCompatibleVersion: number;
  releasedAt: Date;
  /** SHA-256 of the published APK (64 lowercase hex). Optional: older rows have none. */
  sha256?: string | null;
  /** Release channel this version belongs to. Missing on legacy rows, treated as `stable`. */
  releaseChannel?: AppVersionReleaseChannel;
  /** Distribution path for this build. Missing on legacy rows, treated as `external_apk`. */
  distribution?: AppVersionDistribution;
  /** Optional platform scope; absent or empty means "all platforms". */
  platforms?: AppVersionPlatform[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAppVersionDocument extends IAppVersion, Document {
  _id: Types.ObjectId;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  isMandatory?: boolean;
  latestVersion?: IAppVersion;
  message?: string;
  currentVersion?: IAppVersion;
}

export interface IAppVersionModel {
  getLatestVersion(): Promise<IAppVersion | null>;
  checkUpdate(currentVersionCode: number): Promise<UpdateCheckResult>;
}
