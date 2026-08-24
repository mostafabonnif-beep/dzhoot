import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IResellerDocument extends Document {
  name: string;
  city: string;
  phone?: string;
  notes?: string;
  status: 'Active' | 'Inactive';
  /** Wholesale price per plan (سعر الجملة): [{planId, price}] — optional. */
  prices?: Array<{ planId: mongoose.Types.ObjectId; price: number }>;
  /** Portal login (بوابة الموزعين) — set by admin; inactive resellers cannot log in. */
  username?: string;
  passwordHash?: string;
  lastLoginAt?: Date | null;
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
    username: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 50,
      unique: true,
      sparse: true,
      index: true,
    },
    passwordHash: {
      type: String,
      default: '',
      select: false,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

resellerSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  if (!this.passwordHash) return next();
  const salt = await bcrypt.genSalt(12);
  this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
  next();
});

resellerSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidate, this.passwordHash);
};

const Reseller = mongoose.model<IResellerDocument>('Reseller', resellerSchema);

module.exports = Reseller;
export default Reseller;
