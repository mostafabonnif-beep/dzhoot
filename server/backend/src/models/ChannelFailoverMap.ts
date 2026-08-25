import mongoose, { Schema, Document } from 'mongoose';

/**
 * ChannelFailoverMap — a side-table that maps a catalog channel (from the
 * primary source, e.g. Primary Upstream) to a matching channel on a backup
 * Xtream source (e.g. ottstreambox). When the primary source goes down, the
 * playback-token flow uses this map to issue a token from the backup source
 * instead — no app update, no customer-visible change beyond a 2-5s spinner.
 *
 * The catalog channels themselves are never touched; this is a pure side map.
 */
export interface IChannelFailoverMapDocument extends Document {
  /** Catalog channel _id (the channel document that customers watch). */
  channelId: mongoose.Types.ObjectId;
  /** channel.channelId string of the catalog channel (for index/lookup). */
  channelRef: string;
  /** Backup Xtream source (must exist and be health-checked). */
  backupSourceId: mongoose.Types.ObjectId;
  /** Human-readable name of the channel on the backup source. */
  backupChannelName: string;
  /** stream_id of the channel on the backup source (player_api get_live_streams). */
  backupStreamId: string;
  /** How the mapping was created. */
  matchedBy: 'name' | 'manual';
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const channelFailoverMapSchema = new Schema<IChannelFailoverMapDocument>(
  {
    channelId: {
      type: Schema.Types.ObjectId,
      ref: 'Channel',
      required: true,
    },
    channelRef: {
      type: String,
      required: true,
      trim: true,
    },
    backupSourceId: {
      type: Schema.Types.ObjectId,
      ref: 'XtreamSource',
      required: true,
      index: true,
    },
    backupChannelName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    backupStreamId: {
      type: String,
      required: true,
      trim: true,
    },
    matchedBy: {
      type: String,
      enum: ['name', 'manual'],
      default: 'manual',
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// One mapping per (catalog channel, backup source).
channelFailoverMapSchema.index({ channelRef: 1, backupSourceId: 1 }, { unique: true });
channelFailoverMapSchema.index({ channelId: 1 });

const ChannelFailoverMap = mongoose.model<IChannelFailoverMapDocument>(
  'ChannelFailoverMap',
  channelFailoverMapSchema,
);

module.exports = ChannelFailoverMap;
export default ChannelFailoverMap;
