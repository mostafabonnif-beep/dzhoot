/**
 * Latency summary for a scheduled batch (used by the EPG refresh).
 *
 * Why this exists: the refresh processed ~900k programmes from 77 sources in
 * 284–344s, and the only outputs were a total duration and a per-source heap line.
 * Nothing said which sources were responsible for the tail, so "the EPG refresh got
 * slower" could not be attributed to a provider without re-running it by hand.
 *
 * Pure functions only: the caller collects one duration per source, this module
 * turns that list into a p50/p95 + slowest-sources report.
 */

export interface SourceDuration {
  /** Source label (provider name) — never a URL with credentials. */
  source: string;
  durationMs: number;
}

export interface DurationSummary {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  /** Nearest-rank percentiles over the collected samples. */
  p50Ms: number;
  p95Ms: number;
  /** Slowest sources first, capped. */
  slowest: SourceDuration[];
  /** Sum of the slowest sources' share of the total, in percent (0-100). */
  slowestSharePercent: number;
}

/**
 * Nearest-rank percentile (`ceil(p/100 * n)`-th smallest value).
 *
 * Nearest rank is used instead of interpolation on purpose: with 77 samples an
 * interpolated p95 is a number no run ever produced, which makes it harder to compare
 * two refreshes.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length, Math.max(1, rank)) - 1;
  return sorted[index];
}

/** Summarizes one refresh: percentiles plus the sources responsible for the tail. */
export function summarizeDurations(entries: readonly SourceDuration[], options?: { slowestLimit?: number }): DurationSummary {
  const slowestLimit = Math.max(1, options?.slowestLimit ?? 5);
  const usable = (entries || []).filter(
    (entry) => entry && Number.isFinite(Number(entry.durationMs)) && Number(entry.durationMs) >= 0,
  );
  if (usable.length === 0) {
    return { count: 0, totalMs: 0, minMs: 0, maxMs: 0, p50Ms: 0, p95Ms: 0, slowest: [], slowestSharePercent: 0 };
  }

  const durations = usable.map((entry) => Number(entry.durationMs));
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  const slowest = [...usable]
    .sort((left, right) => Number(right.durationMs) - Number(left.durationMs))
    .slice(0, slowestLimit)
    .map((entry) => ({ source: String(entry.source), durationMs: Number(entry.durationMs) }));
  const slowestTotal = slowest.reduce((sum, entry) => sum + entry.durationMs, 0);

  return {
    count: usable.length,
    totalMs,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    slowest,
    slowestSharePercent: totalMs > 0 ? Math.round((slowestTotal / totalMs) * 1000) / 10 : 0,
  };
}

/** One-line, log-safe rendering. Source labels only: no URLs, no XML, no credentials. */
export function formatDurationSummary(summary: DurationSummary): string {
  if (summary.count === 0) return 'no sources timed';
  const slowest = summary.slowest.map((entry) => `${entry.source}=${Math.round(entry.durationMs / 1000)}s`).join(', ');
  return (
    `p50=${Math.round(summary.p50Ms / 1000)}s p95=${Math.round(summary.p95Ms / 1000)}s ` +
    `max=${Math.round(summary.maxMs / 1000)}s slowest(${summary.slowest.length}, ${summary.slowestSharePercent}% of total): ${slowest}`
  );
}
