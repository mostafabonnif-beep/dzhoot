import mongoose, { Schema, Document } from 'mongoose';

/**
 * One row per day of platform usage.
 *
 * Redis holds the live windows (minutes/hours); this collection is the durable
 * history behind the resource dashboard, so a Redis restart does not erase what
 * yesterday looked like. Rows expire after 45 days via a TTL index.
 */
export interface IUsageDailyDocument extends Document {
  /** UTC day, `YYYY-MM-DD` (unique). */
  day: string;
  peakConcurrency: number;
  /** Highest sustained egress observed that day (Mbps). */
  peakMbps: number;
  egressGb: number;
  freeConcurrent: number;
  paidConcurrent: number;
  createdAt: Date;
  updatedAt: Date;
}

const usageDailySchema = new Schema<IUsageDailyDocument>(
  {
    day: { type: String, required: true, unique: true, index: true },
    peakConcurrency: { type: Number, default: 0 },
    peakMbps: { type: Number, default: 0 },
    egressGb: { type: Number, default: 0 },
    freeConcurrent: { type: Number, default: 0 },
    paidConcurrent: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 45 },
  },
  { timestamps: true },
);

const UsageDaily = mongoose.model<IUsageDailyDocument>('UsageDaily', usageDailySchema);

module.exports = UsageDaily;
export default UsageDaily;
