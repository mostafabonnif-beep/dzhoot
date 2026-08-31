import mongoose, { Document, Schema, Types } from 'mongoose';

export type ChannelIdentityMatch = 'tvg-id' | 'name-country' | 'name';

export interface IChannelIdentityDocument extends Document {
  identityKey: string;
  displayName: string;
  normalizedName: string;
  country: string | null;
  language: string | null;
  channelIds: Types.ObjectId[];
  channelCount: number;
  sourceKinds: string[];
  sourceCount: number;
  match: ChannelIdentityMatch;
  confidence: number;
  isActive: boolean;
  lastReconciledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const channelIdentitySchema = new Schema<IChannelIdentityDocument>(
  {
    identityKey: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, index: true },
    country: { type: String, default: null, index: true },
    language: { type: String, default: null },
    channelIds: [{ type: Schema.Types.ObjectId, ref: 'Channel' }],
    channelCount: { type: Number, default: 0 },
    sourceKinds: [{ type: String }],
    sourceCount: { type: Number, default: 0 },
    match: {
      type: String,
      enum: ['tvg-id', 'name-country', 'name'],
      required: true,
    },
    confidence: { type: Number, min: 0, max: 1, required: true },
    isActive: { type: Boolean, default: true, index: true },
    lastReconciledAt: { type: Date, required: true },
  },
  { timestamps: true },
);

channelIdentitySchema.index({ isActive: 1, sourceCount: -1, displayName: 1 });

const ChannelIdentity = mongoose.model<IChannelIdentityDocument>(
  'ChannelIdentity',
  channelIdentitySchema,
);

export default ChannelIdentity;
module.exports = ChannelIdentity;
