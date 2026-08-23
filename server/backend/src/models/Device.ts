import mongoose, { Schema, Document } from 'mongoose';

export interface IDeviceDocument extends Document {
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  name?: string;
  platform?: string;
  appVersion?: string;
  pushToken?: string;
  accessTokenHash?: string;
  accessTokenIssuedAt?: Date;
  accessTokenExpiresAt?: Date | null;
  accessTokenRevokedAt?: Date | null;
  lastSeenAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}


const deviceSchema = new Schema<IDeviceDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    name: {
      type: String,
      default: '',
      maxlength: 200,
    },
    platform: {
      type: String,
      default: '',
      maxlength: 50,
    },
    appVersion: {
      type: String,
      default: '',
      maxlength: 50,
    },
    pushToken: {
      type: String,
      default: '',
      maxlength: 4096,
      select: false,
    },
    // SHA-256 hash only. The 256-bit raw device token is returned once to the
    // paired client and must never be stored, serialized, or logged by the API.
    accessTokenHash: {
      type: String,
      default: null,
      select: false,
      index: true,
      sparse: true,
    },
    accessTokenIssuedAt: {
      type: Date,
      default: null,
      select: false,
    },
    accessTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    accessTokenRevokedAt: {
      type: Date,
      default: null,
      select: false,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

deviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

const Device = mongoose.model<IDeviceDocument>('Device', deviceSchema);

module.exports = Device;
export default Device;
