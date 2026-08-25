import { cleanDisplayChannelName, variantRank } from '../utils/catalog-name-cleaner';

describe('catalog-name-cleaner', () => {
  it('strips provider decoration wrappers and superscript RAW/60fps', () => {
    expect(cleanDisplayChannelName('###### RELAX ᴿᴬᵂ ######')).toBe('RELAX');
    expect(cleanDisplayChannelName('#### PRIME ᴿᴬᵂ ⁶⁰ᶠᵖˢ #####')).toBe('PRIME');
  });

  it('converts superscript HD to a normal quality marker', () => {
    expect(cleanDisplayChannelName('FR: COMEDY CENTRAL ᴴᴰ')).toBe('COMEDY CENTRAL HD');
    expect(cleanDisplayChannelName('US: WWE ᴴᴰ')).toBe('WWE HD');
  });

  it('strips country/language prefixes with separators', () => {
    expect(cleanDisplayChannelName('FR | COMEDY CENTRAL ᴴᴰ')).toBe('COMEDY CENTRAL HD');
    expect(cleanDisplayChannelName('FR: TF1 HEVC')).toBe('TF1 HEVC');
    expect(cleanDisplayChannelName('DZ|ENTV 1 FULL HD')).toBe('ENTV 1 FULL HD');
    expect(cleanDisplayChannelName('CA: TSN 5 ⁽ᴮᴷ⁾ ᴿᴬᵂ')).toBe('TSN 5');
    expect(cleanDisplayChannelName('UK: 24/7 NETFLIX WWE ᴿᴬᵂ')).toBe('24/7 NETFLIX WWE');
    expect(cleanDisplayChannelName('MY: WWE NETWORK [ASTRO]')).toBe('WWE NETWORK [ASTRO]');
    expect(cleanDisplayChannelName('AR: Algerie EN TV 1')).toBe('Algerie EN TV 1');
    expect(cleanDisplayChannelName('NM: beIN SPORTS 1')).toBe('beIN SPORTS 1');
    expect(cleanDisplayChannelName('VIP: CANAL+ CINEMA')).toBe('CANAL+ CINEMA');
    expect(cleanDisplayChannelName('TV: YES MOVIES')).toBe('YES MOVIES');
    expect(cleanDisplayChannelName('GEN: MY COMEDY')).toBe('MY COMEDY');
    expect(cleanDisplayChannelName('RX: RELAX MOROCCO')).toBe('RELAX MOROCCO');
    expect(cleanDisplayChannelName('PRIME: 13EME RUE')).toBe('13EME RUE');
    expect(cleanDisplayChannelName('HINDI: ZEE TV')).toBe('ZEE TV');
    expect(cleanDisplayChannelName('OSN: MOVIES 1')).toBe('OSN MOVIES 1');
    expect(cleanDisplayChannelName('STC: MBC 1')).toBe('STC MBC 1');
  });

  it('never strips real brand names', () => {
    expect(cleanDisplayChannelName('BEIN SPORTS 1 HEVC')).toBe('BEIN SPORTS 1 HEVC');
    expect(cleanDisplayChannelName('WWE RAW')).toBe('WWE RAW'); // the wrestling brand
    expect(cleanDisplayChannelName('Echorouk TV')).toBe('Echorouk TV');
    expect(cleanDisplayChannelName('النهار')).toBe('النهار');
  });

  it('handles edge cases safely', () => {
    expect(cleanDisplayChannelName('')).toBe('');
    expect(cleanDisplayChannelName(null)).toBe('');
    expect(cleanDisplayChannelName(undefined)).toBe('');
    expect(cleanDisplayChannelName('TSN 5 -')).toBe('TSN 5'); // trailing separator
    expect(cleanDisplayChannelName('###### RAW ######')).toBe('RAW'); // decoration falls away
  });

  it('variantRank prefers HD over LQ/RAW/+6h clones', () => {
    expect(variantRank('TF1 HEVC')).toBeLessThan(variantRank('TF1 RAW'));
    expect(variantRank('TF1 FHD')).toBeLessThan(variantRank('TF1 LQ'));
    expect(variantRank('TF1 +6h')).toBeGreaterThan(variantRank('TF1 SD'));
    expect(variantRank('TF1 4K')).toBe(10);
  });
});
