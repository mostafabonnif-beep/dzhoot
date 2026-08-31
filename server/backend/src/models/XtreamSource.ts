import mongoose, { Schema, Document } from 'mongoose';

export interface IXtreamSourceDocument extends Document {
  name: string;
  serverUrl: string;
  mirrorServerUrls?: string[];
  usernameEncrypted: string;
  passwordEncrypted: string;
  status: 'Active' | 'Inactive';
  verificationStatus: 'pending' | 'verified' | 'degraded' | 'blocked';
  playbackFormat?: 'm3u8' | 'ts' | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncAt?: Date | null;
  catalogOnlyImportedAt?: Date | null;
  customerVisible?: boolean;
  directPlayback?: boolean;
  /** Merge-on-sync: when true, syncing this source maps its streams onto
   *  EXISTING catalog channels (by canonical name) as failover backups and
   *  does NOT create duplicate channel docs — the customer list stays put.
   *  Genuinely new channels are still added. */
  mergeCatalog?: boolean;
  /** Failover tier for channels auto-mapped from a mergeCatalog source. */
  failoverPriority?: number;
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
    // Alternate panel domains for the SAME account (mirror). Used as automatic
    // fallback when the primary serverUrl is unreachable — API/sync first, then
    // playback URLs. Never a different provider (that is what failover maps are for).
    mirrorServerUrls: { type: [String], default: [] },
    usernameEncrypted: { type: String, required: true },
    passwordEncrypted: { type: String, required: true },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Inactive', index: true },
    playbackFormat: { type: String, enum: ['m3u8', 'ts'], default: null },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'degraded', 'blocked'],
      default: 'pending',
      index: true,
    },
    syncStatus: { type: String, enum: ['idle', 'syncing', 'error'], default: 'idle' },
    lastSyncAt: { type: Date, default: null },
    catalogOnlyImportedAt: { type: Date, default: null },
    customerVisible: { type: Boolean, default: false },
    directPlayback: { type: Boolean, default: false },
    mergeCatalog: { type: Boolean, default: false },
    failoverPriority: { type: Number, default: 20, min: 1 },
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
