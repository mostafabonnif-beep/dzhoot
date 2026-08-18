/**
 * Migration 0011 — backfill playback credential version.
 *
 * Existing users receive version 1. Newly rotated/revoked credentials increment
 * this value so previously issued playback tokens can be invalidated immediately.
 *
 * Usage:
 *   npx tsx src/scripts/migrations/0011-backfill-playback-credential-version.ts
 */
import path from 'path';
import mongoose from 'mongoose';

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
import User from '../../models/User';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';

async function run(): Promise<void> {
  console.log('=== Migration 0011: playback credential version backfill ===');
  await mongoose.connect(MONGODB_URI);
  const result = await User.updateMany(
    { $or: [{ playbackCredentialVersion: { $exists: false } }, { playbackCredentialVersion: null }] },
    { $set: { playbackCredentialVersion: 1 } },
  );
  console.log(`Updated ${result.modifiedCount} users.`);
  await mongoose.connection.close();
}

run().catch(async (err) => {
  console.error('Migration 0011 failed:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
