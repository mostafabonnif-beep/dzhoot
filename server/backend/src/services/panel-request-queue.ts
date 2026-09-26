/**
 * Per-origin serial queue for upstream panel requests.
 *
 * Why this exists (measured 2026-09-26): Xtream panels count connections per source IP —
 * the second concurrent request from one IP is answered with HTTP 407 and the third with
 * 405. Three different code paths talk to the same panel (the catalog sync, the source
 * watchdog, and playback setup), and they were each free to fire in parallel, so the 407
 * landed on whichever request lost the race. That made the failure move around: the sync
 * could succeed while the watchdog recorded `HTTP 407` for the same panel minutes later.
 *
 * Serialising per origin — FIFO, one request in flight at a time — is what the provider's
 * rule actually requires. Different panels stay parallel because the queue is keyed by
 * origin, and each request already carries its own timeout, so a stuck call cannot wedge
 * the queue forever.
 */

const panelQueues = new Map<string, Promise<unknown>>();

/** Run `task` after every previously queued task for `origin` has settled. */
export function runOnPanelQueue<T>(origin: string, task: () => Promise<T>): Promise<T> {
  const previous = panelQueues.get(origin) ?? Promise.resolve();
  // `then(task, task)` runs the task whether the previous one resolved or rejected, so one
  // failed call can never cancel the calls queued behind it.
  const current = previous.then(task, task);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  panelQueues.set(origin, tail);
  // Drop the entry once this chain is the last one, so the map cannot grow with every
  // panel ever contacted.
  void tail.then(() => {
    if (panelQueues.get(origin) === tail) panelQueues.delete(origin);
  });
  return current;
}

/** Origin of a URL, or null when it cannot be parsed (never throw from a queue helper). */
export function panelQueueKey(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
