import mongoose, { Schema, Document } from 'mongoose';

export interface IEpgSourceOverrideDocument extends Document {
  /** The EPG source URL (unique per discovered source). */
  url: string;
  /** Operator-set: when true, the source is excluded from refresh. */
  disabled: boolean;
  /** Optional operator note (e.g. why it was disabled). */
  note?: string | null;
  /** Last time this source was fetched successfully. */
  lastOkAt?: Date | null;
  /** Last time this source failed (fetch/parse error). */
  lastFailedAt?: Date | null;
  /** Last error message (bounded). */
  lastError?: string | null;
  /** Last manual test timestamp + result. */
  lastTestedAt?: Date | null;
  lastTestResult?: {
    ok: boolean;
    programCount?: number;
    error?: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const epgSourceOverrideSchema = new Schema<IEpgSourceOverrideDocument>(
  {
    url: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    note: {
      type: String,
      default: '',
    },
    lastOkAt: {
      type: Date,
      default: null,
    },
    lastFailedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: '',
    },
    lastTestedAt: {
      type: Date,
      default: null,
    },
    lastTestResult: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true },
);

export default (mongoose.models.EpgSourceOverride as mongoose.Model<IEpgSourceOverrideDocument>) ||
  mongoose.model<IEpgSourceOverrideDocument>('EpgSourceOverride', epgSourceOverrideSchema);
