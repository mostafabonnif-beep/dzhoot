import mongoose, { Schema, Document } from 'mongoose';

export interface ISeasonDocument extends Document {
  seriesId: mongoose.Types.ObjectId;
  seasonNumber: number;
  name: string;
  cover?: string;
  createdAt: Date;
  updatedAt: Date;
}

const seasonSchema = new Schema<ISeasonDocument>(
  {
    seriesId: { type: Schema.Types.ObjectId, ref: 'Series', required: true, index: true },
    seasonNumber: { type: Number, required: true },
    name: { type: String, default: '' },
    cover: { type: String, default: '' },
  },
  { timestamps: true },
);

seasonSchema.index({ seriesId: 1, seasonNumber: 1 }, { unique: true });

const Season = mongoose.model<ISeasonDocument>('Season', seasonSchema);

module.exports = Season;
export default Season;
