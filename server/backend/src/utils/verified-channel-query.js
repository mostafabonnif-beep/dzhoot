/**
 * The single definition of "a channel a customer is allowed to see".
 *
 * Every customer-facing catalog read must go through this query — the list, the search,
 * the category rail and the movies/series search. It was originally private to
 * routes/channels.js, and the endpoints that re-implemented its conditions by hand drifted
 * apart: `/channels` hid dead and unverified xtream channels while `/channels/search`,
 * `/categories` and `/catalog/search` did not, so a customer could search for a channel,
 * get it as a result, and watch a black screen (measured 2026-09-20: ~52% of the catalog
 * carried a provider placeholder). Keeping one definition is the point of this module.
 *
 * Policy notes (kept with the code so they are not re-litigated per caller):
 * - A source that is neither verified nor operator-visible is hidden entirely.
 * - `metadata.isWorking` is measured from the server datacenter IP, which upstream WAFs
 *   block (HTTP 456/458). Customer-visible and direct-playback sources are exempt, because
 *   that verdict does not describe what the customer's own network can play.
 */
const XtreamSource = require('../models/XtreamSource');
const {
  publicCatalogPresentationQuery,
  publicCatalogHideQuery,
  publicCatalogDedupQuery,
} = require('./catalog-presentation');

// Xtream channels are customer-visible only when their source has passed a live
// playback probe. Missing verification is intentionally treated as unavailable.
// Direct-playback / customer-visible sources are exempt: their isWorking flag
// reflects the server's datacenter IP (blocked upstream), not the customer's
// network — the same policy as the playlist routes (tv.js / User.ts).
async function verifiedXtreamChannelQuery(baseQuery, options = {}) {
  const verifiedSourceIds = (await XtreamSource.find({
    $or: [
      { status: 'Active', verificationStatus: 'verified' },
      { customerVisible: true },
      { directPlayback: true },
    ],
  }).distinct('_id')).map((id) => String(id));
  // Channels of operator-curated (customerVisible) or direct-playback sources
  // stay visible regardless of the server datacenter probe verdict: those
  // probes hit upstream WAF blocks (HTTP 456/458) that do not reflect what a
  // customer's own network (or the server relay on their behalf) can play.
  // Same policy as the watchdog fix (PR #186), extended to proxied sources.
  const isWorkingExemptSourceIds = (await XtreamSource.find({
    $or: [{ directPlayback: true }, { customerVisible: true }],
  }).distinct('_id')).map((id) => String(id));
  const dedupQuery = options.dedup ? await publicCatalogDedupQuery() : {};
  return {
    $and: [
      baseQuery,
      {
        isActive: { $ne: false },
        'flaggedBad.isFlagged': { $ne: true },
      },
      publicCatalogPresentationQuery(),
      publicCatalogHideQuery(),
      dedupQuery,
      {
        $nor: [
          // Sources that are neither verified nor operator-visible are hidden.
          {
            'metadata.source': 'xtream',
            'metadata.xtreamSourceId': { $nin: verifiedSourceIds },
          },
          // isWorking is measured from the server datacenter IP — exempt
          // customer-visible and direct-playback sources so their catalog
          // stays visible (probes cannot judge customer reachability).
          {
            'metadata.isWorking': false,
            'metadata.xtreamSourceId': { $nin: isWorkingExemptSourceIds },
          },
        ],
      },
    ],
  };
}
module.exports = { verifiedXtreamChannelQuery };
