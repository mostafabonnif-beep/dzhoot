/**
 * Migration 0010 — Backfill catch-up capability for existing Xtream channels.
 *
 * Channels synced before the catch-up feature carry no `catchup` field, so the
 * API and the Android app cannot tell they support timeshift playback. This
 * backfill flags every live Xtream channel with:
 *
 *   catchup: { type: 'timeshift', days: <XTREAM_TIMESHIFT_DAYS or 3> }
 *
 * M3U channels are left untouched — their catch-up comes from the playlist's
 * own `catchup-source` attributes on the next sync (and is only present when
 * the provider actually advertises it).
 *
 * Safe to re-run: channels that already have catchup.type are skipped.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/migrations/0010-catchup-backfill.ts            # DRY-RUN (default)
 *   npx tsx src/scripts/migrations/0010-catchup-backfill.ts --commit   # apply changes
 *   npm run migrate:catchup-backfill -- --commit
 *
 * ALWAYS take a `mongodump` before running with --commit.
 */
import path from 'path';
import mongoose from 'mongoose';

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

import Channel from '../../models/Channel';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
const COMMIT = process.argv.includes('--commit');
const TIMESHIFT_DAYS = Number(process.env.XTREAM_TIMESHIFT_DAYS) || 3;

async function run(): Promise<void> {
  console.log(`\n=== Migration 0010: catch-up backfill for Xtream channels (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===`);
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected: ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);

  const docs: any[] = await Channel.find(
    { 'metadata.source': 'xtream', 'metadata.xtreamStreamId': { $exists: true }, 'catchup.type': { $exists: false } },
    { channelName: 1, channelId: 1, 'metadata.xtreamSourceId': 1 },
  ).lean();
  console.log(`Xtream channels without catch-up metadata: ${docs.length}`);

  if (!COMMIT) {
    console.log(`\nDry-run complete — no changes written. Re-run with --commit to apply.`);
  } else if (docs.length) {
    const res = await Channel.bulkWrite(
      docs.map((d) => ({
        updateOne: {
          filter: { _id: d._id },
          update: { $set: { 'catchup.type': 'timeshift', 'catchup.days': TIMESHIFT_DAYS } },
        },
      })),
      { ordered: false },
    );
    console.log(`\nUpdated ${res.modifiedCount} channels (catchup: timeshift, ${TIMESHIFT_DAYS} days).`);
  }

  await mongoose.connection.close();
  console.log('Done.\n');
}

run().catch(async (err) => {
  console.error('\nMigration error:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
