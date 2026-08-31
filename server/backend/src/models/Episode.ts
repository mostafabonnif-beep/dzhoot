import mongoose, { Schema, Document } from 'mongoose';

export interface IEpisodeDocument extends Document {
  seriesId: mongoose.Types.ObjectId;
  seasonId: mongoose.Types.ObjectId;
  externalId: string;
  episodeNumber: number;
  title: string;
  description?: string;
  thumbnail?: string;
  duration?: number | null;
  streamUrl: string;
  containerExtension?: string;
  createdAt: Date;
  updatedAt: Date;
}

const episodeSchema = new Schema<IEpisodeDocument>(
  {
    seriesId: { type: Schema.Types.ObjectId, ref: 'Series', required: true, index: true },
    seasonId: { type: Schema.Types.ObjectId, ref: 'Season', required: true, index: true },
    externalId: { type: String, required: true },
    episodeNumber: { type: Number, default: 0 },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    thumbnail: { type: String, default: '' },
    duration: { type: Number, default: null },
    streamUrl: { type: String, required: true },
    containerExtension: { type: String, default: '' },
  },
  { timestamps: true },
);

episodeSchema.index({ seriesId: 1, externalId: 1 }, { unique: true });

const Episode = mongoose.model<IEpisodeDocument>('Episode', episodeSchema);

module.exports = Episode;
export default Episode;
