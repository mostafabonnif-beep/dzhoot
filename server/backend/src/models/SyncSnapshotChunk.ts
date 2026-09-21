import mongoose, { Document, Schema, Types } from 'mongoose';
import type { SyncSnapshotChannel } from './SyncSnapshot';

/**
 * One slice of a sync snapshot's channel list.
 *
 * Why this collection exists: a snapshot stored the whole "before" list in one document, and
 * MongoDB caps a document at 16MB. At 8.5k channels that fitted; at the catalog this platform
 * actually has (16k+ channels after the primary provider's channels were restored to their
 * source) the insert was rejected — `BSONObj size: 17298727 is invalid` — and EVERY sync of
 * that source failed before writing anything. The sync is what keeps the catalog, VOD and EPG
 * in step, so the fix is to slice the list into documents that are comfortably under the cap
 * instead of dropping the snapshot (which would silently cost the operator the rollback).
 */
export interface ISyncSnapshotChunkDocument extends Document {
  snapshotId: Types.ObjectId;
  index: number;
  channels: SyncSnapshotChannel[];
  createdAt: Date;
  updatedAt: Date;
}

const syncSnapshotChunkSchema = new Schema<ISyncSnapshotChunkDocument>(
  {
    snapshotId: { type: Schema.Types.ObjectId, ref: 'SyncSnapshot', required: true, index: true },
    index: { type: Number, required: true },
    // Mixed holds the array as one value (same shape the snapshot model uses for `metadata`):
    // a typed subdocument array would also work, but Mixed keeps chunk writes cheap and avoids
    // re-typing every field the snapshot already validated.
    channels: { type: Schema.Types.Mixed, default: [] },
  },
  { timestamps: true },
);

syncSnapshotChunkSchema.index({ snapshotId: 1, index: 1 }, { unique: true });

const SyncSnapshotChunk = mongoose.model<ISyncSnapshotChunkDocument>(
  'SyncSnapshotChunk',
  syncSnapshotChunkSchema,
);

export default SyncSnapshotChunk;
module.exports = SyncSnapshotChunk;
