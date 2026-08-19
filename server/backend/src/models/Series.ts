import mongoose, { Schema, Document } from 'mongoose';

export interface ISeriesDocument extends Document {
  sourceId: mongoose.Types.ObjectId;
  externalId: string;
  title: string;
  category: string;
  poster?: string;
  backdrop?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  rating?: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const seriesSchema = new Schema<ISeriesDocument>(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: 'XtreamSource', required: true, index: true },
    externalId: { type: String, required: true },
    title: { type: String, required: true, trim: true, index: true },
    category: { type: String, default: 'Uncategorized', index: true },
    poster: { type: String, default: '' },
    backdrop: { type: String, default: '' },
    plot: { type: String, default: '' },
    cast: { type: String, default: '' },
    director: { type: String, default: '' },
    genre: { type: String, default: '' },
    releaseDate: { type: String, default: '' },
    rating: { type: Number, default: null },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

seriesSchema.index({ sourceId: 1, externalId: 1 }, { unique: true });

const Series = mongoose.model<ISeriesDocument>('Series', seriesSchema);

module.exports = Series;
export default Series;
