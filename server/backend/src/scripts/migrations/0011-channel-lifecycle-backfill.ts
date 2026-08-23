/**
 * Migration 0011 — Backfill lifecycle status for existing channels.
 *
 * New imports now default to pending_verification and are not customer-visible
 * until an operator accepts them. Existing catalog rows predate that policy, so
 * this migration preserves their current operator intent:
 *   - disabled rows become disabled;
 *   - flagged or explicitly failed rows become degraded;
 *   - remaining enabled legacy rows become active.
 *
 * The migration is idempotent: rows that already carry lifecycleStatus are not
 * touched. Run dry first and take a database backup before --commit.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/migrations/0011-channel-lifecycle-backfill.ts
 *   npx tsx src/scripts/migrations/0011-channel-lifecycle-backfill.ts --commit
 */
import path from 'path';
import mongoose from 'mongoose';
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
import Channel from '../../models/Channel';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
const COMMIT = process.argv.includes('--commit');

function classify(channel: any): 'active' | 'degraded' | 'disabled' {
  if (channel.isActive === false) return 'disabled';
  if (channel.flaggedBad?.isFlagged === true || channel.metadata?.isWorking === false) return 'degraded';
  return 'active';
}

async function run(): Promise<void> {
  console.log(`\n=== Migration 0011: channel lifecycle backfill (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===`);
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected: ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);

  const channels = await Channel.find(
    { lifecycleStatus: { $exists: false } },
    { isActive: 1, 'metadata.isWorking': 1, 'flaggedBad.isFlagged': 1 },
  ).lean();
  const counts = { active: 0, degraded: 0, disabled: 0 };
  const now = new Date();
  const operations = channels.map((channel: any) => {
    const lifecycleStatus = classify(channel);
    counts[lifecycleStatus] += 1;
    return {
      updateOne: {
        filter: { _id: channel._id, lifecycleStatus: { $exists: false } },
        update: { $set: { lifecycleStatus, lifecycleUpdatedAt: now } },
      },
    };
  });

  console.log(`Candidates: ${channels.length}`);
  console.log(`  active=${counts.active} degraded=${counts.degraded} disabled=${counts.disabled}`);
  if (!COMMIT) {
    console.log('\nDry-run complete — no changes written. Re-run with --commit to apply.');
  } else if (operations.length) {
    const result = await Channel.bulkWrite(operations, { ordered: false });
    console.log(`\nUpdated ${result.modifiedCount} channel lifecycle records.`);
  }

  await mongoose.connection.close();
  console.log('Done.\n');
}

run().catch(async (error) => {
  console.error('\nMigration error:', error);
  await mongoose.connection.close().catch(() => undefined);
  process.exit(1);
});
