/**
 * Migration 0015 — Plan content types (work-plan part 5: Live/VOD plans).
 *
 * Adds scoping of plans to Live TV and/or VOD. Existing plans are backfilled
 * with BOTH types so every current subscription keeps working exactly as
 * before — the gate treats a missing/empty array as "both" as well, making
 * this migration idempotent and safe to re-run.
 *
 * The field itself is created lazily by Mongoose on first write; this
 * migration makes the state explicit so admins see accurate data and any
 * aggregation on contentTypes is correct from day one.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/migrations/0015-plan-content-types.ts            # DRY-RUN
 *   npx tsx src/scripts/migrations/0015-plan-content-types.ts --commit   # apply
 */
import path from 'path';
import mongoose from 'mongoose';

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

import Plan from '../../models/Plan';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
const COMMIT = process.argv.includes('--commit');

async function run(): Promise<void> {
  console.log(`\n=== Migration 0015: Plan contentTypes backfill (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===`);
  await mongoose.connect(MONGODB_URI);

  const filter = { $or: [{ contentTypes: { $exists: false } }, { contentTypes: { $size: 0 } }] };
  const count = await Plan.countDocuments(filter);
  console.log(`Plans missing contentTypes: ${count}`);

  if (COMMIT && count > 0) {
    const res = await Plan.updateMany(filter, { $set: { contentTypes: ['Live', 'VOD'] } });
    console.log(`Updated: ${res.modifiedCount}`);
  } else if (!COMMIT) {
    console.log('DRY-RUN — re-run with --commit to apply.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
