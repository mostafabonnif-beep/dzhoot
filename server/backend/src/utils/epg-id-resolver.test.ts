import { resolveEpgIdForChannel, epgIdName, canonicalKey, EpgIdResolverInput } from '../utils/epg-id-resolver';

const GUIDE_IDS = [
  'beIN_SPORTS1_DIGITAL_Mono_AR.bein',
  'beIN_SPORTS2_DIGITAL_Mono_AR.bein',
  'beinsp3.tr',
  'Alkass_1_AR.bein',
  'Alkass_2_EN.bein',
  'al.jazeera.arabic.tr',
  'al.jazeera.international.tr',
  'CARTOON.NETWORK.tr',
  'DISNEY.CHANNEL.tr',
  'TF1.fr',
];

function makeInput(overrides: Partial<EpgIdResolverInput> = {}): EpgIdResolverInput {
  const byLower = new Map<string, string>();
  for (const id of GUIDE_IDS) byLower.set(id.toLowerCase(), id);
  const nameToId = new Map<string, string>();
  for (const id of GUIDE_IDS) {
    const key = epgIdName(id);
    if (key.length >= 3) nameToId.set(key, id);
  }
  return {
    channelName: '',
    availableIds: new Set(GUIDE_IDS.map((x) => x.toLowerCase())),
    byLower,
    nameToId,
    ...overrides,
  };
}

describe('epg-id-resolver', () => {
  it('maps beIN SPORTS 1 to the Arabic beIN 1 guide id', () => {
    const r = resolveEpgIdForChannel(makeInput({ channelName: 'NM: beIN SPORTS 1 ᴴᴰ' }));
    expect(r).toEqual({ tvgId: 'beIN_SPORTS1_DIGITAL_Mono_AR.bein', via: 'bein-ar' });
  });

  it('does NOT fall back to beIN 1 when the guide lacks the requested number', () => {
    // Regression for the live bug: "beIN SP⚽RTS 5" previously resolved to
    // beIN_SPORTS1 because the emoji broke the digit capture.
    const r = resolveEpgIdForChannel(makeInput({ channelName: '8K: beIN SP⚽RTS 5 ᴴᴰ' }));
    expect(r).toBeNull();
  });

  it('maps beIN 3 (no Arabic id) to the Turkish guide id', () => {
    const r = resolveEpgIdForChannel(makeInput({ channelName: 'beIN SPORTS 3' }));
    expect(r).toEqual({ tvgId: 'beinsp3.tr', via: 'bein-tr' });
  });

  it('skips beIN MAX (guide has no MAX feeds)', () => {
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'beIN SPORTS MAX' }))).toBeNull();
  });

  it('maps Alkass 1 and Alkass 2 variants', () => {
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'ALKASS 1 AR' }))).toEqual({
      tvgId: 'Alkass_1_AR.bein',
      via: 'alkass-ar',
    });
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'ALKASS 2 ENGLISH' }))).toEqual({
      tvgId: 'Alkass_2_EN.bein',
      via: 'alkass-en',
    });
  });

  it('maps Al Jazeera Arabic/International by variant keyword', () => {
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'AL JAZEERA ARABIC' }))).toEqual({
      tvgId: 'al.jazeera.arabic.tr',
      via: 'jazeera-ar',
    });
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'AL JAZEERA INTL ᴴᴰ' }))).toEqual({
      tvgId: 'al.jazeera.international.tr',
      via: 'jazeera-en',
    });
  });

  it('maps generic international channels by exact normalized name', () => {
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'CARTOON NETWORK HD' }))).toEqual({
      tvgId: 'CARTOON.NETWORK.tr',
      via: 'generic',
    });
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'TF1' }))).toEqual({
      tvgId: 'TF1.fr',
      via: 'generic',
    });
  });

  it('returns null for unmatched or decoration-only names', () => {
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'RX: RELAX MOROCCO' }))).toBeNull();
    expect(resolveEpgIdForChannel(makeInput({ channelName: '' }))).toBeNull();
    expect(resolveEpgIdForChannel(makeInput({ channelName: '###### RAW ######' }))).toBeNull();
  });

  it('canonicalKey strips the provider decoration that broke the beIN capture', () => {
    expect(canonicalKey('8K: beIN SP⚽RTS 5 ᴴᴰ')).toBe('bein sports 5');
  });

  it('epgIdName strips any 2-letter country suffix, not just the legacy allowlist', () => {
    // Legacy allowlisted suffixes keep working.
    expect(epgIdName('TF1.fr')).toBe('tf1');
    expect(epgIdName('beIN_SPORTS1_DIGITAL_Mono_AR.bein')).toBe('bein sports1 digital mono ar');
    // Suffixes the fixed allowlist missed (epgshare01 country files).
    expect(epgIdName('MBC.MASR.2.eg')).toBe('mbc masr 2');
    expect(epgIdName('ART.Aflam.1.eg')).toBe('art aflam 1');
    expect(epgIdName('MBC.1.ae')).toBe('mbc 1');
    expect(epgIdName('IL.Sport.il')).toBe('il sport');
    expect(epgIdName('beIN.Sports.1.qa')).toBe('bein sports 1');
    // Ids without a country-like suffix stay untouched.
    expect(epgIdName('CARTOON.NETWORK')).toBe('cartoon network');
  });
});

describe('epg-id-resolver: non-sports beIN brands', () => {
  it('never maps beIN CINEMA/FILM/OD/ARABIC channels to a Sports guide id', () => {
    const input = makeInput();
    for (const name of [
      'BEIN CINEMA COMEDY 2',
      'BEIN CINEMA FILM 3',
      'BEIN OD FILMS 4',
      'BEIN DOCUMENTARY 2',
      'BEIN ACTION 2',
      'BEIN ARABIC 1',
      'BEIN FRENCH 1',
    ]) {
      expect(resolveEpgIdForChannel(makeInput({ channelName: name }))).toBeNull();
    }
  });

  it('still maps real beIN SPORTS feeds', () => {
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'BEIN SPORTS 1' }))).not.toBeNull();
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'BEIN SPORT TOD 5' }))).toBeNull(); // guide lacks beIN 5
    expect(resolveEpgIdForChannel(makeInput({ channelName: 'BEIN 1' }))).not.toBeNull();
  });
});
