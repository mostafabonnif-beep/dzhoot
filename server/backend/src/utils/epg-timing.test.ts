/**
 * Latency summary for the EPG refresh (see src/utils/epg-timing.ts).
 *
 * The refresh reports ~900k programmes from 77 sources in 284–344s, and the slowest
 * sources were invisible: these helpers are what make "which provider is slowing the
 * guide down" answerable from the log or from /api/v1/epg/status.
 */
import { formatDurationSummary, percentile, summarizeDurations } from './epg-timing';

describe('percentile', () => {
  it('returns zero for an empty sample set', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([], 95)).toBe(0);
  });

  it('uses nearest rank, so the value is always one a run produced', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(samples, 50)).toBe(50);
    expect(percentile(samples, 95)).toBe(100);
    expect(percentile(samples, 100)).toBe(100);
    expect(percentile(samples, 10)).toBe(10);
  });

  it('does not depend on input order', () => {
    expect(percentile([100, 10, 50], 50)).toBe(50);
  });

  it('handles a single sample', () => {
    expect(percentile([42], 95)).toBe(42);
  });
});

describe('summarizeDurations', () => {
  it('reports counts, percentiles and the slowest sources', () => {
    const summary = summarizeDurations([
      { source: 'fast', durationMs: 1000 },
      { source: 'medium', durationMs: 5000 },
      { source: 'slow', durationMs: 60000 },
      { source: 'slowest', durationMs: 120000 },
    ]);

    expect(summary.count).toBe(4);
    expect(summary.totalMs).toBe(186000);
    expect(summary.minMs).toBe(1000);
    expect(summary.maxMs).toBe(120000);
    expect(summary.p50Ms).toBe(5000);
    expect(summary.p95Ms).toBe(120000);
    expect(summary.slowest.map((entry) => entry.source)).toEqual(['slowest', 'slow', 'medium', 'fast']);
    // Only four sources were timed and the default list holds five, so the reported
    // slowest sources account for the whole run.
    expect(summary.slowestSharePercent).toBe(100);
  });

  it('caps the slowest list and still reports the share of that list', () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      source: `source-${index}`,
      durationMs: (index + 1) * 1000,
    }));

    const summary = summarizeDurations(entries, { slowestLimit: 3 });

    expect(summary.slowest).toHaveLength(3);
    expect(summary.slowest[0].source).toBe('source-19');
    expect(summary.count).toBe(20);
  });

  it('ignores entries without a usable duration', () => {
    const summary = summarizeDurations([
      { source: 'ok', durationMs: 100 },
      { source: 'nan', durationMs: Number.NaN },
      { source: 'negative', durationMs: -5 },
      // Defensive: the caller collects these from provider responses.
      undefined as unknown as { source: string; durationMs: number },
    ]);

    expect(summary.count).toBe(1);
    expect(summary.p50Ms).toBe(100);
  });

  it('returns an empty summary for an empty run', () => {
    const summary = summarizeDurations([]);

    expect(summary).toEqual({
      count: 0,
      totalMs: 0,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      slowest: [],
      slowestSharePercent: 0,
    });
    expect(formatDurationSummary(summary)).toBe('no sources timed');
  });
});

describe('formatDurationSummary', () => {
  it('renders seconds and the slowest sources without any URL or credential', () => {
    const summary = summarizeDurations([
      { source: 'epgshare01-IN1', durationMs: 90000 },
      { source: 'iptv-epg-PL1', durationMs: 30000 },
    ]);

    const line = formatDurationSummary(summary);

    expect(line).toContain('epgshare01-IN1=90s');
    expect(line).toContain('p50=');
    expect(line).toContain('p95=');
    expect(line).not.toContain('http');
    expect(line).not.toContain('@');
  });
});
