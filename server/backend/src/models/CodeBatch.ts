import mongoose, { Schema, Document } from 'mongoose';

export type CodeBatchStatus = 'delivered' | 'pending';

export interface ICodeBatchDocument extends Document {
  /** The shop/panel owner this delivery was sold to. */
  resellerId: mongoose.Types.ObjectId;
  /** Plan the codes carry (determines the subscription duration on redeem). */
  planId: mongoose.Types.ObjectId;
  /** Per-reseller sequential batch number: "دفعة 1" for shop X, "دفعة 2" for shop X… */
  batchNumber: number;
  /** Number of codes in this delivery. */
  quantity: number;
  /** Date the shop physically received the codes (تاريخ الاستلام). */
  receiptDate: Date;
  notes?: string;
  status: CodeBatchStatus;
  createdBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const codeBatchSchema = new Schema<ICodeBatchDocument>(
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
    batchNumber: {
      type: Number,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 10000,
    },
    receiptDate: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    notes: {
      type: String,
      default: '',
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['delivered', 'pending'],
      default: 'delivered',
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

// A reseller's batches are numbered sequentially.
codeBatchSchema.index({ resellerId: 1, batchNumber: 1 }, { unique: true });

const CodeBatch = mongoose.model<ICodeBatchDocument>('CodeBatch', codeBatchSchema);

module.exports = CodeBatch;
export default CodeBatch;
