import mongoose, { Schema, Document } from 'mongoose';

export type PlanContentType = 'Live' | 'VOD';
export const PLAN_CONTENT_TYPES: PlanContentType[] = ['Live', 'VOD'];

export interface IPlanDocument extends Document {
  name: string;
  description?: string;
  durationDays: number;
  maxDevices: number;
  maxConcurrentStreams: number;
  price?: number;
  currency?: string;
  /** When true, resellers may generate codes with a custom duration override. */
  allowCustomDuration?: boolean;
  /** Which content families this plan unlocks. Empty/missing = both (legacy). */
  contentTypes?: PlanContentType[];
  status: 'Active' | 'Inactive';
  features?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}


const planSchema = new Schema<IPlanDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      default: '',
      maxlength: 500,
    },
    durationDays: {
      type: Number,
      required: true,
      min: 1,
    },
    maxConcurrentStreams: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    maxDevices: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    price: {
      type: Number,
      min: 0,
      default: 0,
    },
    currency: {
      type: String,
      default: 'DZD',
      uppercase: true,
      trim: true,
      maxlength: 10,
    },
    allowCustomDuration: {
      type: Boolean,
      default: false,
    },
    contentTypes: {
      type: [String],
      enum: PLAN_CONTENT_TYPES,
      default: PLAN_CONTENT_TYPES,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
      index: true,
    },
    features: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

planSchema.index({ status: 1, createdAt: -1 });

const Plan = mongoose.model<IPlanDocument>('Plan', planSchema);

module.exports = Plan;
export default Plan;
