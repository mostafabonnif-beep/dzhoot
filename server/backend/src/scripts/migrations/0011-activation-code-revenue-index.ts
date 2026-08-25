/**
 * Migration 0011 — Add { status, activatedAt } index on ActivationCode.
 *
 * The admin business summary (`GET /admin/business/summary`) and the daily ops
 * report filter by `{ status: 'ACTIVATED', activatedAt: { $gte: ... } }`. With
 * no matching index, every dashboard load and daily email scans the whole
 * codes collection (16k+ rows today, more later). Mongoose `autoIndex` creates
 * missing indexes on boot, but running this migration explicitly guarantees it
 * on existing databases and reports the result.
 *
 * Safe to re-run: createIndexes with the same spec is a no-op once present.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/migrations/0011-activation-code-revenue-index.ts            # DRY-RUN (default)
 *   npx tsx src/scripts/migrations/0011-activation-code-revenue-index.ts --commit   # apply
 *
 * ALWAYS take a `mongodump` before running with --commit.
 */
import path from 'path';
import mongoose from 'mongoose';

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

// Importing the model registers its schema (and current index definitions).
import ActivationCode from '../../models/ActivationCode';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
const COMMIT = process.argv.includes('--commit');

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`[0011] connected: ${MONGODB_URI}`);

  const before = (await ActivationCode.collection.indexes()).map((i) => i.name);
  const hasTarget = before.some((n) => n === 'status_1_activatedAt_-1');

  if (hasTarget) {
    console.log('[0011] index { status: 1, activatedAt: -1 } already present — nothing to do.');
  } else if (!COMMIT) {
    console.log('[0011] DRY-RUN: would create index { status: 1, activatedAt: -1 } on activationcodes.');
    console.log('      Re-run with --commit to apply.');
  } else {
    const res = await ActivationCode.collection.createIndex({ status: 1, activatedAt: -1 });
    console.log(`[0011] created index: ${res}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[0011] failed:', err);
  process.exit(1);
});
