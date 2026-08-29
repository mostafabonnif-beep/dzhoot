'use strict';

// Customer-facing catalog presentation must be independent of upstream naming.
// This module never mutates source metadata in MongoDB; source/rights records stay
// available to authorized operators while client payloads receive only neutral data.

const HASH_MARKER = /#{3,}/u;
const UPSTREAM_NAME_MARKER = /(?:^|[\s|_./-])neo(?:[\s|_./-]|$)/iu;
const DEFAULT_COUNTRY = 'دولي';
const DEFAULT_CATEGORY = 'عام';

const REGION_LABELS = {
  AR: 'العالم العربي',
  DZ: 'الجزائر',
  FR: 'فرنسا',
  UK: 'المملكة المتحدة',
  US: 'الولايات المتحدة',
  CA: 'كندا',
  TR: 'تركيا',
  DE: 'ألمانيا',
  ES: 'إسبانيا',
  IT: 'إيطاليا',
  PT: 'البرتغال',
  BR: 'البرازيل',
  MX: 'المكسيك',
  IN: 'الهند',
  PK: 'باكستان',
  AF: 'أفغانستان',
  IR: 'إيران',
  IQ: 'العراق',
  EG: 'مصر',
  SA: 'السعودية',
  MA: 'المغرب',
  TN: 'تونس',
  LY: 'ليبيا',
  AE: 'الإمارات',
  QA: 'قطر',
  IL: 'عبرية',
  RU: 'روسيا',
  GR: 'اليونان',
  NL: 'هولندا',
  BE: 'بلجيكا',
  SE: 'السويد',
  NO: 'النرويج',
  DK: 'الدنمارك',
  FI: 'فنلندا',
  PL: 'بولندا',
  CZ: 'التشيك',
  RO: 'رومانيا',
  HU: 'المجر',
  RS: 'صربيا',
  HR: 'كرواتيا',
  BG: 'بلغاريا',
  CH: 'سويسرا',
  AT: 'النمسا',
  AFR: 'أفريقيا',
  ASIA: 'آسيا',
  EU: 'أوروبا',
  LATAM: 'أمريكا اللاتينية',
};

const CATEGORY_RULES = [
  ['رياضة', /(?:sport|soccer|football|f[úu]tbol|bein|dazn|espn|arena|kass|ppv|nba|nfl|nhl|ufc|wwe|golf|tennis|cricket|racing|motogp|formula\s*1)/iu],
  ['أفلام ومسلسلات', /(?:movie|cinema|film|series|drama|canal\+|hbo|netflix|showtime|starz|amc|24\s*\/\s*7)/iu],
  ['أطفال', /(?:kids|cartoon|disney|nick|boomerang|baby|junior)/iu],
  ['أخبار', /(?:news|cnn|bbc|al\s*jazeera|france\s*24|sky\s*news|euronews|bloomberg|cnbc)/iu],
  ['وثائقي', /(?:documentary|discovery|national\s*geographic|history|animal\s*planet|science)/iu],
  ['ترفيه', /(?:entertainment|reality|comedy|lifestyle|fashion|travel|food)/iu],
  ['موسيقى', /(?:music|radio|mtv|hits|vevo)/iu],
  ['ديني', /(?:quran|islam|religion|church|holy|mosque)/iu],
];

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// ── Display-name cleaning ────────────────────────────────────────────────
// Supplier catalogs decorate names with phonetic/small-caps unicode
// (ᴴᴰ ᴿᴬᵂ ⱽᴵᴾ ᵗᵛ), geometric shapes (▶ ● ◆) and emoji (⚽ 🅻🅸🆅🅴 🔴). They
// look broken on TV screens. Strip everything outside a conservative allowlist
// (letters/digits + basic punctuation) while keeping the readable name and the
// supplier's ordering intact.

const DECORATIVE_RANGES = [
  [0x1d00, 0x1d7f], // phonetic extensions (ᴬ ᴴᴰ ᴿ ...)
  [0x1d80, 0x1dbf], // phonetic extensions supplement
  [0x2070, 0x209f], // superscripts & subscripts (⁰ ᵃ ᵛ ...)
  [0x2c60, 0x2c7f], // latin extended-C (ⱽ)
  [0x2190, 0x21ff], // arrows (▶ is U+25B6, but keep ranges broad)
  [0x25a0, 0x25ff], // geometric shapes (● ◆ ▸ ...)
  [0x2600, 0x26ff], // misc symbols (⚽ ☑ ★ ...)
  [0x2700, 0x27bf], // dingbats (✚ ❯ ✓ ...)
  [0x2b00, 0x2bff], // misc symbols and arrows
  [0x1f000, 0x1faff], // emoji / enclosed letters (🅻🅸🆅🅴 🔴 🏴 ...)
  [0x1fb00, 0x1fbff], // symbols for legacy computing
  [0x00a0, 0x00bf], // latin-1 punctuation/symbols (keep é? no — strip ª º « » © etc.)
];

const ALLOWED_PUNCTUATION = new Set('|:&/.,()-\'’–—+!?%#*[]');
const DECORATIVE_EMOJI = new Set('⚽🏀🏆🎬🎵🎶📺🔥⭐🌟💎👑💯✅❌❤️💙💚🚀☑✔➤➥»«⏺⏩⏪⏸🅻🅸🆅🅴');

function isAllowedCodePoint(code) {
  if (DECORATIVE_EMOJI.has(String.fromCodePoint(code))) return false;
  for (const [lo, hi] of DECORATIVE_RANGES) {
    if (code >= lo && code <= hi) return false;
  }
  const cat = String.fromCodePoint(code);
  if (ALLOWED_PUNCTUATION.has(cat)) return true;
  // Letters (incl. Arabic), digits, and spaces survive.
  return /[\p{L}\p{N}\p{Zs}]/u.test(cat);
}

/**
 * Remove supplier decorations (small-caps unicode, symbols, emoji) from a
 * display string while preserving the readable name. Falls back to the
 * original text when the result would be blank.
 */
function cleanDisplayText(value) {
  const raw = asText(value);
  if (!raw) return '';
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    if (isAllowedCodePoint(code)) out += ch;
  }
  // Collapse runs of whitespace, drop leading/trailing separators.
  const cleaned = out.replace(/\s+/g, ' ').replace(/^[\s|:,\-—/]+|[\s|:,\-—/]+$/g, '').trim();
  return cleaned || raw.trim();
}

/** Strip a leading source label like "4K-AR: " from VOD titles. */
function cleanVodTitle(value) {
  const raw = asText(value);
  return raw.replace(/^[A-Z0-9]{1,4}-?[A-Z]{0,3}:\s*/i, '');
}

function displayFields(channel) {
  return [
    asText(channel?.channelName),
    asText(channel?.tvgName),
    asText(channel?.channelGroup),
    asText(channel?.channelImg),
    asText(channel?.tvgLogo),
  ];
}

function hasRestrictedPresentationMarker(channel) {
  return displayFields(channel).some(
    (value) => HASH_MARKER.test(value) || UPSTREAM_NAME_MARKER.test(value),
  );
}

function publicCatalogPresentationQuery() {
  return {
    $nor: [
      { channelName: HASH_MARKER },
      { tvgName: HASH_MARKER },
      { channelGroup: HASH_MARKER },
      { channelImg: HASH_MARKER },
      { tvgLogo: HASH_MARKER },
      { channelName: UPSTREAM_NAME_MARKER },
      { tvgName: UPSTREAM_NAME_MARKER },
      { channelGroup: UPSTREAM_NAME_MARKER },
      { channelImg: UPSTREAM_NAME_MARKER },
      { tvgLogo: UPSTREAM_NAME_MARKER },
    ],
  };
}

// ── Catalog curation (operator-controlled) ────────────────────────────────
// CATALOG_HIDE_GROUPS = comma-separated regex patterns of channel groups to
// hide from ALL customer-facing outputs (TV list, EPG, categories, M3U,
// search). Nothing is deleted — the data stays for the operator. Default
// hides radio streams (filler); set CATALOG_HIDE_GROUPS=none to disable.
function hiddenGroupRegexes() {
  const raw = String(process.env.CATALOG_HIDE_GROUPS || 'RADIO').trim();
  if (!raw || raw.toLowerCase() === 'none') return [];
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => new RegExp(p, 'i'));
}

/** Mongo condition hiding curated groups ({} when nothing to hide). */
function publicCatalogHideQuery() {
  const regexes = hiddenGroupRegexes();
  if (!regexes.length) return {};
  return { $nor: regexes.map((r) => ({ channelGroup: r })) };
}

/** True when a channel's group is hidden by curation (client-side guard). */
function isHiddenGroup(channel) {
  const group = asText(channel?.channelGroup);
  if (!group) return false;
  return hiddenGroupRegexes().some((r) => r.test(group));
}

function regionFromGroup(group) {
  const raw = asText(group);
  const [prefix] = raw.split('|', 1);
  const code = asText(prefix).toUpperCase();
  return {
    code: REGION_LABELS[code] ? code : null,
    label: REGION_LABELS[code] || DEFAULT_COUNTRY,
  };
}

function categoryFromChannel(channel) {
  const haystack = [
    asText(channel?.channelGroup),
    asText(channel?.channelName),
    asText(channel?.tvgName),
  ].join(' ');
  const match = CATEGORY_RULES.find(([, rule]) => rule.test(haystack));
  return match ? match[0] : DEFAULT_CATEGORY;
}

function presentationForChannel(channel) {
  const region = regionFromGroup(channel?.channelGroup);
  const category = categoryFromChannel(channel);
  return {
    countryCode: region.code,
    country: region.label,
    category,
    group: `${region.label} · ${category}`,
  };
}

function safeClientMetadata(metadata, presentation) {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  return {
    country: presentation.country,
    countryCode: presentation.countryCode,
    language: asText(source.language) || null,
    quality: asText(source.quality) || null,
  };
}

function safeClientAlternates(alternates) {
  if (!Array.isArray(alternates)) return [];
  return alternates.map((alternate) => ({
    streamUrl: asText(alternate?.streamUrl),
    quality: asText(alternate?.quality) || null,
    liveness: alternate?.liveness
      ? {
          status: asText(alternate.liveness.status) || 'unknown',
          responseTimeMs: Number.isFinite(alternate.liveness.responseTimeMs)
            ? alternate.liveness.responseTimeMs
            : null,
          lastCheckedAt: alternate.liveness.lastCheckedAt || null,
        }
      : undefined,
    flaggedBad: alternate?.flaggedBad
      ? { isFlagged: alternate.flaggedBad.isFlagged === true, reason: asText(alternate.flaggedBad.reason) || null }
      : undefined,
  }));
}

function presentChannelForClient(channel) {
  const source = channel?.toObject ? channel.toObject() : channel;
  const safeChannel = { ...(source || {}) };
  delete safeChannel.metadata;
  delete safeChannel.alternateStreams;
  delete safeChannel.activeUserAgent;
  delete safeChannel.activeReferrer;
  delete safeChannel.channelDrmKey;
  const presentation = presentationForChannel(source);
  // Prefer the supplier's own group label (already clean of ###/NEO markers;
  // here additionally stripped of unicode decorations) so viewers keep the
  // familiar channel structure and order; fall back to the neutral
  // "country · category" label only when a channel has no raw group.
  const rawGroup = cleanDisplayText(source?.channelGroup);
  return {
    ...safeChannel,
    channelName: cleanDisplayText(source?.channelName),
    tvgName: cleanDisplayText(source?.tvgName) || cleanDisplayText(source?.channelName),
    channelGroup: rawGroup || presentation.group,
    metadata: safeClientMetadata(source?.metadata, presentation),
    alternateStreams: safeClientAlternates(source?.alternateStreams),
    catalog: {
      countryCode: presentation.countryCode,
      country: presentation.country,
      category: presentation.category,
    },
  };
}

function compareClientCatalogChannels(left, right) {
  // Restore the supplier's intended ordering (group, then per-group order,
  // then name) instead of re-sorting by the neutral presentation labels —
  // the operator's curated channel structure must stay visible to viewers.
  const groupCmp = asText(left?.channelGroup).localeCompare(asText(right?.channelGroup), 'ar');
  if (groupCmp !== 0) return groupCmp;
  const leftOrder = Number(left?.order) || 0;
  const rightOrder = Number(right?.order) || 0;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return (
    asText(left?.channelName).localeCompare(asText(right?.channelName), 'ar') ||
    asText(left?.channelId).localeCompare(asText(right?.channelId))
  );
}

function sortClientCatalogChannels(channels) {
  return [...channels].sort(compareClientCatalogChannels);
}

module.exports = {
  hasRestrictedPresentationMarker,
  publicCatalogPresentationQuery,
  publicCatalogHideQuery,
  isHiddenGroup,
  presentationForChannel,
  presentChannelForClient,
  safeClientMetadata,
  safeClientAlternates,
  sortClientCatalogChannels,
  cleanDisplayText,
  cleanVodTitle,
};
