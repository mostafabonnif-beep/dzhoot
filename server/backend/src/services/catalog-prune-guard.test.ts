/**
 * The prune guard exists because the catalog prune trusted the fetched list
 * completely: one short fetch could deactivate tens of thousands of titles, and a
 * later sync cannot restore them (`isActive` is written under `$setOnInsert`).
 *
 * These tests pin the floor, and in particular the two shapes that caused the real
 * incident: an empty family fetch, and a family that lost most of its catalog.
 */

import {
  decideCatalogPrune,
  DEFAULT_PRUNE_MIN_RATIO,
} from './catalog-prune-guard';

const counts = (channels: number, movies: number, series: number) => ({ channels, movies, series });

describe('catalog prune guard', () => {
  it('allows the first import of a source with nothing active yet', () => {
    const d = decideCatalogPrune(counts(100, 500, 50), counts(0, 0, 0));
    expect(d.prune).toBe(true);
    expect(d.skippedReason).toBeNull();
  });

  it('allows a prune when the provider still offers most of the catalog', () => {
    const d = decideCatalogPrune(counts(9_000, 60_000, 15_000), counts(10_000, 67_000, 17_000));
    expect(d.prune).toBe(true);
    expect(d.ratios.movies).toBeGreaterThan(DEFAULT_PRUNE_MIN_RATIO);
  });

  it('refuses to prune a family that came back empty', () => {
    // An empty VOD list while 67,598 movies are active is a failed fetch, never a removal.
    const d = decideCatalogPrune(counts(16_000, 0, 17_000), counts(16_595, 67_598, 17_195));
    expect(d.prune).toBe(false);
    expect(d.skippedReason).toBe('empty-fetch');
  });

  it('refuses a prune that would lose most of the catalog', () => {
    const d = decideCatalogPrune(counts(16_000, 5_000, 17_000), counts(16_595, 67_598, 17_195));
    expect(d.prune).toBe(false);
    expect(d.skippedReason).toBe('implausible-drop');
    expect(d.ratios.movies).toBeCloseTo(0.0739, 3);
  });

  it('refuses the shape of the production incident: one family nearly wiped', () => {
    // 2026-09-22 21:00 — movies fell to a sliver while channels barely moved.
    const d = decideCatalogPrune(counts(16_400, 9_200, 17_000), counts(16_595, 67_598, 17_195));
    expect(d.prune).toBe(false);
    expect(d.skippedReason).toBe('implausible-drop');
  });

  it('keeps pruning a family the provider does not have at all', () => {
    // Previously zero, fetched zero: nothing to protect and nothing to lose.
    const d = decideCatalogPrune(counts(10, 0, 0), counts(0, 0, 0));
    expect(d.prune).toBe(true);
  });

  it('ignores families the source never had when judging the ratio', () => {
    // Live-only source: an empty movie list is not a drop.
    const d = decideCatalogPrune(counts(1_000, 0, 0), counts(1_100, 0, 0));
    expect(d.prune).toBe(true);
  });

  it('honours a stricter configured floor', () => {
    const fetched = counts(8_000, 60_000, 17_000);
    const previous = counts(10_000, 67_000, 17_000);
    expect(decideCatalogPrune(fetched, previous, 0.5).prune).toBe(true);
    expect(decideCatalogPrune(fetched, previous, 0.9).prune).toBe(false);
  });
});
