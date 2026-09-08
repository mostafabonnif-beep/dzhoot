import {
  buildSportsMatches,
  isLikelySportsProgram,
  SportsMatchProgram,
} from './sports-matches';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');

function program(overrides: Partial<SportsMatchProgram> & { title: string }): SportsMatchProgram {
  return {
    channelEpgId: 'beinsports1.tr',
    description: '',
    category: [],
    startTime: NOW - 3600000,
    endTime: NOW + 3600000,
    ...overrides,
  };
}

describe('isLikelySportsProgram', () => {
  it('flags Arabic match titles (مباراة / كأس / دوري)', () => {
    expect(isLikelySportsProgram(program({ title: 'مباراة الجزائر والمغرب مباشرة' }))).toBe(true);
    expect(isLikelySportsProgram(program({ title: 'كأس العالم 2026 — الافتتاح' }))).toBe(true);
    expect(isLikelySportsProgram(program({ title: 'دوري أبطال أوروبا: الجولة الثالثة' }))).toBe(true);
  });

  it('flags Latin titles: team-vs-team, league keywords and phrases', () => {
    expect(isLikelySportsProgram(program({ title: 'PSG vs Marseille' }))).toBe(true);
    expect(isLikelySportsProgram(program({ title: 'Champions League: Real Madrid - Bayern' }))).toBe(true);
    expect(isLikelySportsProgram(program({ title: 'Premier League Live' }))).toBe(true);
    expect(isLikelySportsProgram(program({ title: 'Grand Prix de Monaco' }))).toBe(true);
  });

  it('flags programs whose category hints sports even with a neutral title', () => {
    expect(
      isLikelySportsProgram(program({ title: 'Direct', category: ['Sport'] })),
    ).toBe(true);
    expect(
      isLikelySportsProgram(program({ title: 'Le Match', category: ['Football'] })),
    ).toBe(true);
  });

  it('does not flag news, series or general entertainment', () => {
    expect(isLikelySportsProgram(program({ title: 'أخبار المساء' }))).toBe(false);
    expect(isLikelySportsProgram(program({ title: 'نشرة الأخبار' }))).toBe(false);
    expect(isLikelySportsProgram(program({ title: 'مسلسل درامي جديد' }))).toBe(false);
    expect(isLikelySportsProgram(program({ title: 'The Evening News', category: ['News'] }))).toBe(false);
    expect(isLikelySportsProgram(program({ title: 'Movie Night' }))).toBe(false);
  });

  it('rejects a bare "vs" without surrounding team names', () => {
    expect(isLikelySportsProgram(program({ title: 'vs' }))).toBe(false);
    expect(isLikelySportsProgram(program({ title: 'Live: vs coverage' }))).toBe(false);
  });
});

describe('buildSportsMatches', () => {
  const base = {
    channelEpgId: 'beinsports1.tr',
    title: 'مباراة جزائرية',
    startTime: new Date(NOW + 2 * 3600000).toISOString(),
    endTime: new Date(NOW + 4 * 3600000).toISOString(),
  };

  it('keeps live and upcoming sports only, sorted by start time', () => {
    const live = program({
      title: 'مباراة حية الآن',
      startTime: new Date(NOW - 1800000).toISOString(),
      endTime: new Date(NOW + 1800000).toISOString(),
    });
    const upcoming = program({
      title: 'مباراة بعد قليل',
      startTime: new Date(NOW + 3600000).toISOString(),
      endTime: new Date(NOW + 3 * 3600000).toISOString(),
    });
    const later = program({
      title: 'مباراة مسائية',
      channelEpgId: 'beinsports2.fr',
      startTime: new Date(NOW + 5 * 3600000).toISOString(),
      endTime: new Date(NOW + 7 * 3600000).toISOString(),
    });

    const matches = buildSportsMatches([later, upcoming, live], { nowMs: NOW });
    expect(matches.map((m) => m.status)).toEqual(['live', 'upcoming', 'upcoming']);
    expect(matches[0].title).toBe('مباراة حية الآن');
    expect(matches[2].channelEpgId).toBe('beinsports2.fr');
  });

  it('drops ended programs and non-sports programs', () => {
    const ended = program({
      title: 'مباراة انتهت',
      startTime: new Date(NOW - 5 * 3600000).toISOString(),
      endTime: new Date(NOW - 4 * 3600000).toISOString(),
    });
    const news = program({
      title: 'نشرة الأخبار',
      startTime: new Date(NOW + 3600000).toISOString(),
      endTime: new Date(NOW + 2 * 3600000).toISOString(),
    });
    const matches = buildSportsMatches([ended, news], { nowMs: NOW });
    expect(matches).toHaveLength(0);
  });

  it('deduplicates the same channel + start time', () => {
    const a = program(base);
    const b = program({ ...base, description: 'duplicate copy' });
    const matches = buildSportsMatches([a, b], { nowMs: NOW });
    expect(matches).toHaveLength(1);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      program({
        title: 'مباراة ' + i,
        channelEpgId: 'ch' + i,
        startTime: new Date(NOW + (i + 1) * 3600000).toISOString(),
        endTime: new Date(NOW + (i + 3) * 3600000).toISOString(),
      }),
    );
    expect(buildSportsMatches(many, { nowMs: NOW, limit: 4 })).toHaveLength(4);
  });

  it('marks an on-air program as live and later ones as upcoming', () => {
    const live = program({ title: 'مباراة مباشرة الآن', startTime: NOW - 600000, endTime: NOW + 600000 });
    const built = buildSportsMatches([live], { nowMs: NOW });
    expect(built[0].status).toBe('live');
    expect(Date.parse(built[0].startTime)).toBe(NOW - 600000);
  });
});
