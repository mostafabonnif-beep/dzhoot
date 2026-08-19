import mongoose, { Document, Schema } from 'mongoose';

export interface IM3USourceDocument extends Document {
  name: string;
  playlistUrlEncrypted: string;
  epgUrlEncrypted?: string | null;
  status: 'Active' | 'Inactive';
  healthStatus: 'ONLINE' | 'DEGRADED' | 'BLOCKED' | 'OFFLINE' | 'AUTH_ERROR' | 'TIMEOUT' | 'INVALID_STREAM';
  lastHttpStatus?: number | null;
  lastLatencyMs?: number | null;
  lastHealthCheckAt?: Date | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncAt?: Date | null;
  lastError?: string | null;
  lastTestAt?: Date | null;
  lastTestOk?: boolean;
  lastTestError?: string | null;
  lastTestPlayableSampleCount?: number;
  stats: {
    channels: number;
    blocked: number;
    duplicates: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const m3uSourceSchema = new Schema<IM3USourceDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    playlistUrlEncrypted: { type: String, required: true },
    epgUrlEncrypted: { type: String, default: null },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Inactive', index: true },
    healthStatus: {
      type: String,
      enum: ['ONLINE', 'DEGRADED', 'BLOCKED', 'OFFLINE', 'AUTH_ERROR', 'TIMEOUT', 'INVALID_STREAM'],
      default: 'OFFLINE',
      index: true,
    },
    lastHttpStatus: { type: Number, default: null },
    lastLatencyMs: { type: Number, default: null },
    lastHealthCheckAt: { type: Date, default: null },
    lastTestAt: { type: Date, default: null },
    lastTestOk: { type: Boolean, default: false },
    lastTestError: { type: String, default: null },
    lastTestPlayableSampleCount: { type: Number, default: 0 },
    syncStatus: { type: String, enum: ['idle', 'syncing', 'error'], default: 'idle', index: true },
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    stats: {
      channels: { type: Number, default: 0 },
      blocked: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

const M3USource = mongoose.model<IM3USourceDocument>('M3USource', m3uSourceSchema);

module.exports = M3USource;
export default M3USource;
