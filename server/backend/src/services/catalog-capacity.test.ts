/**
 * The channel ceiling must be above the real catalog, or the app silently syncs less
 * than the platform serves. See services/catalog-capacity.ts for the incident.
 */

import { tvChannelsMax, TV_CHANNELS_MAX_DEFAULT } from './catalog-capacity';

describe('tvChannelsMax', () => {
  const original = process.env.TV_CHANNELS_MAX;
  afterEach(() => {
    if (original === undefined) delete process.env.TV_CHANNELS_MAX;
    else process.env.TV_CHANNELS_MAX = original;
  });

  it('defaults above the measured catalog size', () => {
    delete process.env.TV_CHANNELS_MAX;
    // 25,968 channels were served on 2026-09-25; the ceiling must not sit below that.
    expect(tvChannelsMax()).toBe(TV_CHANNELS_MAX_DEFAULT);
    expect(tvChannelsMax()).toBeGreaterThan(25_968);
  });

  it('honours an explicit override', () => {
    process.env.TV_CHANNELS_MAX = '45000';
    expect(tvChannelsMax()).toBe(45_000);
  });

  it('ignores values that would silently truncate the catalog', () => {
    for (const bad of ['', 'abc', '0', '-1', 'NaN']) {
      process.env.TV_CHANNELS_MAX = bad;
      expect(tvChannelsMax()).toBe(TV_CHANNELS_MAX_DEFAULT);
    }
  });

  it('never returns a fractional limit', () => {
    process.env.TV_CHANNELS_MAX = '30000.7';
    expect(tvChannelsMax()).toBe(30_000);
  });
});
