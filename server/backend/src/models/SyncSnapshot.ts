import mongoose, { Document, Schema, Types } from 'mongoose';

export type SyncSourceType = 'm3u' | 'xtream';

export interface SyncSnapshotChannel {
  channelId: string;
  channelName: string;
  channelUrlEncrypted: string;
  channelImg?: string;
  tvgId?: string;
  tvgName?: string;
  channelGroup?: string;
  order?: number;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
  catchup?: Record<string, unknown>;
  alternateStreams?: Array<Record<string, unknown>>;
}

export interface ISyncSnapshotDocument extends Document {
  sourceType: SyncSourceType;
  sourceId: Types.ObjectId;
  status: 'preview' | 'applied' | 'rolled_back';
  channels: SyncSnapshotChannel[];
  channelCount: number;
  diff: {
    added: number;
    changed: number;
    removed: number;
    unchanged: number;
    blocked: number;
    duplicate: number;
  };
  createdBy?: Types.ObjectId | null;
  appliedAt?: Date | null;
  rolledBackAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const snapshotChannelSchema = new Schema(
  {
    channelId: { type: String, required: true },
    channelName: { type: String, required: true },
    channelUrlEncrypted: { type: String, required: true },
    channelImg: { type: String, default: '' },
    tvgId: { type: String, default: '' },
    tvgName: { type: String, default: '' },
    channelGroup: { type: String, default: 'Uncategorized' },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    metadata: { type: Schema.Types.Mixed, default: null },
    catchup: { type: Schema.Types.Mixed, default: null },
    alternateStreams: { type: [Schema.Types.Mixed], default: [] },
  },
  { _id: false },
);

const syncSnapshotSchema = new Schema<ISyncSnapshotDocument>(
  {
    sourceType: { type: String, enum: ['m3u', 'xtream'], required: true, index: true },
    sourceId: { type: Schema.Types.ObjectId, required: true, index: true },
    status: { type: String, enum: ['preview', 'applied', 'rolled_back'], required: true, index: true },
    channels: { type: [snapshotChannelSchema], required: true, default: [] },
    channelCount: { type: Number, required: true, default: 0 },
    diff: {
      added: { type: Number, default: 0 },
      changed: { type: Number, default: 0 },
      removed: { type: Number, default: 0 },
      unchanged: { type: Number, default: 0 },
      blocked: { type: Number, default: 0 },
      duplicate: { type: Number, default: 0 },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    appliedAt: { type: Date, default: null },
    rolledBackAt: { type: Date, default: null },
  },
  { timestamps: true },
);

syncSnapshotSchema.index({ sourceType: 1, sourceId: 1, createdAt: -1 });
syncSnapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

const SyncSnapshot = mongoose.model<ISyncSnapshotDocument>('SyncSnapshot', syncSnapshotSchema);

export default SyncSnapshot;
module.exports = SyncSnapshot;
