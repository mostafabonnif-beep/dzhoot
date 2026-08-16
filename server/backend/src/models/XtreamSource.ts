import mongoose, { Schema, Document } from 'mongoose';

export interface IXtreamSourceDocument extends Document {
  name: string;
  serverUrl: string;
  usernameEncrypted: string;
  passwordEncrypted: string;
  status: 'Active' | 'Inactive';
  verificationStatus: 'pending' | 'verified' | 'degraded' | 'blocked';
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncAt?: Date | null;
  lastError?: string | null;
  lastDiagnosticsAt?: Date | null;
  verifiedAt?: Date | null;
  lastDiagnostics?: Record<string, unknown> | null;
  stats: {
    channels: number;
    movies: number;
    series: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const xtreamSourceSchema = new Schema<IXtreamSourceDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    serverUrl: { type: String, required: true, trim: true, maxlength: 500 },
    usernameEncrypted: { type: String, required: true },
    passwordEncrypted: { type: String, required: true },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Inactive', index: true },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'degraded', 'blocked'],
      default: 'pending',
      index: true,
    },
    syncStatus: { type: String, enum: ['idle', 'syncing', 'error'], default: 'idle' },
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    lastDiagnosticsAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    lastDiagnostics: { type: Schema.Types.Mixed, default: null },
    stats: {
      channels: { type: Number, default: 0 },
      movies: { type: Number, default: 0 },
      series: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

const XtreamSource = mongoose.model<IXtreamSourceDocument>('XtreamSource', xtreamSourceSchema);

module.exports = XtreamSource;
export default XtreamSource;
