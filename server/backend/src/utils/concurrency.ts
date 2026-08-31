/**
 * Bounded-concurrency batch runner used by background jobs (EPG refresh, etc.).
 *
 * Why this exists:
 *  - The scheduler previously fetched EPG sources in hardcoded batches of 5 with
 *    no overall timeout, and one huge guide could drive the process into a
 *    JavaScript heap OOM crash that killed the whole container (and every other
 *    scheduled task with it).
 *  - This runner guarantees: at most `concurrency` workers in flight, an
 *    optional per-item timeout, and full failure isolation — a rejected worker
 *    only records an error, it never aborts the remaining items.
 */

export interface BatchRunStats {
  /** Number of items whose worker resolved (including 0-result successes). */
  processedCount: number;
  /** Number of items whose worker rejected or timed out. */
  failedCount: number;
  /** Labels of the failed items, capped for memory/log hygiene. */
  errorSources: string[];
  /** Highest number of workers observed in flight (for tests/monitoring). */
  maxConcurrencyObserved: number;
  /** Total wall time of the batch in ms. */
  durationMs: number;
}

export interface BatchRunOptions {
  /** Per-item timeout in ms. Workers that exceed it are aborted (if abortable) or rejected. */
  timeoutMs?: number;
  /** Called for each failed item with its label and error. Never throws. */
  onError?: (itemLabel: string, err: unknown) => void;
  /** Optional label resolver (defaults to String(item)). */
  label?: (item: unknown) => string;
  /** AbortSignal tied to the whole batch (e.g. task-level watchdog). */
  signal?: AbortSignal;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Run `worker(item)` over `items` with at most `concurrency` in flight.
 *
 * Failure isolation: each item is wrapped so a rejection or timeout is captured
 * and reported via `stats`/`onError`; the batch always completes.
 */
export async function runBoundedBatch<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<number>,
  options: BatchRunOptions = {},
): Promise<BatchRunStats> {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  const stats: BatchRunStats = {
    processedCount: 0,
    failedCount: 0,
    errorSources: [],
    maxConcurrencyObserved: 0,
    durationMs: 0,
  };
  if (items.length === 0) return stats;

  const startedAt = Date.now();
  let nextIndex = 0;
  let inFlight = 0;

  const recordError = (item: T, err: unknown) => {
    stats.failedCount += 1;
    const label = options.label ? options.label(item) : String(item);
    if (stats.errorSources.length < 10) stats.errorSources.push(label);
    if (options.onError) {
      try {
        options.onError(label, err);
      } catch {
        // callbacks must never break the batch
      }
    }
  };

  const runItem = async (index: number): Promise<void> => {
    inFlight += 1;
    stats.maxConcurrencyObserved = Math.max(stats.maxConcurrencyObserved, inFlight);
    const item = items[index];
    try {
      if (options.signal?.aborted) {
        recordError(item, new Error('Batch aborted'));
        return;
      }
      // Side effects (processedCount) are only applied for workers that finish
      // within the timeout — a late resolution after a timeout is discarded.
      await withTimeout(worker(item), options.timeoutMs);
      stats.processedCount += 1;
    } catch (err) {
      recordError(item, err);
    } finally {
      inFlight -= 1;
    }
  };

  // Simple worker-pool loop: keep `limit` workers alive until all items are done.
  const workers: Promise<void>[] = [];
  while (nextIndex < items.length && workers.length < limit) {
    const index = nextIndex;
    nextIndex += 1;
    workers.push(runItem(index).then(async () => {
      while (nextIndex < items.length) {
        const idx = nextIndex;
        nextIndex += 1;
        await runItem(idx);
      }
    }));
  }
  await Promise.all(workers);

  stats.durationMs = Date.now() - startedAt;
  return stats;
}
