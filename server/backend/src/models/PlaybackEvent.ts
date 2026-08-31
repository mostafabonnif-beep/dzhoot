import mongoose, { Document, Schema } from 'mongoose';

export type PlaybackEventType = 'startup_success' | 'startup_failure';

export interface IPlaybackEventDocument extends Document {
  channelId: mongoose.Types.ObjectId;
  eventType: PlaybackEventType;
  startupMs: number | null;
  rebufferCount: number;
  fallbackUsed: boolean;
  fallbackSucceeded: boolean | null;
  errorCode: string | null;
  platform: string | null;
  appVersion: string | null;
  createdAt: Date;
}

const playbackEventSchema = new Schema<IPlaybackEventDocument>(
  {
    channelId: {
      type: Schema.Types.ObjectId,
      ref: 'Channel',
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: ['startup_success', 'startup_failure'],
      required: true,
      index: true,
    },
    startupMs: {
      type: Number,
      min: 0,
      max: 10 * 60 * 1000,
      default: null,
    },
    rebufferCount: {
      type: Number,
      min: 0,
      max: 1000,
      default: 0,
    },
    fallbackUsed: { type: Boolean, default: false },
    fallbackSucceeded: { type: Boolean, default: null },
    errorCode: { type: String, trim: true, maxlength: 100, default: null },
    platform: { type: String, trim: true, maxlength: 30, default: null },
    appVersion: { type: String, trim: true, maxlength: 40, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

playbackEventSchema.index({ createdAt: -1 });
playbackEventSchema.index({ channelId: 1, createdAt: -1 });

const PlaybackEvent = mongoose.model<IPlaybackEventDocument>('PlaybackEvent', playbackEventSchema);

module.exports = PlaybackEvent;
export default PlaybackEvent;
