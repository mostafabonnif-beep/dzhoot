import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IResellerPermissions {
  /** Self-service code generation from plan credit. */
  generateCodes: boolean;
  /** Transfer code credit to another reseller. */
  transfers: boolean;
  /** Renew an activated code (extends its subscription). */
  renew: boolean;
  /** Switch an activated code to another plan. */
  changePackage: boolean;
  /** Suspend / reactivate a customer's subscription. */
  suspend: boolean;
  /** Export the customer's playlist (m3u) for a code. */
  exportM3U: boolean;
  /** View code history (activation, devices, subscription window). */
  viewHistory: boolean;
}

export interface IResellerDocument extends Document {
  name: string;
  city: string;
  phone?: string;
  notes?: string;
  status: 'Active' | 'Inactive';
  /** Wholesale price per plan (سعر الجملة): [{planId, price}] — optional. */
  prices?: Array<{ planId: mongoose.Types.ObjectId; price: number }>;
  /** Code credit per plan (رصيد الأكواد): [{planId, quantity}] — reseller can
   *  self-generate codes while credit remains; decremented on each generation. */
  credit?: Array<{ planId: mongoose.Types.ObjectId; quantity: number }>;
  /** Portal login (بوابة الموزعين) — set by admin; inactive resellers cannot log in. */
  username?: string;
  /** Unique code prefix (3-6 chars) printed on this reseller's codes. */
  prefix?: string;
  passwordHash?: string;
  /** Per-feature capability flags (مصفوفة الصلاحيات). Default: everything on. */
  permissions?: Partial<IResellerPermissions>;
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
    credit: {
      type: [
        {
          _id: false,
          planId: { type: Schema.Types.ObjectId, ref: 'Plan' },
          quantity: { type: Number, min: 0, default: 0 },
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
    /** Unique code prefix (3-6 chars) printed on this reseller's codes — e.g. "ALG1". */
    prefix: {
      type: String,
      uppercase: true,
      trim: true,
      maxlength: 6,
      minlength: 3,
      match: [/^[A-Z0-9]{3,6}$/, 'prefix must be 3-6 letters/numbers'],
      unique: true,
      sparse: true,
      index: true,
    },
    passwordHash: {
      type: String,
      default: '',
      select: false,
    },
    // Per-feature capability matrix (مصفوفة صلاحيات الموزع). Every flag
    // defaults to true so existing resellers keep full access; admins can
    // switch features off per shop from the admin panel.
    permissions: {
      type: {
        generateCodes: { type: Boolean, default: true },
        transfers: { type: Boolean, default: true },
        renew: { type: Boolean, default: true },
        changePackage: { type: Boolean, default: true },
        suspend: { type: Boolean, default: true },
        exportM3U: { type: Boolean, default: true },
        viewHistory: { type: Boolean, default: true },
      },
      _id: false,
      default: () => ({}),
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
