/**
 * Migration 0013 — Backfill tvgId for Arabic/international channels so the
 * fetched XMLTV guides (epgshare beIN, iptv-epg.org, .tr guide) actually
 * populate the app guide.
 *
 * Problem found live: the EPG pipeline works (120k+ programs in DB) but only
 * ~2.5k of 16.6k channels have a tvgId that resolves to an existing guide id.
 *
 * Strategy (all data-driven from the ids that ACTUALLY exist in EpgProgram):
 *   1. beIN family: BEIN SPORTS n → beIN_SPORTS{n}_DIGITAL_Mono_AR.bein
 *      (fallback beINSP{n}.tr); ALKASS n → Alkass_{n}_AR.bein;
 *      AL JAZEERA ARABIC → AL.JAZEERA.ARABIC.tr (+ INTERNATIONAL variant).
 *   2. Generic exact match: catalog display name (cleaned) == epg-id-derived
 *      name (cleaned) — e.g. 'CARTOON NETWORK' → CARTOON.NETWORK.tr.
 *      Only exact normalized matches, so no wrong links.
 *
 * Fixes applied in this version (2026-08-30):
 *   - Family matching now runs on the CLEANED name ("SP⚽RTS" → "SPORTS") and
 *     never silently falls back to beIN 1 when the guide lacks the requested
 *     number ("beIN SP⚽RTS 5" previously resolved to beIN_SPORTS1).
 *   - Channels whose existing tvgId contradicts the cleaned name (e.g. a
 *     beIN 5 channel stamped with the beIN 1 guide id) get tvgId cleared so
 *     the app stops showing the wrong schedule.
 *
 * Logic lives in src/utils/epg-id-resolver.ts (unit-tested).
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/migrations/0013-epg-arabic-backfill.ts            # DRY-RUN (default)
 *   npx tsx src/scripts/migrations/0013-epg-arabic-backfill.ts --commit   # apply
 */
import path from 'path';
import mongoose from 'mongoose';

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

import Channel from '../../models/Channel';
import EpgProgram from '../../models/EpgProgram';
import { resolveEpgIdForChannel, epgIdName, extractBeinNumber } from '../../utils/epg-id-resolver';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
const COMMIT = process.argv.includes('--commit');

/** A tvgId pointing at a beIN guide id, e.g. beIN_SPORTS2_DIGITAL_Mono_AR.bein. */
const BEIN_TVG_ID = /^bein[_\s]?sports?(\d{1,2})/i;

async function run(): Promise<void> {
  console.log(`\n=== Migration 0013: EPG Arabic/international backfill (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===`);
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected: ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);

  const availableIds: string[] = (await EpgProgram.distinct('channelEpgId')).sort();
  const available = new Set(availableIds.map((x) => x.toLowerCase()));
  console.log(`Available guide ids: ${availableIds.length}`);

  // Resolve a (lowercase) candidate id back to its original case in the guides.
  const byLower = new Map<string, string>();
  for (const id of availableIds) byLower.set(id.toLowerCase(), id);

  // Generic index: canonical name → preferred id (prefer non-.tr for multi-country).
  const nameToId = new Map<string, string>();
  for (const id of availableIds) {
    const key = epgIdName(id);
    if (!key || key.length < 3) continue;
    const existing = nameToId.get(key);
    if (!existing || /\.tr$/.test(existing)) nameToId.set(key, id);
  }

  const channels = await Channel.find(
    {},
    { channelName: 1, tvgId: 1, channelId: 1 },
  ).lean();
  console.log(`Catalog channels: ${channels.length}`);

  const updates: { _id: any; name: string; tvgId: string; via: string }[] = [];
  const unsets: { _id: any; name: string; oldTvgId: string; via: string }[] = [];
  const stats = new Map<string, number>();

  for (const ch of channels as any[]) {
    const name = String(ch.channelName || '');
    if (!name) continue;

    const currentTvg = String(ch.tvgId || '');

    // ─── Fix misassigned beIN ids ──────────────────────────────────
    // A channel named "beIN ... 5" stamped with a beIN 1 guide id shows the
    // wrong schedule. Detect and clear it (the resolver below will not
    // re-map it because the guide has no beIN 5 id).
    const tvgBein = currentTvg.match(BEIN_TVG_ID);
    const nameBein = extractBeinNumber(name);
    if (tvgBein && nameBein && nameBein !== tvgBein[1]) {
      unsets.push({ _id: ch._id, name, oldTvgId: currentTvg, via: 'bein-misassign' });
      continue;
    }

    if (currentTvg && available.has(currentTvg.toLowerCase())) continue; // already covered

    const resolution = resolveEpgIdForChannel({
      channelName: name,
      availableIds: available,
      byLower,
      nameToId,
    });
    if (!resolution) continue;

    const { tvgId, via } = resolution;
    if (!byLower.has(tvgId.toLowerCase())) continue; // never write an id not in the guides

    updates.push({ _id: ch._id, name, tvgId, via });
    stats.set(via, (stats.get(via) || 0) + 1);
  }

  console.log(`\nChannels to backfill: ${updates.length}`);
  for (const [via, n] of [...stats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${via}: ${n}`);
  }
  updates.slice(0, 12).forEach((u) => console.log(`  "${u.name.slice(0, 42)}" → ${u.tvgId} (${u.via})`));
  console.log(`Misassigned tvgIds to clear: ${unsets.length}`);
  unsets.slice(0, 12).forEach((u) => console.log(`  "${u.name.slice(0, 42)}" — was ${u.oldTvgId} (${u.via})`));

  if (!COMMIT) {
    console.log(`\nDry-run complete — no changes written. Re-run with --commit to apply.`);
  } else {
    if (updates.length) {
      const res = await Channel.bulkWrite(
        updates.map((u) => ({ updateOne: { filter: { _id: u._id }, update: { $set: { tvgId: u.tvgId } } } })),
        { ordered: false },
      );
      console.log(`\nUpdated ${res.modifiedCount} channels.`);
    }
    if (unsets.length) {
      const res = await Channel.bulkWrite(
        unsets.map((u) => ({ updateOne: { filter: { _id: u._id }, update: { $unset: { tvgId: 1 } } } })),
        { ordered: false },
      );
      console.log(`Cleared ${res.modifiedCount} misassigned tvgIds.`);
    }
    const covered = await Channel.countDocuments({ tvgId: { $in: availableIds } });
    console.log(`Channels with tvgId inside the guides now: ${covered}`);
  }

  await mongoose.connection.close();
  console.log('Done.\n');
}

run().catch(async (err) => {
  console.error('\nMigration error:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
