import { runBoundedBatch } from '../utils/concurrency';

describe('runBoundedBatch (audit-remediation-v1)', () => {
  it('processes all items when every worker succeeds', async () => {
    const seen: number[] = [];
    const stats = await runBoundedBatch([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
      return item;
    });

    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(stats.processedCount).toBe(5);
    expect(stats.failedCount).toBe(0);
    expect(stats.errorSources).toEqual([]);
    expect(stats.maxConcurrencyObserved).toBeLessThanOrEqual(2);
  });

  it('a failing worker never stops the remaining items (failure isolation)', async () => {
    const attempts: string[] = [];
    const stats = await runBoundedBatch(
      ['fail-1', 'ok-1', 'ok-2', 'fail-2', 'ok-3'],
      2,
      async (item) => {
        attempts.push(item);
        if (item.startsWith('fail')) throw new Error(`boom: ${item}`);
        return 1;
      },
      { label: (item) => String(item) },
    );

    // Every item was attempted despite the failures.
    expect(attempts.sort()).toEqual(['fail-1', 'fail-2', 'ok-1', 'ok-2', 'ok-3']);
    expect(stats.failedCount).toBe(2);
    expect(stats.errorSources).toEqual(['fail-1', 'fail-2']);
    expect(stats.processedCount).toBe(3);
  });

  it('enforces the concurrency bound (never more than `concurrency` in flight)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const release: Array<() => void> = [];

    const gate = new Promise<void>((resolve) => {
      // resolve only after all workers have started
      setTimeout(resolve, 150);
    });

    const stats = await runBoundedBatch([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate;
      inFlight -= 1;
      return 1;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(stats.maxConcurrencyObserved).toBeLessThanOrEqual(3);
    expect(stats.processedCount).toBe(8);
    expect(release.length).toBe(0);
  });

  it('aborts workers that exceed the per-item timeout', async () => {
    const stats = await runBoundedBatch(
      ['slow', 'fast'],
      1,
      async (item) => {
        if (item === 'slow') {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        return 1;
      },
      { timeoutMs: 50, label: (item) => String(item) },
    );

    expect(stats.failedCount).toBe(1);
    expect(stats.errorSources).toContain('slow');
    expect(stats.processedCount).toBe(1);
  });

  it('empty input returns zeroed stats quickly', async () => {
    const stats = await runBoundedBatch([], 2, async () => 1);
    expect(stats.processedCount).toBe(0);
    expect(stats.failedCount).toBe(0);
    expect(stats.durationMs).toBeLessThan(1000);
  });

  it('concurrency is clamped to at least 1', async () => {
    const stats = await runBoundedBatch(['a', 'b'], 0, async () => 1);
    expect(stats.processedCount).toBe(2);
    expect(stats.maxConcurrencyObserved).toBeLessThanOrEqual(1);
  });

  it('onError callback receives every failure and can never break the batch', async () => {
    const reported: string[] = [];
    const stats = await runBoundedBatch(
      ['x', 'y'],
      1,
      async (item) => {
        throw new Error(`bad ${item}`);
      },
      {
        label: (item) => String(item),
        onError: (label, err) => {
          reported.push(`${label}:${(err as Error).message}`);
          throw new Error('callback must not break the batch');
        },
      },
    );

    expect(reported).toEqual(['x:bad x', 'y:bad y']);
    expect(stats.failedCount).toBe(2);
  });
});
