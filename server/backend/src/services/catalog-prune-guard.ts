/**
 * Should a sync be allowed to deactivate the titles it did not see?
 *
 * The prune step is correct in principle: a title the provider no longer lists
 * should stop being sold. But it trusts the fetched list completely, and a fetch
 * can come back short — a panel hiccup, a paginated VOD endpoint answering one
 * page, an account that is briefly blocked, a timeout mid-import. Measured in
 * production: one sync run on 2026-09-22 21:00 deactivated **58,240 movies and
 * 9,538 channels** for a single source, and because the upserts write
 * `isActive` under `$setOnInsert` (deliberately, so a re-sync never overrides an
 * operator's manual deactivation) a re-sync does **not** bring them back. The
 * catalog loss was permanent and silent.
 *
 * So the prune gets a floor: it may only proceed while the fetched list still
 * resembles the source's existing catalog. An empty fetch is never evidence that
 * everything disappeared, and neither is a fetch that lost most of it.
 */

export interface CatalogPruneCounts {
  channels: number;
  movies: number;
  series: number;
}

export interface CatalogPruneDecision {
  /** Whether the prune may run at all. */
  prune: boolean;
  /** Machine-readable reason when `prune` is false. */
  skippedReason: 'empty-fetch' | 'implausible-drop' | null;
  /** `fetched / previouslyActive` per family, for the log line and diagnostics. */
  ratios: CatalogPruneCounts;
}

export const DEFAULT_PRUNE_MIN_RATIO = 0.5;

function safeRatio(fetched: number, previous: number): number {
  if (previous <= 0) return 1;
  return fetched / previous;
}

/**
 * @param fetched titles the provider just returned
 * @param previouslyActive titles this source currently has active in the catalog
 * @param minRatio floor for `fetched / previouslyActive`; 0.5 means "the provider
 *   must still offer at least half of what it offered last time"
 */
export function decideCatalogPrune(
  fetched: CatalogPruneCounts,
  previouslyActive: CatalogPruneCounts,
  minRatio: number = DEFAULT_PRUNE_MIN_RATIO,
): CatalogPruneDecision {
  const ratios: CatalogPruneCounts = {
    channels: safeRatio(fetched.channels, previouslyActive.channels),
    movies: safeRatio(fetched.movies, previouslyActive.movies),
    series: safeRatio(fetched.series, previouslyActive.series),
  };

  // A source with nothing active yet has nothing to protect — first import.
  const totalPrevious =
    previouslyActive.channels + previouslyActive.movies + previouslyActive.series;
  if (totalPrevious === 0) {
    return { prune: true, skippedReason: null, ratios };
  }

  // An empty list for a family that has titles is a failed fetch, not a removal.
  const emptiedAFamily =
    (previouslyActive.channels > 0 && fetched.channels === 0) ||
    (previouslyActive.movies > 0 && fetched.movies === 0) ||
    (previouslyActive.series > 0 && fetched.series === 0);
  if (emptiedAFamily) {
    return { prune: false, skippedReason: 'empty-fetch', ratios };
  }

  // Some loss is expected (a provider rotates titles); wholesale loss is a fault.
  const droppedTooFar =
    (previouslyActive.channels > 0 && ratios.channels < minRatio) ||
    (previouslyActive.movies > 0 && ratios.movies < minRatio) ||
    (previouslyActive.series > 0 && ratios.series < minRatio);
  if (droppedTooFar) {
    return { prune: false, skippedReason: 'implausible-drop', ratios };
  }

  return { prune: true, skippedReason: null, ratios };
}

// The service is TypeScript compiled to `dist`; this keeps parity with the other
// mixed JS/TS modules in this folder.
module.exports = { decideCatalogPrune, DEFAULT_PRUNE_MIN_RATIO };
