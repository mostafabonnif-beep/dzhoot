import { buildChannelHealth } from './channel-health';

describe('buildChannelHealth', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('marks a recently tested healthy primary as healthy', () => {
    const result = buildChannelHealth(
      {
        metadata: {
          isWorking: true,
          lastTested: '2026-08-15T11:30:00.000Z',
          responseTime: 180,
        },
        metrics: { aliveCount: 9, deadCount: 1, unresponsiveCount: 0 },
      },
      now,
    );

    expect(result.status).toBe('healthy');
    expect(result.recommendation).toBe('primary');
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.successRate).toBe(0.9);
    expect(result.responseTimeMs).toBe(180);
  });

  it('keeps a recently confirmed primary healthy after the one-hour freshness step-down', () => {
    const result = buildChannelHealth(
      {
        metadata: {
          isWorking: true,
          lastTested: '2026-08-15T10:30:00.000Z',
          responseTime: 500,
        },
      },
      now,
    );

    expect(result.score).toBe(66);
    expect(result.status).toBe('healthy');
    expect(result.recommendation).toBe('primary');
  });

  it('recommends a viable fallback when the primary is dead', () => {
    const result = buildChannelHealth(
      {
        metadata: { isWorking: false, lastTested: '2026-08-15T11:00:00.000Z' },
        alternateStreams: [
          {
            flaggedBad: { isFlagged: false },
            liveness: {
              status: 'alive',
              lastCheckedAt: '2026-08-15T11:45:00.000Z',
              responseTimeMs: 220,
            },
          },
          {
            flaggedBad: { isFlagged: true },
            liveness: { status: 'alive' },
          },
        ],
      },
      now,
    );

    expect(result.status).toBe('degraded');
    expect(result.recommendation).toBe('fallback');
    expect(result.fallbackCount).toBe(1);
    expect(result.lastCheckedAt).toBe('2026-08-15T11:45:00.000Z');
  });

  it('marks a dead channel without a viable fallback unavailable', () => {
    const result = buildChannelHealth({
      metadata: { isWorking: false, lastTested: '2026-08-15T11:00:00.000Z' },
      alternateStreams: [{ liveness: { status: 'dead' } }],
    }, now);

    expect(result.status).toBe('unavailable');
    expect(result.recommendation).toBe('offline');
    expect(result.fallbackCount).toBe(0);
  });

  it('keeps a direct-playback channel unknown even when the datacenter probe fails', () => {
    const result = buildChannelHealth({
      metadata: { isWorking: false, lastTested: '2026-08-15T11:00:00.000Z' },
      alternateStreams: [],
      directPlayback: true,
    }, now);

    // The server's datacenter probe cannot judge direct-playback sources (clients
    // fetch from their own networks) — it must never surface as "unavailable".
    expect(result.primaryStatus).toBe('unknown');
    expect(result.status).toBe('unknown');
    expect(result.recommendation).toBe('probe');
  });

  it('keeps an untested channel explicitly unknown', () => {
    const result = buildChannelHealth({});

    expect(result.status).toBe('unknown');
    expect(result.recommendation).toBe('probe');
    expect(result.score).toBe(0);
    expect(result.lastCheckedAt).toBeNull();
  });
});
