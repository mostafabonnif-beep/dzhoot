import mongoose from 'mongoose';
import Channel from '../models/Channel';

/**
 * Catalog cleanup — the "messy app" fix, server side.
 *
 * The 2026-09-24 catalog audit (16,603 shared active channels) found:
 *  - 1,211 duplicate-name groups covering 3,373 channels (~20%): the app
 *    shows four copies of the same channel and the user must guess which.
 *  - 569 junk channels with dead-listing names ("ENDED | …", "8K EXCLUSIVE")
 *    from manual xtream imports.
 * All of it comes from the xtream import (channelId prefix `xt:`); the only
 * periodically-active source (iptv-org m3u) never touches those docs, so
 * cleanup sticks.
 *
 * Merge policy per duplicate group: keep ONE winner (best evidence of
 * usability), demote the rest — hidden (isActive:false) with their stream
 * URLs donated to the winner as alternateStreams (the playback-token path
 * already serves alternates slots 1..3). Nothing is deleted; recovery is a
   flag flip.
 */

export const JUNK_NAME_REGEX = /ENDED|8K EXCLUSIVE/i;
export const MERGE_REASON = 'duplicate-merge';
export const JUNK_REASON = 'junk-name';
export const MAX_ALTERNATES = 3;

export interface CleanupCandidate {
  _id: mongoose.Types.ObjectId;
  channelName: string;
  tvgId?: string | null;
  channelImg?: string | null;
  channelUrl?: string | null;
  flaggedBad?: { isFlagged?: boolean } | null;
  alternateStreams?: unknown[];
  updatedAt?: Date | null;
}

/** Pure — unit-tested. Higher score wins the group. */
export function candidateScore(c: CleanupCandidate): number {
  let s = 0;
  if (c.tvgId && String(c.tvgId).trim()) s += 2; // EPG matched
  if (c.channelImg && String(c.channelImg).trim()) s += 1; // has a logo
  if (c.flaggedBad?.isFlagged === true) s -= 5; // known-dead sinks to last
  if (c.alternateStreams && c.alternateStreams.length) s += 1;
  return s;
}

/** Pure — unit-tested. Index of the winning candidate, ties broken by most recently updated. */
export function pickWinnerIndex(candidates: CleanupCandidate[]): number {
  let best = 0;
  for (let i = 1; i < candidates.length; i++) {
    const a = candidates[best];
    const b = candidates[i];
    const diff = candidateScore(b) - candidateScore(a);
    if (
      diff > 0 ||
      (diff === 0 &&
        ((b.updatedAt?.getTime() ?? 0) > (a.updatedAt?.getTime() ?? 0)))
    ) {
      best = i;
    }
  }
  return best;
}

export interface CatalogCleanupResult {
  junkHidden: number;
  dupeGroups: number;
  mergedAway: number;
  alternatesAdded: number;
}

export async function runCatalogCleanup(dryRun = false): Promise<CatalogCleanupResult> {
  const result: CatalogCleanupResult = {
    junkHidden: 0,
    dupeGroups: 0,
    mergedAway: 0,
    alternatesAdded: 0,
  };

  // 1) Junk hide — conservative name match, shared catalog, currently active.
  if (!dryRun) {
    const junk = await Channel.updateMany(
      {
        ownerId: null,
        isActive: true,
        channelName: { $regex: JUNK_NAME_REGEX },
        // never touch a channel the client-liveness/health flow already manages
        'flaggedBad.isFlagged': { $ne: true },
      },
      {
        $set: {
          isActive: false,
          'metadata.cleanupReason': JUNK_REASON,
          'metadata.cleanedAt': new Date(),
        },
      },
    );
    result.junkHidden = junk.modifiedCount ?? 0;
  }

  // 2) Duplicate merge — group active shared channels by normalized name.
  const docs: CleanupCandidate[] = await Channel.find(
    { ownerId: null, isActive: true },
    {
      channelName: 1,
      tvgId: 1,
      channelImg: 1,
      channelUrl: 1,
      flaggedBad: 1,
      alternateStreams: 1,
      updatedAt: 1,
    },
  ).lean();

  const groups = new Map<string, CleanupCandidate[]>();
  for (const d of docs) {
    const key = d.channelName.trim().toUpperCase().replace(/\s+/g, ' ');
    const list = groups.get(key);
    if (list) list.push(d);
    else groups.set(key, [d]);
  }

  const loserIds: mongoose.Types.ObjectId[] = [];
  const winnerUpdates: {
    winner: CleanupCandidate;
    urls: string[];
  }[] = [];

  for (const [, cands] of groups) {
    if (cands.length < 2) continue;
    result.dupeGroups++;
    const winIdx = pickWinnerIndex(cands);
    const winner = cands[winIdx];
    const losers = cands.filter((_, i) => i !== winIdx);
    const existing = (winner.alternateStreams?.length ?? 0);
    const urls: string[] = [];
    for (const loser of losers) {
      loserIds.push(loser._id);
      const u = (loser.channelUrl || '').trim();
      if (
        existing + urls.length < MAX_ALTERNATES &&
        u &&
        u !== (winner.channelUrl || '').trim() &&
        !(winner.alternateStreams || []).some(
          (a: any) => (a?.streamUrl || '').trim() === u,
        )
      ) {
        urls.push(u);
      }
    }
    if (urls.length) winnerUpdates.push({ winner, urls });
  }

  if (dryRun) {
    result.mergedAway = loserIds.length;
    result.alternatesAdded = winnerUpdates.reduce((n, w) => n + w.urls.length, 0);
    return result;
  }

  if (loserIds.length) {
    const hide = await Channel.updateMany(
      { _id: { $in: loserIds }, ownerId: null },
      {
        $set: {
          isActive: false,
          'metadata.cleanupReason': MERGE_REASON,
          'metadata.cleanedAt': new Date(),
        },
      },
    );
    result.mergedAway = hide.modifiedCount ?? 0;
  }

  // Donate loser URLs to winners as plain alternate streams (schema shape:
  // { streamUrl, quality, liveness } — the fields the playback-token path reads).
  for (const { winner, urls } of winnerUpdates) {
    if (!urls.length) continue;
    await Channel.updateOne(
      { _id: winner._id },
      {
        $push: {
          alternateStreams: {
            $each: urls.map((u) => ({
              streamUrl: u,
              quality: null,
              liveness: { status: 'unknown', lastChecked: null },
            })),
            $slice: MAX_ALTERNATES,
          },
        },
      },
    );
    result.alternatesAdded += urls.length;
  }

  return result;
}
