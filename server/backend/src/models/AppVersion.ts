import mongoose, { Schema, Model } from 'mongoose';
import {
  APP_VERSION_DISTRIBUTIONS,
  APP_VERSION_PLATFORMS,
  APP_VERSION_RELEASE_CHANNELS,
  IAppVersionDocument,
  IAppVersionModel,
  UpdateCheckResult,
} from '@dzhoof/shared';

const appVersionSchema = new Schema<IAppVersionDocument>(
  {
    versionName: {
      type: String,
      required: true,
      unique: true,
    },
    versionCode: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    apkFileName: {
      type: String,
      required: true,
    },
    apkFileSize: {
      type: Number,
      required: true,
    },
    downloadUrl: {
      type: String,
      required: true,
    },
    releaseNotes: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isMandatory: {
      type: Boolean,
      default: false,
    },
    minCompatibleVersion: {
      type: Number,
      default: 1,
    },
    releasedAt: {
      type: Date,
      default: Date.now,
    },
    // --- Provenance (added with the app-version contract work) ---
    sha256: {
      type: String,
      default: null,
      match: /^[a-f0-9]{64}$/,
    },
    releaseChannel: {
      type: String,
      enum: [...APP_VERSION_RELEASE_CHANNELS],
      default: 'stable',
    },
    distribution: {
      type: String,
      enum: [...APP_VERSION_DISTRIBUTIONS],
      default: 'external_apk',
    },
    // Absent or empty means "all platforms" (see the update route).
    platforms: {
      type: [String],
      enum: [...APP_VERSION_PLATFORMS],
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

// Index for efficient querying
appVersionSchema.index({ versionCode: -1, isActive: 1 });
// Channel-aware lookup used by /api/v1/app/version.
appVersionSchema.index({ isActive: 1, releaseChannel: 1, versionCode: -1 });

// Static method to get latest version
appVersionSchema.statics.getLatestVersion = async function () {
  return await this.findOne({ isActive: true }).sort({ versionCode: -1 }).lean();
};

// Static method to check if update is available
appVersionSchema.statics.checkUpdate = async function (
  currentVersionCode: number,
): Promise<UpdateCheckResult> {
  const latestVersion = await this.findOne({ isActive: true }).sort({ versionCode: -1 }).lean();

  if (!latestVersion) {
    return {
      updateAvailable: false,
      message: 'No version information available',
    };
  }

  if (latestVersion.versionCode > currentVersionCode) {
    return {
      updateAvailable: true,
      isMandatory:
        latestVersion.isMandatory || currentVersionCode < latestVersion.minCompatibleVersion,
      latestVersion: latestVersion,
    };
  }

  return {
    updateAvailable: false,
    message: 'You are using the latest version',
    currentVersion: latestVersion,
  };
};

const AppVersion = mongoose.model<
  IAppVersionDocument,
  Model<IAppVersionDocument> & IAppVersionModel
>('AppVersion', appVersionSchema);

module.exports = AppVersion;
export default AppVersion;
