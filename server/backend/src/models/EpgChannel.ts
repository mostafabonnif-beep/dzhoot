import mongoose, { Schema } from 'mongoose';
import { IEpgChannelDocument } from '@dzhoof/shared';

/**
 * Guide channel naming metadata, captured from XMLTV `<channel>` elements.
 *
 * This collection exists so the EPG re-match can link catalog channels that have
 * no `tvgId` to a guide id by *name*, not only by id. It is rebuilt incrementally
 * on every EPG refresh (upsert on `channelEpgId`, `$addToSet` on `displayNames`),
 * so it tracks the guides the operator actually ingests.
 */
const epgChannelSchema = new Schema<IEpgChannelDocument>(
  {
    channelEpgId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    displayNames: {
      type: [String],
      default: [],
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

const EpgChannel = mongoose.model<IEpgChannelDocument>('EpgChannel', epgChannelSchema);

module.exports = EpgChannel;
export default EpgChannel;
