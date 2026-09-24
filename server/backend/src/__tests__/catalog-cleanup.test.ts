import {
  candidateScore,
  pickWinnerIndex,
  JUNK_NAME_REGEX,
  MAX_ALTERNATES,
} from '../services/catalog-cleanup-service';

const mk = (over: Partial<any> = {}) => ({
  _id: over._id ?? 'x',
  channelName: 'ESPN HD',
  tvgId: null,
  channelImg: null,
  channelUrl: 'http://s/x.m3u8',
  flaggedBad: null,
  alternateStreams: [],
  updatedAt: new Date('2026-09-24T00:00:00Z'),
  ...over,
});

describe('candidateScore', () => {
  it('ranks EPG-matched and logoed channels higher', () => {
    expect(candidateScore(mk({ tvgId: 'e', channelImg: 'i' }))).toBeGreaterThan(
      candidateScore(mk()),
    );
  });

  it('sinks known-dead channels below everything', () => {
    expect(candidateScore(mk({ flaggedBad: { isFlagged: true } }))).toBeLessThan(
      candidateScore(mk()),
    );
  });

  it('gives a small bonus for existing alternates', () => {
    expect(candidateScore(mk({ alternateStreams: [{}] }))).toBeGreaterThan(
      candidateScore(mk()),
    );
  });
});

describe('pickWinnerIndex', () => {
  it('picks the EPG-matched copy over bare copies', () => {
    const cands = [mk(), mk({ tvgId: 'epg' }), mk({ channelImg: 'u' })];
    expect(pickWinnerIndex(cands)).toBe(1);
  });

  it('never picks a flagged-dead copy when a live one exists', () => {
    const cands = [
      mk({ tvgId: 'e', channelImg: 'i' }),
      mk({ tvgId: 'e', channelImg: 'i', flaggedBad: { isFlagged: true } }),
    ];
    expect(pickWinnerIndex(cands)).toBe(0);
  });

  it('breaks ties by most recently updated', () => {
    const cands = [
      mk({ updatedAt: new Date('2026-01-01T00:00:00Z') }),
      mk({ updatedAt: new Date('2026-09-24T00:00:00Z') }),
    ];
    expect(pickWinnerIndex(cands)).toBe(1);
  });
});

describe('constants', () => {
  it('junk regex catches dead-listing names without touching normal ones', () => {
    expect(JUNK_NAME_REGEX.test('ENDED | SOMETHING')).toBe(true);
    expect(JUNK_NAME_REGEX.test('BEIN SPORTS 1 HD 8K EXCLUSIVE')).toBe(true);
    expect(JUNK_NAME_REGEX.test('CANAL+ SPORT HD')).toBe(false);
  });

  it('caps alternates at the playback-token slot count', () => {
    expect(MAX_ALTERNATES).toBe(3);
  });
});
