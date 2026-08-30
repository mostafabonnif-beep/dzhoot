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
});
