import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

/**
 * Reseller API keys (مفاتيح API للموزعين) — machine access to the reseller
 * portal's READ endpoints. The plaintext key is shown exactly once at
 * creation; only a SHA-256 hash is stored. Keys authenticate read-only
 * endpoints via the `X-API-Key` header — they can never write, manage
 * themselves, or outlive their reseller's Active status.
 */
export interface IResellerApiKeyDocument extends Document {
  resellerId: mongoose.Types.ObjectId;
  /** Friendly label set at creation (e.g. "erp-integration"). */
  name: string;
  /** SHA-256 hex of the plaintext key — unique lookup key. */
  tokenHash: string;
  /** First 12 chars of the plaintext key, for identification in UIs. */
  prefix: string;
  active: boolean;
  lastUsedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const resellerApiKeySchema = new Schema<IResellerApiKeyDocument>(
  {
    resellerId: {
      type: Schema.Types.ObjectId,
      ref: 'Reseller',
      required: true,
      index: true,
    },
    name: {
      type: String,
      default: '',
      trim: true,
      maxlength: 60,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    prefix: {
      type: String,
      required: true,
      maxlength: 12,
    },
    active: {
      type: Boolean,
      default: true,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

/** Prefix stamped on every reseller API key (e.g. dzhk_live_ab12cd...). */
export const RESELLER_API_KEY_PREFIX = 'dzhk';

/** Cryptographically random plaintext key — shown once, hashed before storage. */
export function generateResellerApiKey(): string {
  const body = crypto.randomBytes(24).toString('base64url');
  return `${RESELLER_API_KEY_PREFIX}_${body}`;
}

/** SHA-256 hex digest used for at-rest comparison. */
export function hashResellerApiKey(plaintext: string): string {
  return crypto.createHash('sha256').update(String(plaintext)).digest('hex');
}


/** Create a reseller API key: returns the plaintext (shown once) + the doc. */
export async function createResellerApiKey(
  resellerId: string,
  name: string,
): Promise<{ plaintext: string; doc: any }> {
  const plaintext = generateResellerApiKey();
  const tokenHash = hashResellerApiKey(plaintext);
  const prefix = plaintext.slice(0, 12);
  const doc = await ResellerApiKey.create({ resellerId, name, tokenHash, prefix });
  return { plaintext, doc };
}

const ResellerApiKey = mongoose.model<IResellerApiKeyDocument>(
  'ResellerApiKey',
  resellerApiKeySchema,
);



module.exports = ResellerApiKey;
module.exports.createResellerApiKey = createResellerApiKey;
module.exports.hashResellerApiKey = hashResellerApiKey;
module.exports.generateResellerApiKey = generateResellerApiKey;
export default ResellerApiKey;
