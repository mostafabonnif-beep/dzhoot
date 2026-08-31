/**
 * Migration 0012 — Clean provider decoration from channel display names.
 *
 * Upstream catalogs decorate names with provider markers (###### … ######,
 * ᴿᴬᵂ/⁶⁰ᶠᵖˢ/⁽ᴮᴷ⁾ superscripts, 'FR:'/'DZ|'/'CA:' country prefixes). They look
 * unprofessional to customers and hint at the real upstream source. This
 * migration rewrites channelName (and tvgName when it equals the old name so
 * EPG matching stays consistent) using cleanDisplayChannelName().
 *
 * Also reports: (a) post-cleanup exact-name duplicate groups with the
 * suggested best variant to keep, (b) channels already marked dead by the
 * health system. Nothing is deleted — only names are rewritten.
 *
 * Safe to re-run: names already clean are unchanged.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/migrations/0012-catalog-name-cleanup.ts            # DRY-RUN (default)
 *   npx tsx src/scripts/migrations/0012-catalog-name-cleanup.ts --commit   # apply
 *
 * ALWAYS take a `mongodump` before running with --commit.
 */
import path from 'path';
import mongoose from 'mongoose';

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

import Channel from '../../models/Channel';
import { cleanDisplayChannelName, variantRank } from '../../utils/catalog-name-cleaner';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
const COMMIT = process.argv.includes('--commit');

async function run(): Promise<void> {
  console.log(`\n=== Migration 0012: catalog name cleanup (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===`);
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected: ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);

  const all = await Channel.find(
    {},
    { channelName: 1, tvgName: 1, channelGroup: 1, 'metadata.isWorking': 1, metrics: 1 },
  ).lean();
  console.log(`Channels loaded: ${all.length}`);

  // 1) Name rewrites
  const changes: { _id: any; name: string; tvgName?: string }[] = [];
  for (const ch of all as any[]) {
    const cleaned = cleanDisplayChannelName(ch.channelName);
    if (cleaned !== ch.channelName) {
      changes.push({
        _id: ch._id,
        name: cleaned,
        tvgName: ch.tvgName === ch.channelName ? cleaned : undefined,
      });
    }
  }
  console.log(`Names to rewrite: ${changes.length}`);

  // 2) Post-cleanup duplicates (same name, >1 occurrence)
  const nameCount = new Map<string, number>();
  for (const ch of all as any[]) {
    const n = cleanDisplayChannelName(ch.channelName);
    nameCount.set(n, (nameCount.get(n) || 0) + 1);
  }
  const dupGroups = [...nameCount.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  const shown: string[] = [];
  for (const [name, n] of dupGroups) {
    if (n < 3 && shown.length > 6) break;
    shown.push(`  ${n}× "${name}"`);
    if (shown.length >= 10) break;
  }
  console.log(`\nDuplicate groups after cleanup: ${dupGroups.length}`);
  shown.forEach((l) => console.log(l));

  // 3) Already-dead channels (health system verdict)
  const dead = all.filter((ch: any) => ch.metadata?.isWorking === false);
  console.log(`\nChannels marked dead (isWorking=false): ${dead.length}`);
  dead.slice(0, 5).forEach((ch: any) => console.log(`  ${ch.channelName}`));

  if (changes.length) {
    console.log(`\nSample rewrites:`);
    const samples: string[] = [];
    for (const ch of all as any[]) {
      const cleaned = cleanDisplayChannelName(ch.channelName);
      if (cleaned !== ch.channelName) {
        samples.push(`  "${String(ch.channelName).slice(0, 48)}" → "${cleaned}"`);
        if (samples.length >= 8) break;
      }
    }
    samples.forEach((l) => console.log(l));
  }

  if (!COMMIT) {
    console.log(`\nDry-run complete — no changes written. Re-run with --commit to apply.`);
  } else if (changes.length) {
    const res = await Channel.bulkWrite(
      changes.map((c) => ({
        updateOne: {
          filter: { _id: c._id },
          update: {
            $set: {
              channelName: c.name,
              ...(c.tvgName ? { tvgName: c.tvgName } : {}),
            },
          },
        },
      })),
      { ordered: false },
    );
    console.log(`\nUpdated ${res.modifiedCount} channel names.`);
    const remaining = await Channel.countDocuments({
      $or: [{ channelName: /ᴿᴬᵂ|⁶⁰ᶠᵖˢ|⁽ᴮᴷ⁾|#{3,}/u }, { channelName: /^(FR|DZ|CA|UK|MY|US|AR|MAR|TUN)[:|]/iu }],
    });
    console.log(`Names still carrying provider markers: ${remaining}`);
  }

  await mongoose.connection.close();
  console.log('Done.\n');
}

run().catch(async (err) => {
  console.error('\nMigration error:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
