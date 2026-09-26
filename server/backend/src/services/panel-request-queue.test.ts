import { runOnPanelQueue, panelQueueKey } from '../services/panel-request-queue';

/**
 * The provider allows one concurrent connection per source IP (2nd → HTTP 407, 3rd → 405).
 * These tests pin the queue that every panel caller shares, so the sync, the source watchdog
 * and playback setup cannot race each other for the same seat again.
 */
describe('panel-request-queue', () => {
  it('never runs two tasks for the same origin at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const task = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    };

    await Promise.all(Array.from({ length: 6 }, () => runOnPanelQueue('http://panel.example', task)));

    expect(maxInFlight).toBe(1);
  });

  it('keeps different origins in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const task = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
    };

    await Promise.all([
      runOnPanelQueue('http://a.example', task),
      runOnPanelQueue('http://b.example', task),
    ]);

    expect(maxInFlight).toBe(2);
  });

  it('runs queued work even after a failure, and surfaces that failure to its own caller', async () => {
    const first = runOnPanelQueue('http://fail.example', async () => {
      throw new Error('boom');
    });
    const second = runOnPanelQueue('http://fail.example', async () => 'survived');

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('survived');
  });

  it('does not leak one origin into another when one fails', async () => {
    await runOnPanelQueue('http://x.example', async () => {
      throw new Error('x down');
    }).catch(() => undefined);

    await expect(runOnPanelQueue('http://y.example', async () => 'fine')).resolves.toBe('fine');
  });

  describe('panelQueueKey', () => {
    it('keys by origin, so path and query do not open a second connection', () => {
      expect(panelQueueKey('http://panel.example/player_api.php?action=get_live_streams'))
        .toBe('http://panel.example');
      expect(panelQueueKey('http://panel.example:8080/live/u/p/1.ts')).toBe('http://panel.example:8080');
    });

    it('returns null for an unparseable URL instead of throwing', () => {
      expect(panelQueueKey('not a url')).toBeNull();
    });
  });
});
