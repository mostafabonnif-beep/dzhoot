import { decideChannelLiveness, CLIENT_LIVENESS_REASON } from '../services/client-liveness-service';

describe('decideChannelLiveness', () => {
  const now = new Date('2026-09-23T12:00:00Z');

  it('does not flag with too few failures', () => {
    expect(
      decideChannelLiveness({ successes: 0, failures: 2, lastSuccessAt: null, lastFailureAt: now }),
    ).toBe('none');
  });

  it('flags repeated failures with no successes', () => {
    expect(
      decideChannelLiveness({ successes: 0, failures: 5, lastSuccessAt: null, lastFailureAt: now }),
    ).toBe('flag');
  });

  it('flags when failures dominate successes', () => {
    expect(
      decideChannelLiveness({
        successes: 1,
        failures: 4,
        lastSuccessAt: new Date(now.getTime() - 6 * 3600e3),
        lastFailureAt: now,
      }),
    ).toBe('flag');
  });

  it('does not flag a healthy channel', () => {
    expect(
      decideChannelLiveness({
        successes: 10,
        failures: 3,
        lastSuccessAt: now,
        lastFailureAt: new Date(now.getTime() - 3600e3),
      }),
    ).toBe('none');
  });

  it('does not flag when the latest attempt is a success (channel recovered)', () => {
    expect(
      decideChannelLiveness({
        successes: 1,
        failures: 5,
        lastSuccessAt: now,
        lastFailureAt: new Date(now.getTime() - 3600e3),
      }),
    ).toBe('none');
  });

  it('flags on an exact tie only when failures meet the minimum and dominate the ratio', () => {
    // 3 failures vs 1 success: ratio 3 >= 2, min failures met, last attempt failed
    expect(
      decideChannelLiveness({
        successes: 1,
        failures: 3,
        lastSuccessAt: new Date(now.getTime() - 7200e3),
        lastFailureAt: now,
      }),
    ).toBe('flag');
    // 3 vs 2: ratio 1.5 < 2 — not dominant enough to hide a channel
    expect(
      decideChannelLiveness({
        successes: 2,
        failures: 3,
        lastSuccessAt: new Date(now.getTime() - 7200e3),
        lastFailureAt: now,
      }),
    ).toBe('none');
  });

  it('uses a dedicated flag reason so admin flags are never confused with it', () => {
    expect(CLIENT_LIVENESS_REASON).toBe('client-failures');
  });
});
