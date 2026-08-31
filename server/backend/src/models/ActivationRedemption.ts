import mongoose, { Schema, Document } from 'mongoose';

export interface IActivationRedemptionDocument extends Document {
  activationCodeId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  deviceId?: string | null;
  subscriptionId?: mongoose.Types.ObjectId | null;
  ipHash?: string | null;
  result: 'SUCCESS' | 'FAILURE';
  failureReason?: string | null;
  createdAt: Date;
}


const activationRedemptionSchema = new Schema<IActivationRedemptionDocument>(
  {
    activationCodeId: {
      type: Schema.Types.ObjectId,
      ref: 'ActivationCode',
      default: null,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      default: null,
    },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    ipHash: {
      type: String,
      default: null,
    },
    result: {
      type: String,
      enum: ['SUCCESS', 'FAILURE'],
      required: true,
      index: true,
    },
    failureReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

activationRedemptionSchema.index({ userId: 1, createdAt: -1 });

const ActivationRedemption = mongoose.model<IActivationRedemptionDocument>(
  'ActivationRedemption',
  activationRedemptionSchema,
);

module.exports = ActivationRedemption;
export default ActivationRedemption;
