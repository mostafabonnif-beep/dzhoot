import mongoose, { Document, Schema } from 'mongoose';

export interface IM3USourceDocument extends Document {
  name: string;
  playlistUrlEncrypted: string;
  epgUrlEncrypted?: string | null;
  status: 'Active' | 'Inactive';
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncAt?: Date | null;
  lastError?: string | null;
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
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
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
