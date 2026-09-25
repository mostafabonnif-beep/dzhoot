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

// The route files are CommonJS and require the compiled service from `dist`.
module.exports = { isSourceEligibleForCustomerTitles, customerTitleEligibilityClauses };
