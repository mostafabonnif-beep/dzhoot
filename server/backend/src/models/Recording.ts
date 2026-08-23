import mongoose, { Schema, Document } from 'mongoose';

export interface IRecordingDocument extends Document {
  /** Catalog channel reference (e.g. `xt:<sourceId>:<streamId>` or `m3u:...`). */
  channelId: string;
  channelName: string;
  channelGroup?: string;
  /** Short stable id used in watch/download links (like youtube.com/live/<id>). */
  slug: string;
  status: 'recording' | 'ready' | 'failed';
  startedAt: Date;
  endedAt?: Date | null;
  durationSec?: number;
  sizeBytes?: number;
  /** Relative filename inside the recordings dir (e.g. `rec-<slug>.mp4`). */
  fileName?: string;
  error?: string;
  createdBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const recordingSchema = new Schema<IRecordingDocument>(
  {
    channelId: { type: String, required: true, index: true },
    channelName: { type: String, required: true, trim: true },
    channelGroup: { type: String, default: '' },
    slug: { type: String, required: true, unique: true },
    status: { type: String, enum: ['recording', 'ready', 'failed'], default: 'recording', index: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    durationSec: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    fileName: { type: String, default: '' },
    error: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

recordingSchema.index({ status: 1, startedAt: -1 });

const Recording = mongoose.model<IRecordingDocument>('Recording', recordingSchema);

module.exports = Recording;
export default Recording;
