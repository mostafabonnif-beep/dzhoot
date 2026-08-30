/**
 * Catalog display-name cleaner.
 *
 * Upstream catalogs decorate channel names with provider markers that look
 * unprofessional to customers and hint at the real source:
 *
 *   '###### RELAX ᴿᴬᵂ ######' → 'RELAX'
 *   'FR: COMEDY CENTRAL ᴴᴰ'   → 'COMEDY CENTRAL HD'
 *   'CA: TSN 5 ⁽ᴮᴷ⁾ ᴿᴬᵂ'      → 'TSN 5'
 *   'DZ|ENTV 1 FULL HD'        → 'ENTV 1 FULL HD'
 *
 * Rules are deliberately conservative: brand names and quality markers
 * (HD/FHD/HEVC/4K) are kept, only provider-specific decoration is removed.
 * 'RAW' is only stripped in its superscript/braced forms — the real 'WWE RAW'
 * channel keeps its name.
 */

// Superscript/circled letters and digits that only appear in provider
// decorations: ᴿᴬᵂ (RAW), ⁶⁰ᶠᵖˢ (60fps), ᴮᴷ (BK), ⁽ ⁾ wrappers.
const PROVIDER_SUPERSCRIPT_STRIP = /[ᴿᴬᵂᴮᴷ⁰¹²³⁴⁵⁶⁷⁸⁹ᶠᵖˢ⁽⁾]/gu;
// ᴴᴰ (HD) is a *quality* marker worth keeping, in normal text.
const SUPERS_HD = /ᴴ/gu;
const SUPER_D = /ᴰ/gu;

const DECORATIVE_WRAPPER =
  /#{2,}|[✦★☆•·◆◇►▶]|[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B50}\u{1F170}-\u{1F1FF}]/gu;
const BRACED_JUNK = /\s*[([]\s*(raw|bk|60fps)\s*[\])]\s*/giu;

// Curated country/language prefixes, only stripped when followed by an
// explicit separator (':', '|', '.', '_', '-', '–', '—'). This never touches
// real names like 'BEIN SPORTS' or 'AL ARABIYA'.
const COUNTRY_PREFIX =
  /^(?:fr|france|dz|alg|algerie|ar|ara|arab|arabic|mar|ma|tun|tn|maghreb|mag|ca|can|uk|my|us|usa|en|it|es|de|tr|afr|afrique|af|f|pt|por|ru|gr|nl|be|ch|sa|ae|qa|eg|th|id|vn|cn|jp|kr|in|pk|mx|br|se|no|dk|fi|pl|cz|hu|ro|bg|rs|hr|sk|at|ie|il|ir|telugu|nm|tv|uhd|vip|prem|prime|wow|gen|dstv|rx|hindi|ph|ku|ban|la|az|al|dub|ur)\s*[:|._–—-]\s*/iu;

// Real broadcaster groups whose tag is part of the brand (OSN Movies, stc TV):
// re-join instead of dropping ('OSN: MOVIES 1' → 'OSN MOVIES 1').
const BRAND_TAG_JOIN = /^(osn|stc)\s*[:|]\s*/iu;

/**
 * Clean a channel name for customer-facing display.
 * Returns the cleaned name (possibly unchanged). Never returns empty when the
 * input is non-empty — a name reduced to nothing falls back to the input.
 */
export function cleanDisplayChannelName(value: unknown): string {
  const raw = String(value ?? '');
  if (!raw.trim()) return '';

  let s = raw
    // 1) superscript HD → normal 'HD'
    .replace(SUPERS_HD, 'H')
    .replace(SUPER_D, 'D')
    // 2) drop other superscript decoration (RAW/60fps/BK + wrappers)
    .replace(PROVIDER_SUPERSCRIPT_STRIP, '')
    .normalize('NFKC')
    // 3) decorative wrappers, stars, emoji
    .replace(DECORATIVE_WRAPPER, ' ')
    // 4) braced junk tokens: (RAW) [RAW] (BK)
    .replace(BRACED_JUNK, ' ')
    // 5) leading country/language prefix with separator
    .replace(COUNTRY_PREFIX, '')
    // 6) real broadcaster tags keep their brand: 'OSN: MOVIES' → 'OSN MOVIES'
    .replace(BRAND_TAG_JOIN, '$1 ')
    .replace(/\s{2,}/gu, ' ')
    .trim();

  // A few names are *only* decoration (e.g. '###### RAW ######') — keep the
  // original rather than produce an empty/meaningless name.
  if (!s || s.length === 1) return raw.trim();

  // Strip trailing separators left by prefix removal (e.g. 'TSN 5 -').
  s = s.replace(/[\s:|._–—-]+$/gu, '');
  return s.trim();
}

/**
 * Best variant for a group of same-named channels: prefer HD/FHD/4K over
 * LQ/RAW/SD clones, +6h/REPLAY variants rank last.
 * Mirrors channelVariantRank() from the failover service for display purposes.
 */
export function variantRank(name: string): number {
  const n = String(name || '').normalize('NFKC').toLowerCase();
  if (/replay|\+?\s*6h\b|6\s*heures\b/.test(n)) return 100;
  if (/\blq\b/.test(n)) return 90;
  if (/\b(raw|60fps)\b/.test(n)) return 80;
  if (/\bsd\b/.test(n)) return 70;
  if (/\b(4k|uhd|fhd|hd|hevc|h265)\b/.test(n)) return 10;
  return 50;
}
