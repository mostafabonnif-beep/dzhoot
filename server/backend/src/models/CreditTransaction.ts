import mongoose, { Schema, Document } from 'mongoose';

export type CreditTxType = 'GRANT' | 'CONSUME' | 'RETURN' | 'EXPIRE_RETURN';

export interface ICreditTransactionDocument extends Document {
  resellerId: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  /** GRANT = admin added credit · CONSUME = codes generated · RETURN = manual reclaim · EXPIRE_RETURN = auto reclaim after code expiry */
  type: CreditTxType;
  /** Signed quantity: +grant, -consume, +return */
  quantity: number;
  /** Reseller's remaining credit for this plan after this transaction */
  balanceAfter: number;
  /** Reason / human note (e.g. batch number, operator) */
  note?: string;
  /** Who performed it (admin user id, or null for system/reseller actions) */
  createdBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const creditTransactionSchema = new Schema<ICreditTransactionDocument>(
  {
    resellerId: {
      type: Schema.Types.ObjectId,
      ref: 'Reseller',
      required: true,
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['GRANT', 'CONSUME', 'RETURN', 'EXPIRE_RETURN'],
      required: true,
      index: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    note: {
      type: String,
      default: '',
      trim: true,
      maxlength: 300,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

creditTransactionSchema.index({ resellerId: 1, createdAt: -1 });
creditTransactionSchema.index({ resellerId: 1, planId: 1, createdAt: -1 });

const CreditTransaction = mongoose.model<ICreditTransactionDocument>(
  'CreditTransaction',
  creditTransactionSchema,
);

module.exports = CreditTransaction;
export default CreditTransaction;
