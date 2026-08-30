/**
 * Migration 0014 — Backfill `channelListCode` for legacy users.
 *
 * Why: `channelListCode` became `required` after some users already existed.
 * Any full-document `user.save()` (login, favorites sync, device pairing,
 * profile update) re-validates the schema and throws
 * `User validation failed: channelListCode is required`, returning HTTP 500
 * and locking those users out. The login hot-paths have been switched to
 * validation-free `updateOne`, but this migration removes the data defect so
 * every other `user.save()` is safe again.
 *
 * Idempotent — only touches users whose code is missing/blank. Run with:
 *   npm run migrate:user-channellistcode
 */
import mongoose from 'mongoose';
import User from '../../models/User';

async function run(): Promise<void> {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
  await mongoose.connect(uri);
  console.log('[0014] connected');

  const legacy = await (User as any)
    .find({ $or: [{ channelListCode: { $exists: false } }, { channelListCode: null }, { channelListCode: '' }] })
    .select('_id username')
    .lean();

  console.log(`[0014] legacy users missing channelListCode: ${legacy.length}`);
  let fixed = 0;
  for (const u of legacy) {
    const code = await (User as any).generateChannelListCode();
    await (User as any).updateOne({ _id: u._id }, { $set: { channelListCode: code } });
    fixed += 1;
    console.log(`[0014]   ${u.username} -> ${code}`);
  }
  console.log(`[0014] done, backfilled ${fixed}`);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error('[0014] failed', e);
  process.exit(1);
});
