import mongoose from 'mongoose';
import Channel from '../models/Channel';
import PlaybackEvent from '../models/PlaybackEvent';

/**
 * Client-side stream liveness — the missing half of stream health.
 *
 * Direct-playback upstreams block server-IP probing, so stream-health-check
 * can never judge ~30k catalog channels (it completes 32,762 channels in ~23s
 * by skipping them, 2026-09-23 audit). The clients already report the truth:
 * every playback start emits `startup_success` / `startup_failure`
 * (models/PlaybackEvent). This service turns that telemetry into the SAME
 * `flaggedBad` signal the existing selection/failover paths already respect:
 *   - routes/channels filters flagged alternates out of what clients see;
 *   - stream-health skips/repairs flagged channels;
 *   - the visibility gates read flaggedBad.
 *
 * Flag rule (conservative — a flag hides a channel from the catalog):
 *   enough failures (>= MIN_FAILURES), failures dominate successes,
 *   and the most recent attempt is a failure (channel didn't recover).
 * Clear rule: a channel we flagged earlier with a fresh success — it healed
 * (e.g. upstream fixed, or a network blip on the reporter's side).
 */

export const CLIENT_LIVENESS_REASON = 'client-failures';
export const CLIENT_LIVENESS_WINDOW_DAYS = 7;
export const MIN_FAILURES = 3;
export const MIN_FAILURE_RATIO = 2; // failures must be >= 2× successes
export const CLEAR_SUCCESS_WINDOW_HOURS = 24;

export type LivenessDecision = 'flag' | 'clear' | 'none';

export interface ChannelLivenessStats {
  successes: number;
  failures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
}

/** Pure decision — unit-tested without a database. */
export function decideChannelLiveness(stats: ChannelLivenessStats): LivenessDecision {
  if (stats.failures >= MIN_FAILURES && stats.failures >= stats.successes * MIN_FAILURE_RATIO) {
    // Recent success after the recent failures means the channel healed —
    // don't flag on stale evidence.
    if (stats.lastSuccessAt && stats.lastFailureAt && stats.lastSuccessAt > stats.lastFailureAt) {
      return 'none';
    }
    return 'flag';
  }
  return 'none';
}

export interface ClientLivenessResult {
  examined: number;
  flagged: number;
  cleared: number;
}

export async function runClientLiveness(): Promise<ClientLivenessResult> {
  const since = new Date(Date.now() - CLIENT_LIVENESS_WINDOW_DAYS * 24 * 3600 * 1000);
  const result: ClientLivenessResult = { examined: 0, flagged: 0, cleared: 0 };

  // Per-channel outcome counts over the telemetry window. PlaybackEvent docs
  // are tiny; a group-by over one indexed window is the whole cost.
  const perChannel = await PlaybackEvent.aggregate<{
    _id: mongoose.Types.ObjectId;
    successes: number;
    failures: number;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  }>([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: '$channelId',
        successes: { $sum: { $cond: [{ $eq: ['$eventType', 'startup_success'] }, 1, 0] } },
        failures: { $sum: { $cond: [{ $eq: ['$eventType', 'startup_failure'] }, 1, 0] } },
        lastSuccessAt: { $max: { $cond: [{ $eq: ['$eventType', 'startup_success'] }, '$createdAt', null] } },
        lastFailureAt: { $max: { $cond: [{ $eq: ['$eventType', 'startup_failure'] }, '$createdAt', null] } },
      },
    },
  ]);

  const flagIds: mongoose.Types.ObjectId[] = [];
  const statsById = new Map<string, ChannelLivenessStats>();
  for (const row of perChannel) {
    result.examined++;
    statsById.set(String(row._id), {
      successes: row.successes,
      failures: row.failures,
      lastSuccessAt: row.lastSuccessAt ?? null,
      lastFailureAt: row.lastFailureAt ?? null,
    });
    if (decideChannelLiveness(statsById.get(String(row._id))!) === 'flag') {
      flagIds.push(row._id);
    }
  }

  // Flag: shared-catalog channels only (ownerId:null — per-user copies are
  // outside the shared selection paths). `flaggedBad.flaggedBy` is an ObjectId
  // (ref User) — we leave it null and put provenance in `reason`, which is
  // what the clear path matches on. Never touch an admin/health-service flag
  // (different reason) — those have their own lifecycle.
  if (flagIds.length) {
    const res = await Channel.updateMany(
      {
        _id: { $in: flagIds },
        ownerId: null,
        'flaggedBad.isFlagged': { $ne: true },
      },
      {
        $set: {
          'flaggedBad.isFlagged': true,
          'flaggedBad.reason': CLIENT_LIVENESS_REASON,
          'flaggedBad.flaggedAt': new Date(),
        },
      },
    );
    result.flagged = res.modifiedCount ?? 0;
  }

  // Clear: channels THIS system flagged that produced a fresh success —
  // evidence beats the flag. The window aggregation already knows this:
  // any flagged channel with successes in the last day (and not flagged
  // again above) heals.
  const clearCutoff = new Date(Date.now() - CLEAR_SUCCESS_WINDOW_HOURS * 3600 * 1000);
  const healedIds = perChannel
    .filter((row) => {
      const s = statsById.get(String(row._id))!;
      return (
        s.successes > 0 &&
        s.lastSuccessAt !== null &&
        s.lastSuccessAt >= clearCutoff &&
        decideChannelLiveness(s) !== 'flag'
      );
    })
    .map((row) => row._id);

  if (healedIds.length) {
    const res = await Channel.updateMany(
      {
        _id: { $in: healedIds },
        ownerId: null,
        'flaggedBad.isFlagged': true,
        'flaggedBad.reason': CLIENT_LIVENESS_REASON,
      },
      {
        $set: {
          'flaggedBad.isFlagged': false,
          'flaggedBad.reason': null,
          'flaggedBad.flaggedBy': null,
          'flaggedBad.flaggedAt': null,
        },
      },
    );
    result.cleared = res.modifiedCount ?? 0;
  }

  return result;
}
