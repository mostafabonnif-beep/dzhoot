import mongoose, { Schema, Document } from 'mongoose';

export interface IDeviceDocument extends Document {
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  name?: string;
  platform?: string;
  appVersion?: string;
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
