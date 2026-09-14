import mongoose, { Document, Schema } from 'mongoose';

export type WatchContentType = 'live' | 'movie' | 'series' | 'episode';

export interface IWatchProgressDocument extends Document {
  userId: mongoose.Types.ObjectId;
  contentId: string;
  contentType: WatchContentType;
  positionSec: number;
  durationSec: number | null;
  completed: boolean;
  updatedAt: Date;
  createdAt: Date;
}

const watchProgressSchema = new Schema<IWatchProgressDocument>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  contentId: { type: String, required: true },
  contentType: { type: String, enum: ['live', 'movie', 'series', 'episode'], required: true },
  positionSec: { type: Number, required: true, min: 0, default: 0 },
  durationSec: { type: Number, default: null, min: 0 },
  completed: { type: Boolean, default: false },
}, {
  timestamps: true,
});

// One progress row per (user, content) — upsert target.
watchProgressSchema.index({ userId: 1, contentId: 1 }, { unique: true });
// Continue Watching list = most recently updated first.
watchProgressSchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.model<IWatchProgressDocument>('WatchProgress', watchProgressSchema);
