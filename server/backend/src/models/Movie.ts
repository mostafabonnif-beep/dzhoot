import mongoose, { Schema, Document } from 'mongoose';

export interface IMovieDocument extends Document {
  sourceId: mongoose.Types.ObjectId;
  externalId: string;
  title: string;
  category: string;
  poster?: string;
  backdrop?: string;
  description?: string;
  year?: number | null;
  duration?: number | null;
  rating?: number | null;
  streamUrl: string;
  containerExtension?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const movieSchema = new Schema<IMovieDocument>(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: 'XtreamSource', required: true, index: true },
    externalId: { type: String, required: true },
    title: { type: String, required: true, trim: true, index: true },
    category: { type: String, default: 'Uncategorized', index: true },
    poster: { type: String, default: '' },
    backdrop: { type: String, default: '' },
    description: { type: String, default: '' },
    year: { type: Number, default: null },
    duration: { type: Number, default: null },
    rating: { type: Number, default: null },
    streamUrl: { type: String, required: true },
    containerExtension: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

movieSchema.index({ sourceId: 1, externalId: 1 }, { unique: true });

const Movie = mongoose.model<IMovieDocument>('Movie', movieSchema);

module.exports = Movie;
export default Movie;
