import mongoose, { Schema, Document } from 'mongoose';

export interface IResellerDocument extends Document {
  name: string;
  city: string;
  phone?: string;
  notes?: string;
  status: 'Active' | 'Inactive';
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
  },
  { timestamps: true },
);

export default (mongoose.models.Reseller as mongoose.Model<IResellerDocument>) ||
  mongoose.model<IResellerDocument>('Reseller', resellerSchema);
