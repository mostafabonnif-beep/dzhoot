import mongoose, { Schema, Document } from 'mongoose';

export type ActivationCodeStatus = 'UNUSED' | 'ACTIVATED' | 'REVOKED' | 'EXPIRED';

export interface IActivationCodeDocument extends Document {
  codeHash: string;
  codeLast4: string;
  prefix: string;
  /** AES-256-GCM encrypted copy of the plaintext code, so admins can reveal it later. */
  codeEnc?: string | null;
  planId: mongoose.Types.ObjectId;
  status: ActivationCodeStatus;
  activatedAt?: Date | null;
  activatedBy?: mongoose.Types.ObjectId | null;
  codeExpiresAt?: Date | null;
  notes?: string | null;
  createdBy?: mongoose.Types.ObjectId | null;
  resellerId?: mongoose.Types.ObjectId | null;
  batchId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}


const activationCodeSchema = new Schema<IActivationCodeDocument>(
  {
    codeHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    codeLast4: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    prefix: {
      type: String,
      default: 'DZHF',
      uppercase: true,
      trim: true,
      maxlength: 10,
    },
    // Recoverable copy of the plaintext code (AES-256-GCM via utils/crypto).
    // Optional so legacy hash-only codes keep working; only revealable to admins.
    codeEnc: {
      type: String,
      default: null,
      select: false,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['UNUSED', 'ACTIVATED', 'REVOKED', 'EXPIRED'],
      default: 'UNUSED',
      index: true,
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    activatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    codeExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    notes: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resellerId: {
      type: Schema.Types.ObjectId,
      ref: 'Reseller',
      default: null,
      index: true,
    },
    batchId: {
      type: Schema.Types.ObjectId,
      ref: 'CodeBatch',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

activationCodeSchema.index({ planId: 1, status: 1 });
activationCodeSchema.index({ status: 1, createdAt: -1 });

const ActivationCode = mongoose.model<IActivationCodeDocument>(
  'ActivationCode',
  activationCodeSchema,
);

module.exports = ActivationCode;
export default ActivationCode;
