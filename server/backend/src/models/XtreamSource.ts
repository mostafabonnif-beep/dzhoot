import mongoose, { Schema, Document } from 'mongoose';

export interface IXtreamSourceDocument extends Document {
  name: string;
  serverUrl: string;
  usernameEncrypted: string;
  passwordEncrypted: string;
  status: 'Active' | 'Inactive';
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncAt?: Date | null;
  lastError?: string | null;
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
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
    syncStatus: { type: String, enum: ['idle', 'syncing', 'error'], default: 'idle' },
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: null },
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
