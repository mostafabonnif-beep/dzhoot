/**
 * Migration 0016 — AppVersion provenance backfill.
 *
 * Why: `/api/v1/app/version` now reports `releaseChannel` and `distribution`, and
 * the AppVersion model defaults them to `stable` / `external_apk`. Rows written
 * before those fields existed have neither, so the API would fall back to the same
 * defaults at read time — this migration makes the stored state explicit so the
 * admin list, any aggregation, and channel filtering agree with the API.
 *
 * It only touches rows that are missing one of the two fields, so it is idempotent
 * and safe to re-run.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/migrations/0016-app-version-provenance.ts            # DRY-RUN
 *   npx tsx src/scripts/migrations/0016-app-version-provenance.ts --commit   # apply
 */
import path from 'path';
import mongoose from 'mongoose';

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

import AppVersion from '../../models/AppVersion';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
const COMMIT = process.argv.includes('--commit');

export interface ProvenanceBackfillResult {
  /** Rows missing at least one provenance field. */
  matched: number;
  /** Rows actually written (0 on a dry run). */
  modified: number;
}

export const PROVENANCE_FILTER = {
  $or: [
    { releaseChannel: { $exists: false } },
    { releaseChannel: null },
    { distribution: { $exists: false } },
    { distribution: null },
  ],
};

/** Fill the provenance defaults on legacy rows. Exported so it can be unit-tested. */
export async function backfillAppVersionProvenance({
  commit = false,
}: { commit?: boolean } = {}): Promise<ProvenanceBackfillResult> {
  const matched = await AppVersion.countDocuments(PROVENANCE_FILTER);
  if (!commit || matched === 0) return { matched, modified: 0 };

  const result = await AppVersion.updateMany(PROVENANCE_FILTER, {
    $set: { releaseChannel: 'stable', distribution: 'external_apk' },
  });
  return { matched, modified: result.modifiedCount || 0 };
}

async function run(): Promise<void> {
  console.log(`\n=== Migration 0016: AppVersion provenance backfill (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===`);
  await mongoose.connect(MONGODB_URI);

  const result = await backfillAppVersionProvenance({ commit: COMMIT });
  console.log(`Rows missing provenance defaults: ${result.matched}`);
  if (COMMIT) {
    console.log(`Updated: ${result.modified}`);
  } else {
    console.log('DRY-RUN — re-run with --commit to apply.');
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
