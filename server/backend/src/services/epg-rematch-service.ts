/**
 * Work-plan part 9: periodic EPG re-match.
 *
 * Migration 0013 backfilled tvgIds once. This service runs the same mapping
 * logic on a schedule so coverage keeps climbing over time instead of
 * depending on one-shot migrations:
 *
 *  - channels whose tvgId is missing/blank get matched against the CURRENT
 *    guide ids (new guides from EPG sources become matchable automatically);
 *  - channels stamped with a misassigned beIN Sports id (wrong number, or a
 *    non-sports beIN brand) get it cleared — same rule as migration 0013.
 *
 * Channels whose tvgId already points at a live guide id are left untouched.
 */
import Channel from '../models/Channel';
import EpgProgram from '../models/EpgProgram';
import EpgChannel from '../models/EpgChannel';
import {
  resolveEpgIdForChannel,
  epgIdName,
  extractBeinNumber,
  isBeinSportsFeed,
  canonicalKey,
} from '../utils/epg-id-resolver';

/** A tvgId pointing at a beIN guide id, e.g. beIN_SPORTS2_DIGITAL_Mono_AR.bein. */
const BEIN_TVG_ID = /^bein[_\s]?sports?(\d{1,2})/i;

export interface EpgRematchResult {
  availableGuideIds: number;
  /** Channels examined (within the limit) that needed attention. */
  candidates: number;
  matched: number;
  cleared: number;
  /** Sample of written links for observability. */
  sample: Array<{ name: string; tvgId: string; via: string }>;
}

async function buildGuideIndex() {
  const availableIds: string[] = (await EpgProgram.distinct('channelEpgId')).sort();
  const available = new Set(availableIds.map((x) => String(x).toLowerCase()));

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

  // Also index by the guide's own `<display-name>` aliases (captured at refresh into
  // EpgChannel). This is what links a catalog channel with no tvgId to a guide id
  // whose id does NOT canonicalize to its name (e.g. `xyz.123.tr`): the guide's
  // display-name still matches the channel's name. Guard rails, same exact-only
  // policy as the resolver:
  //   - the alias must map to exactly ONE guide id that actually has programmes —
  //     an ambiguous alias (the same cleaned name on two guide ids) is dropped,
  //     because a wrong link is worse than no link;
  //   - a guide-id-derived name already present keeps precedence.
  const aliasOwners = new Map<string, Set<string>>();
  const aliasPreferred = new Map<string, string>();
  const channelDocs = await EpgChannel.find({}, { channelEpgId: 1, displayNames: 1 }).lean();
  for (const doc of channelDocs as any[]) {
    const id = String(doc.channelEpgId || '');
    if (!id || !available.has(id.toLowerCase())) continue;
    for (const dn of doc.displayNames || []) {
      const key = canonicalKey(String(dn || ''));
      if (!key || key.length < 3) continue;
      const owners = aliasOwners.get(key) || new Set<string>();
      owners.add(id.toLowerCase());
      aliasOwners.set(key, owners);
      const existing = aliasPreferred.get(key);
      if (!existing || /\.tr$/.test(existing)) aliasPreferred.set(key, id);
    }
  }
  for (const [key, owners] of aliasOwners) {
    if (owners.size !== 1) continue; // ambiguous alias — never guess
    if (nameToId.has(key)) continue; // guide-id-derived name already wins
    const id = aliasPreferred.get(key)!;
    if (available.has(id.toLowerCase())) nameToId.set(key, id);
  }

  return { available, byLower, nameToId };
}

export async function runEpgRematch(limit = 100000): Promise<EpgRematchResult> {
  // Default = full sweep. A small default (2000) made the scheduled task crawl
  // natural-order candidates that are mostly unmatchable (24/7 loops, radios,
  // relax feeds), matching a handful per night. A complete sweep is cheap
  // (~0.5-1s for ~23k candidates, measured 2026-09-05) and catches every new
  // guide match on each run. Callers may pass a smaller limit to bound work.
  const { available, byLower, nameToId } = await buildGuideIndex();
  const result: EpgRematchResult = {
    availableGuideIds: available.size,
    candidates: 0,
    matched: 0,
    cleared: 0,
    sample: [],
  };

  const candidates = await Channel.find(
    { $or: [{ tvgId: null }, { tvgId: '' }] },
    { channelName: 1, tvgId: 1 },
  )
    .limit(limit)
    .lean();

  const updates: { _id: any; tvgId: string; via: string; name: string }[] = [];
  const unsets: { _id: any; name: string }[] = [];

  for (const ch of candidates as any[]) {
    const name = String(ch.channelName || '');
    if (!name) continue;

    const currentTvg = String(ch.tvgId || '');

    // Same misassignment rule as migration 0013 — keep recurring data clean.
    const tvgBein = currentTvg.match(BEIN_TVG_ID);
    const nameBein = extractBeinNumber(name);
    const brandMismatch = !isBeinSportsFeed(name);
    if (tvgBein && ((nameBein && nameBein !== tvgBein[1]) || brandMismatch)) {
      unsets.push({ _id: ch._id, name });
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
    if (!byLower.has(resolution.tvgId.toLowerCase())) continue; // never write an id not in the guides

    updates.push({ _id: ch._id, tvgId: resolution.tvgId, via: resolution.via, name });
  }

  result.candidates = updates.length + unsets.length;

  if (updates.length) {
    const res = await Channel.bulkWrite(
      updates.map((u) => ({
        updateOne: { filter: { _id: u._id }, update: { $set: { tvgId: u.tvgId } } },
      })),
      { ordered: false },
    );
    result.matched = res.modifiedCount ?? updates.length;
    result.sample = updates.slice(0, 5).map((u) => ({ name: u.name, tvgId: u.tvgId, via: u.via }));
  }

  if (unsets.length) {
    const res = await Channel.bulkWrite(
      unsets.map((u) => ({
        updateOne: { filter: { _id: u._id }, update: { $unset: { tvgId: 1 } } },
      })),
      { ordered: false },
    );
    result.cleared = res.modifiedCount ?? unsets.length;
  }

  return result;
}

module.exports = { runEpgRematch };
