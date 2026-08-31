import {
  buildCatchupUrlForChannel,
  buildM3uCatchupUrl,
  buildXtreamTimeshiftUrl,
  getCatchupWindowDays,
  isCatchupSupported,
  substituteCatchupTemplate,
} from './catchup-service';

const NOW = Date.parse('2026-08-12T12:00:00Z');

describe('substituteCatchupTemplate', () => {
  const template = 'https://cdn.example/catchup.m3u8?utc={utc}&lutc={lutc}&start={start}&end={end}&duration={duration}';

  it('replaces all standard placeholders with epoch seconds', () => {
    const start = Date.parse('2026-08-12T11:00:00Z');
    const durationMs = 90 * 60 * 1000; // 90 minutes
    const url = substituteCatchupTemplate(template, start, durationMs, NOW);

    expect(url).toBe(
      'https://cdn.example/catchup.m3u8?utc=1786536000&lutc=1786532400&start=1786532400&end=1786537800&duration=5400',
    );
  });

  it('leaves unknown placeholders untouched', () => {
    const url = substituteCatchupTemplate('https://x.example/?foo={bar}&a={start}', 1000, 60_000, NOW);
    expect(url).toBe('https://x.example/?foo={bar}&a=1');
  });
});

describe('isCatchupSupported / getCatchupWindowDays', () => {
  it('detects M3U channels from stored catchup type', () => {
    const channel = { catchup: { type: 'append', source: 'http://t', days: 5 } };
    expect(isCatchupSupported(channel)).toBe(true);
    expect(getCatchupWindowDays(channel)).toBe(5);
  });

  it('defaults to CATCHUP_DEFAULT_DAYS when type present but days unset', () => {
    expect(getCatchupWindowDays({ catchup: { type: 'append' } })).toBe(7);
  });

  it('treats legacy Xtream channels (pre-catchup sync) as capable', () => {
    const channel = { metadata: { source: 'xtream', xtreamStreamId: 101 } };
    expect(isCatchupSupported(channel)).toBe(true);
    expect(getCatchupWindowDays(channel)).toBe(7);
  });

  it('rejects plain channels', () => {
    expect(isCatchupSupported({})).toBe(false);
    expect(isCatchupSupported({ catchup: { type: null } })).toBe(false);
    expect(getCatchupWindowDays({})).toBe(0);
  });
});

describe('buildM3uCatchupUrl', () => {
  it('returns null when the channel has no catchup-source template', () => {
    expect(buildM3uCatchupUrl({ catchup: { type: 'timeshift' } }, 1, 60_000, NOW)).toBeNull();
    expect(buildM3uCatchupUrl({}, 1, 60_000, NOW)).toBeNull();
  });
});

describe('buildXtreamTimeshiftUrl', () => {
  it('formats the Xtream /timeshift/ URL with UTC start', () => {
    const url = buildXtreamTimeshiftUrl(
      { serverUrl: 'http://panel.example:8080/', username: 'u s e r', password: 'p@ss', streamId: 101 },
      Date.parse('2026-08-12T11:05:00Z'),
      90,
    );
    expect(url).toBe(
      'http://panel.example:8080/timeshift/u%20s%20e%20r/p%40ss/90/2026-08-12:11-05/101.m3u8',
    );
  });
});

describe('buildCatchupUrlForChannel', () => {
  it('builds an M3U template URL and enforces the window', () => {
    const channel = {
      catchup: { type: 'append', source: 'https://cdn.example/?lutc={lutc}&duration={duration}', days: 2 },
    };
    const start = Date.parse('2026-08-12T11:00:00Z'); // 1h ago → within 2 days
    const built = buildCatchupUrlForChannel(channel, { startMs: start, durationMin: 90, nowMs: NOW });
    expect(built.ok).toBe(true);
    expect(built.url).toContain('lutc=1786532400');
    expect(built.url).toContain('duration=5400');
  });

  it('rejects starts outside the provider window', () => {
    const channel = { catchup: { type: 'append', source: 'https://cdn.example/?start={start}', days: 1 } };
    const start = Date.parse('2026-08-05T00:00:00Z'); // 7 days ago → outside 1-day window
    const built = buildCatchupUrlForChannel(channel, { startMs: start, durationMin: 30, nowMs: NOW });
    expect(built).toEqual({
      ok: false,
      code: 'CATCHUP_OUT_OF_WINDOW',
      error: 'Catch-up is only available for the last 1 days',
    });
  });

  it('clamps oversized durations to CATCHUP_MAX_DURATION_MIN', () => {
    const channel = { catchup: { type: 'append', source: 'https://cdn.example/?duration={duration}', days: 7 } };
    const built = buildCatchupUrlForChannel(channel, {
      startMs: Date.parse('2026-08-12T11:00:00Z'),
      durationMin: 7 * 24 * 60,
      nowMs: NOW,
    });
    expect(built.ok).toBe(true);
    expect(built.url).toBe('https://cdn.example/?duration=86400'); // 1440 min = 86400 s
  });

  it('builds an Xtream timeshift URL from decrypted creds', () => {
    const channel = { catchup: { type: 'timeshift', days: 3 }, metadata: { xtreamStreamId: 202 } };
    const built = buildCatchupUrlForChannel(channel, {
      startMs: Date.parse('2026-08-12T10:30:00Z'),
      durationMin: 120,
      nowMs: NOW,
      xtreamCreds: { serverUrl: 'https://panel.example', username: 'u', password: 'p' },
    });
    expect(built.ok).toBe(true);
    expect(built.url).toContain('/timeshift/u/p/120/2026-08-12:10-30/202.m3u8');
  });

  it('supports legacy Xtream channels without stored catchup', () => {
    const channel = { metadata: { source: 'xtream', xtreamStreamId: 303 } };
    const built = buildCatchupUrlForChannel(channel, {
      startMs: Date.parse('2026-08-12T10:30:00Z'),
      durationMin: 60,
      nowMs: NOW,
      xtreamCreds: { serverUrl: 'https://panel.example', username: 'u', password: 'p' },
    });
    expect(built.ok).toBe(true);
    expect(built.url).toContain('/timeshift/u/p/60/');
  });

  it('rejects channels with no catch-up capability', () => {
    const built = buildCatchupUrlForChannel({}, { startMs: 1000, durationMin: 30, nowMs: NOW });
    expect(built).toEqual({
      ok: false,
      code: 'CATCHUP_UNAVAILABLE',
      error: 'Catch-up is not available for this channel',
    });
  });

  it('rejects invalid times', () => {
    expect(
      buildCatchupUrlForChannel({ catchup: { type: 'append', source: 'http://t' } }, {
        startMs: 0,
        durationMin: 30,
        nowMs: NOW,
      }).code,
    ).toBe('INVALID_CATCHUP_TIME');
    expect(
      buildCatchupUrlForChannel({ catchup: { type: 'append', source: 'http://t' } }, {
        startMs: 1000,
        durationMin: 0,
        nowMs: NOW,
      }).code,
    ).toBe('INVALID_CATCHUP_TIME');
  });
});
