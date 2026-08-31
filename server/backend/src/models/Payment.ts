import mongoose, { Schema, Document } from 'mongoose';

/**
 * Online payment checkout (Chargily Pay — EDAHABIA/CIB/Chargily App, DZD).
 *
 * A Payment tracks one Chargily "Checkout" from creation through the webhook
 * that confirms (or fails) it. On confirmed payment we generate exactly one
 * activation code (same mechanism resellers/admins already use) and store an
 * AES-256-GCM encrypted copy so the customer can reveal it once on the
 * success page — the code itself is never logged or returned in plaintext
 * anywhere else.
 */

export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'canceled' | 'expired';

export interface IPaymentDocument extends Document {
  provider: 'chargily';
  /** Random, unguessable token given to the browser (never the Mongo _id) so the
   * success/failure page can poll status without exposing an enumerable ID. */
  publicToken: string;
  /** Chargily's checkout ID (entity id) — set once creation succeeds. */
  checkoutId?: string | null;
  status: PaymentStatus;
  planId: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  paymentMethod?: string | null;
  checkoutUrl?: string | null;
  /** Attribution: which shop/reseller's QR/link this purchase came through, if any. */
  resellerId?: mongoose.Types.ObjectId | null;
  customerPhone?: string | null;
  /** Set once the webhook confirms payment and a code has been generated. */
  activationCodeId?: mongoose.Types.ObjectId | null;
  /** AES-256-GCM encrypted plaintext code — revealed once on the success page. */
  codeEnc?: string | null;
  failureReason?: string | null;
  fulfilledAt?: Date | null;
  requestIp?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPaymentDocument>(
  {
    provider: {
      type: String,
      enum: ['chargily'],
      default: 'chargily',
      required: true,
    },
    publicToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    checkoutId: {
      type: String,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed', 'canceled', 'expired'],
      default: 'pending',
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    currency: {
      type: String,
      default: 'dzd',
      lowercase: true,
      trim: true,
      maxlength: 10,
    },
    paymentMethod: {
      type: String,
      default: null,
    },
    checkoutUrl: {
      type: String,
      default: null,
    },
    resellerId: {
      type: Schema.Types.ObjectId,
      ref: 'Reseller',
      default: null,
      index: true,
    },
    customerPhone: {
      type: String,
      default: null,
      trim: true,
      maxlength: 30,
    },
    activationCodeId: {
      type: Schema.Types.ObjectId,
      ref: 'ActivationCode',
      default: null,
    },
    codeEnc: {
      type: String,
      default: null,
      select: false,
    },
    failureReason: {
      type: String,
      default: null,
      maxlength: 500,
    },
    fulfilledAt: {
      type: Date,
      default: null,
    },
    requestIp: {
      type: String,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
  },
);

paymentSchema.index({ status: 1, createdAt: -1 });

const Payment = mongoose.model<IPaymentDocument>('Payment', paymentSchema);

module.exports = Payment;
export default Payment;
