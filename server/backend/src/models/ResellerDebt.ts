import mongoose, { Schema, Document } from 'mongoose';

export type ResellerDebtStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface IResellerDebtDocument extends Document {
  resellerId: mongoose.Types.ObjectId;
  customerName: string;
  customerPhone?: string;
  /** Total amount owed (DZD) */
  amount: number;
  /** How much has been paid so far (for PARTIAL) */
  paidAmount: number;
  quantity?: number | null;
  planName?: string;
  status: ResellerDebtStatus;
  note?: string;
  paidAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const resellerDebtSchema = new Schema<IResellerDebtDocument>(
  {
    resellerId: {
      type: Schema.Types.ObjectId,
      ref: 'Reseller',
      required: true,
      index: true,
    },
    customerName: { type: String, required: true, trim: true, maxlength: 100 },
    customerPhone: { type: String, default: '', trim: true, maxlength: 30 },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    quantity: { type: Number, default: null },
    planName: { type: String, default: '', trim: true, maxlength: 100 },
    status: {
      type: String,
      enum: ['UNPAID', 'PARTIAL', 'PAID'],
      default: 'UNPAID',
      index: true,
    },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

resellerDebtSchema.index({ resellerId: 1, status: 1, createdAt: -1 });

const ResellerDebt = mongoose.model<IResellerDebtDocument>('ResellerDebt', resellerDebtSchema);

module.exports = ResellerDebt;
export default ResellerDebt;
