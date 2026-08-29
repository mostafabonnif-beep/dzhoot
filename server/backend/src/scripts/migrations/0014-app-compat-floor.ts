/**
 * Migration 0014 — Retire legacy app builds via the compatibility floor.
 *
 * Context (2026-08-29): the deployed Android/TV fleet was scattered across
 * builds 1.0.8 → 1.0.37, several of which no longer start or play streams
 * after the playback-token hardening. The update API already forces clients
 * below `minCompatibleVersion` to update, but the floor was never raised, so
 * old builds kept running (and failing) silently.
 *
 * This migration sets the active (latest) AppVersion's `minCompatibleVersion` to its own
 * `versionCode`, so every older installed build is told the update is MANDATORY and must
 * move to the current release. Run AFTER a new APK has been uploaded + activated in
 * the admin "إصدارات التطبيق" page.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/migrations/0014-app-compat-floor.ts            # DRY-RUN (default) — reports only
 *   npx tsx src/scripts/migrations/0014-app-compat-floor.ts --commit   # apply
 */
import mongoose from 'mongoose';

async function main() {
  const commit = process.argv.includes('--commit');
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dzhoof-iptv';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No DB connection');
  const col = db.collection('appversions');

  const latest = await col.find({ isActive: true }).sort({ versionCode: -1 }).limit(1).next();
  if (!latest) {
    console.log('No active AppVersion found — nothing to do.');
    await mongoose.disconnect();
    return;
  }
  const target = latest.versionCode;
  console.log(`Active version: ${latest.versionName} (code ${target}), floor today: ${latest.minCompatibleVersion ?? 1}`);
  if ((latest.minCompatibleVersion ?? 1) >= target) {
    console.log('Floor already >= active versionCode — no change needed.');
    await mongoose.disconnect();
    return;
  }
  if (!commit) {
    console.log(`[dry-run] would set minCompatibleVersion=${target} on _id=${latest._id}`);
    console.log('Re-run with --commit to apply.');
    await mongoose.disconnect();
    return;
  }
  const res = await col.updateOne(
    { _id: latest._id },
    { $set: { minCompatibleVersion: target, isActive: true } },
  );
  console.log(`updated: matched=${res.matchedCount} modified=${res.modifiedCount}`);
  console.log(`Result: every installed build with versionCode < ${target} will now receive isMandatory=true.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
