/**
 * Migration 0013 — Backfill tvgId for Arabic/international channels so the
 * fetched XMLTV guides (epgshare beIN, iptv-epg.org, .tr guide) actually
 * populate the app guide.
 *
 * Problem found live: the EPG pipeline works (122k+ programs in DB) but only
 * ~1.1k of 16.6k channels have a tvgId that exists in the fetched guides —
 * the French channels were matched, the big Arabic families were not.
 *
 * Strategy (all data-driven from the ids that ACTUALLY exist in EpgProgram):
 *   1. beIN family: BEIN SPORTS n → beIN_SPORTS{n}_DIGITAL_Mono_AR.bein
 *      (fallback beINSPORTS{n}.tr); ALKASS n → Alkass_{n}_AR.bein;
 *      AL JAZEERA ARABIC → AL.JAZEERA.ARABIC.tr (+ INTERNATIONAL variant).
 *   2. Generic exact match: catalog display name (cleaned) == epg-id-derived
 *      name (cleaned) — e.g. 'CARTOON NETWORK' → CARTOON.NETWORK.tr,
 *      'DISNEY CHANNEL' → DISNEY.CHANNEL.tr, 'CNN INTERNATIONAL' →
 *      CNN.INTERNATIONAL.tr. Only exact normalized matches, so no wrong links.
 *
 * Channels whose tvgId already resolves to an existing guide id are skipped.
 * Nothing is deleted; only tvgId is set.
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
import { cleanDisplayChannelName } from '../../utils/catalog-name-cleaner';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dzhoof-iptv';
const COMMIT = process.argv.includes('--commit');

/** Strip quality/mode tokens so 'CARTOON NETWORK HD' ≡ 'cartoon network'. */
const QUALITY_TOKENS =
  /\b(hd|hdtv|fhd|uhd|4k|8k|sd|hevc|h265|x265|h264|avc|raw|60fps|full|lq|hq)\b/g;

function canonicalKey(value: string): string {
  return cleanDisplayChannelName(value)
    .toLowerCase()
    .replace(QUALITY_TOKENS, ' ')
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Derive a canonical name from an EPG id: 'AL.JAZEERA.ARABIC.tr' → 'al jazeera arabic'. */
function epgIdName(id: string): string {
  const s = id
    .toLowerCase()
    .replace(/\.(tr|fr|uk|de|bein|com|dz|sa|ae|ma|tn|us|nl|be|ch|ru|it|es|pt|pl|in|za|mu|cm)$/i, '');
  return s.replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ').replace(/\s+/g, ' ').trim();
}

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
    if (!key || key.length < 4) continue;
    const existing = nameToId.get(key);
    if (!existing || /\.tr$/.test(existing)) nameToId.set(key, id);
  }

  const channels = await Channel.find(
    {},
    { channelName: 1, tvgId: 1, channelId: 1 },
  ).lean();
  console.log(`Catalog channels: ${channels.length}`);

  const updates: { _id: any; name: string; tvgId: string; via: string }[] = [];
  const stats = new Map<string, number>();

  for (const ch of channels as any[]) {
    const name = String(ch.channelName || '');
    if (!name) continue;

    const currentTvg = String(ch.tvgId || '');
    if (currentTvg && available.has(currentTvg.toLowerCase())) continue; // already covered

    const canon = canonicalKey(name);
    const upper = name.toUpperCase();
    let tvgId: string | null = null;
    let via = '';

    // --- beIN family ---
    const beinMatch = upper.match(/BEIN\s*(?:SPORTS\s*)?(\d{1,2})/);
    if (/BEIN/.test(upper)) {
      if (/\bMAX\b/.test(upper)) {
        // guide has no MAX feeds in the fetched sets — leave for a later source
        continue;
      }
      const n = beinMatch ? beinMatch[1] : '1';
      const ar = byLower.get(`bein_sports${n}_digital_mono_ar.bein`);
      const tr = byLower.get(`beinsp${n}.tr`);
      if (ar) {
        tvgId = ar;
        via = 'bein-ar';
      } else if (tr) {
        tvgId = tr;
        via = 'bein-tr';
      } else if (n === '1' && byLower.has('beinsports.tr')) {
        tvgId = byLower.get('beinsports.tr')!;
        via = 'bein-tr';
      }
    } else if (/ALKASS/.test(upper)) {
      const m = upper.match(/ALKASS\s*(\d{1,2})/);
      const n = m ? m[1] : '1';
      const ar = byLower.get(`alkass_${n}_ar.bein`);
      const en = byLower.get(`alkass_${n}_en.bein`);
      if (ar) {
        tvgId = ar;
        via = 'alkass-ar';
      } else if (en) {
        tvgId = en;
        via = 'alkass-en';
      }
    } else if (/AL\s*JAZEERA/.test(upper)) {
      const ar = byLower.get('al.jazeera.arabic.tr');
      const en = byLower.get('al.jazeera.international.tr');
      if (/ARABIC/.test(upper) && ar) {
        tvgId = ar;
        via = 'jazeera-ar';
      } else if (/INTERNATIONAL|INTL|EN/.test(upper) && en) {
        tvgId = en;
        via = 'jazeera-en';
      } else if (ar) {
        tvgId = ar;
        via = 'jazeera-ar';
      }
    }

    // --- generic exact match (international families: cartoon, disney, cnn…) ---
    if (!tvgId && canon && nameToId.has(canon)) {
      tvgId = nameToId.get(canon)!;
      via = 'generic';
    }

    if (tvgId && !byLower.has(tvgId.toLowerCase())) {
      tvgId = null; // never write an id that is not actually in the guides
    }

    if (tvgId) {
      updates.push({ _id: ch._id, name, tvgId, via });
      stats.set(via, (stats.get(via) || 0) + 1);
    }
  }

  console.log(`\nChannels to backfill: ${updates.length}`);
  for (const [via, n] of [...stats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${via}: ${n}`);
  }
  updates.slice(0, 12).forEach((u) => console.log(`  "${u.name.slice(0, 42)}" → ${u.tvgId} (${u.via})`));

  if (!COMMIT) {
    console.log(`\nDry-run complete — no changes written. Re-run with --commit to apply.`);
  } else if (updates.length) {
    const res = await Channel.bulkWrite(
      updates.map((u) => ({ updateOne: { filter: { _id: u._id }, update: { $set: { tvgId: u.tvgId } } } })),
      { ordered: false },
    );
    console.log(`\nUpdated ${res.modifiedCount} channels.`);
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
