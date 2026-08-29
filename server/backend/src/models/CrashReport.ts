import mongoose, { Document, Schema } from 'mongoose';

/**
 * Self-reported crashes from the Android app. The app queues a JSON payload on
 * disk when it hits an uncaught exception and uploads it on the next launch,
 * so we get the exact stack trace even though Firebase/Sentry are not wired.
 */
export interface ICrashReportDocument extends Document {
  deviceId: string | null;
  appVersion: string | null;
  appVersionCode: number | null;
  platform: string | null;
  deviceModel: string | null;
  deviceBrand: string | null;
  androidVersion: string | null;
  sdkInt: number | null;
  totalRamMb: number | null;
  freeRamMb: number | null;
  freeStorageMb: number | null;
  exceptionType: string | null;
  exceptionMessage: string | null;
  stackTrace: string | null;
  threadName: string | null;
  screen: string | null;
  createdAt: Date;
}

const crashReportSchema = new Schema<ICrashReportDocument>(
  {
    deviceId: { type: String, trim: true, maxlength: 128, default: null, index: true },
    appVersion: { type: String, trim: true, maxlength: 40, default: null, index: true },
    appVersionCode: { type: Number, default: null },
    platform: { type: String, trim: true, maxlength: 30, default: null },
    deviceModel: { type: String, trim: true, maxlength: 80, default: null },
    deviceBrand: { type: String, trim: true, maxlength: 80, default: null },
    androidVersion: { type: String, trim: true, maxlength: 40, default: null },
    sdkInt: { type: Number, default: null },
    totalRamMb: { type: Number, default: null },
    freeRamMb: { type: Number, default: null },
    freeStorageMb: { type: Number, default: null },
    exceptionType: { type: String, trim: true, maxlength: 200, default: null },
    exceptionMessage: { type: String, trim: true, maxlength: 2000, default: null },
    stackTrace: { type: String, default: null },
    threadName: { type: String, trim: true, maxlength: 100, default: null },
    screen: { type: String, trim: true, maxlength: 100, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

crashReportSchema.index({ createdAt: -1 });
crashReportSchema.index({ exceptionType: 1, createdAt: -1 });

const CrashReport = mongoose.model<ICrashReportDocument>(
  'CrashReport',
  crashReportSchema,
);

module.exports = CrashReport;
export default CrashReport;
