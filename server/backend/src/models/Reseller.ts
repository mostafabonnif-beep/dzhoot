import mongoose, { Schema, Document } from 'mongoose';

export interface IResellerDocument extends Document {
  name: string;
  city: string;
  phone?: string;
  notes?: string;
  status: 'Active' | 'Inactive';
  /** Wholesale price per plan (سعر الجملة): [{planId, price}] — optional. */
  prices?: Array<{ planId: mongoose.Types.ObjectId; price: number }>;
  createdAt: Date;
  updatedAt: Date;
}

const resellerSchema = new Schema<IResellerDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    city: {
      type: String,
      default: '',
      trim: true,
      maxlength: 100,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
      maxlength: 30,
    },
    notes: {
      type: String,
      default: '',
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
      index: true,
    },
    prices: {
      type: [
        {
          _id: false,
          planId: { type: Schema.Types.ObjectId, ref: 'Plan' },
          price: { type: Number, min: 0, default: 0 },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

const Reseller = mongoose.model<IResellerDocument>('Reseller', resellerSchema);

module.exports = Reseller;
export default Reseller;
