/**
 * May this source serve a title the customer can SEE?
 *
 * One predicate, used by both playback paths, because they had drifted apart and
 * that drift is what broke the catalog (measured in production 2026-09-25):
 *
 *   - `routes/tv.js` (live channels) already accepted a source that was not
 *     "Active + verified" as long as the customer could see it or it had direct
 *     playback enabled — with the rationale that a source listed in the public
 *     catalog must be playable, or the catalog shows channels that always fail.
 *   - `routes/streams.js` (movies/episodes) required `status: 'Active'` AND
 *     `verificationStatus: 'verified'` and nothing else.
 *
 * A source whose LIVE channels were dead but whose VOD endpoints answered
 * normally was therefore marked `Inactive` by the live-only watchdog, and every
 * movie in the customer catalog — 17,176 of them, all from that one source —
 * started returning 404 CONTENT_NOT_FOUND while the video bytes were reachable
 * (HTTP 206, real MPEG-TS payload) the whole time. The lesson is the one tv.js
 * already encodes: what makes a title playable is whether we are entitled and
 * able to serve it, not whether some other family of content on the same source
 * happens to be down.
 *
 * `verificationStatus: 'blocked'` means the panel could not be reached or
 * authenticated at all, which is a different claim from "this family is down",
 * so it is still accepted here only through the same visibility/direct signals —
 * keeping the blast radius of this shared predicate identical to the behaviour
 * that has been serving channels in production.
 */

export interface SourceEligibilityShape {
  status?: string | null;
  verificationStatus?: string | null;
  customerVisible?: boolean | null;
  directPlayback?: boolean | null;
  vodVerificationStatus?: string | null;
}

/**
 * Mongo equivalent of {@link isSourceEligibleForCustomerTitles}, for callers that
 * must filter in the database. Kept next to the predicate so the two cannot
 * drift; a unit test asserts they agree on every combination of the four inputs.
 */
export function customerTitleEligibilityClauses(): Array<Record<string, unknown>> {
  return [
    { status: 'Active', verificationStatus: 'verified' },
    { customerVisible: true },
    { directPlayback: true },
  ];
}

export function isSourceEligibleForCustomerTitles(
  source?: SourceEligibilityShape | null,
): boolean {
  if (!source) return false;
  if (source.status === 'Active' && source.verificationStatus === 'verified') return true;
  return source.customerVisible === true || source.directPlayback === true;
}

/**
 * On-demand titles (movies, episodes) additionally accept a source whose VOD family
 * was probed and answered — the strongest available evidence that this source serves
 * VOD, independent of whether its live channels are down.
 *
 * Deliberately NOT used for live channels: a VOD verdict says nothing about a
 * channel, and letting it unlock the channel path would list dead channels.
 */
export function isSourceEligibleForVod(source?: SourceEligibilityShape | null): boolean {
  if (isSourceEligibleForCustomerTitles(source)) return true;
  return Boolean(source) && source?.vodVerificationStatus === 'verified';
}

/**
 * Which families may a sync import from this source?
 *
 * The sync used to demand a LIVE verdict (`status === 'Active' && verificationStatus === 'verified'`)
 * before importing ANY family, and the scheduler only ever looked at `status: 'Active'` sources. A
 * source whose live channels were down therefore stopped refreshing its movies and series, and
 * nothing re-verified it either — a closed loop with no way out. Measured in production
 * 2026-09-25: both configured sources were `Inactive`, so 84,545 movies, 20,766 series and 25,960
 * live channels had not synced for three days to three weeks, silently — the scheduled sync
 * reported success while iterating an empty source list.
 *
 * The live rule is deliberately the SAME predicate the channel gate uses to decide which channels
 * customers may watch (services/channel-gate-cache.ts `VERIFIED_OR_VISIBLE_SOURCES`): if a source's
 * channels are customer-visible, refusing to sync it can only freeze the list customers are
 * watching, and if they are not visible, importing them would add channels nobody can play.
 *
 * One exception, because it is positive evidence rather than a missing verdict:
 * `verificationStatus: 'degraded'` means live playback was probed and no sample played, so that
 * source keeps refreshing its on-demand catalog without importing channels.
 */
export interface SyncFamilyPlan {
  /** May this sync import live channels? */
  live: boolean;
  /** May this sync import movies, series and episodes? */
  onDemand: boolean;
}

export function syncFamilyPlan(source?: SourceEligibilityShape | null): SyncFamilyPlan {
  if (!source) return { live: false, onDemand: false };
  // A panel that cannot be reached or authenticated tells us nothing about its catalog: syncing it
  // is guesswork, and a short/empty fetch is exactly what produced the destructive prunes.
  if (source.verificationStatus === 'blocked') return { live: false, onDemand: false };

  const customerFacing = isSourceEligibleForCustomerTitles(source);
  const liveProbedDead = source.verificationStatus === 'degraded';

  return {
    live: customerFacing && !liveProbedDead,
    onDemand: customerFacing || source.vodVerificationStatus === 'verified',
  };
}

/**
 * Mongo filter for "sources a sync could import from" — {@link syncFamilyPlan} expressed as a
 * query, so the scheduler cannot select an empty list of sources the plan would have accepted.
 * That divergence is what left the catalog frozen: the scheduled sync filtered on
 * `status: 'Active'`, both configured sources were `Inactive`, and the task reported success
 * while syncing nothing at all.
 *
 * `verificationStatus: 'blocked'` is deliberately NOT excluded here: such a source is selected and
 * then skipped with a recorded reason, which is louder than quietly not listing it.
 */
export function syncCandidateClauses(): Array<Record<string, unknown>> {
  return [
    ...customerTitleEligibilityClauses(),
    // Positive on-demand evidence: the VOD family was probed and played.
    { vodVerificationStatus: 'verified' },
  ];
}

// The route files are CommonJS and require the compiled service from `dist`.
module.exports = {
  isSourceEligibleForCustomerTitles,
  isSourceEligibleForVod,
  customerTitleEligibilityClauses,
  syncFamilyPlan,
  syncCandidateClauses,
};
