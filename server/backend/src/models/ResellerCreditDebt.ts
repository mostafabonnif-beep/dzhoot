import mongoose, { Schema, Document } from 'mongoose';

export type CreditDebtStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface IResellerCreditDebtDocument extends Document {
  /** Admin (or any operator) who recorded the debt — scoping owner */
  adminId: mongoose.Types.ObjectId;
  /** The reseller who owes the money */
  resellerId: mongoose.Types.ObjectId;
  /** Amount owed (DZD) */
  amount: number;
  paidAmount: number;
  status: CreditDebtStatus;
  /** Human note (e.g. 'منح رصيد 10 أكواد شهرية') */
  note?: string;
  /** Set when a debt was auto-created from a credit grant (reference) */
  autoFromGrant?: boolean;
  paidAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const resellerCreditDebtSchema = new Schema<IResellerCreditDebtDocument>(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    resellerId: {
      type: Schema.Types.ObjectId,
      ref: 'Reseller',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['UNPAID', 'PARTIAL', 'PAID'],
      default: 'UNPAID',
      index: true,
    },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    autoFromGrant: { type: Boolean, default: false },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

resellerCreditDebtSchema.index({ adminId: 1, status: 1, createdAt: -1 });
resellerCreditDebtSchema.index({ resellerId: 1, status: 1 });

const ResellerCreditDebt = mongoose.model<IResellerCreditDebtDocument>(
  'ResellerCreditDebt',
  resellerCreditDebtSchema,
);

module.exports = ResellerCreditDebt;
export default ResellerCreditDebt;
