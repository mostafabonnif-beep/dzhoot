import mongoose, { Schema, Document } from 'mongoose';

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export interface ISubscriptionDocument extends Document {
  userId: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  activationCodeId?: mongoose.Types.ObjectId | null;
  status: SubscriptionStatus;
  startsAt: Date;
  expiresAt: Date;
  cancelledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}


const subscriptionSchema = new Schema<ISubscriptionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
    },
    activationCodeId: {
      type: Schema.Types.ObjectId,
      ref: 'ActivationCode',
      default: null,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
      default: 'ACTIVE',
      index: true,
    },
    startsAt: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

subscriptionSchema.index({ userId: 1, status: 1 });

const Subscription = mongoose.model<ISubscriptionDocument>(
  'Subscription',
  subscriptionSchema,
);

module.exports = Subscription;
export default Subscription;
