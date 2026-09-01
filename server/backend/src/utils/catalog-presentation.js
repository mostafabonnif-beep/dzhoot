'use strict';

// Customer-facing catalog presentation must be independent of upstream naming.
// This module never mutates source metadata in MongoDB; source/rights records stay
// available to authorized operators while client payloads receive only neutral data.

const HASH_MARKER = /#{3,}/u;
const UPSTREAM_NAME_MARKER = /(?:^|[\s|_./-])neo(?:[\s|_./-]|$)/iu;
const DEFAULT_COUNTRY = 'دولي';
const DEFAULT_CATEGORY = 'عام';

// Group/name keywords → region code. Lets region detection work with supplier
// labels like "~ ALGERIE ~", "Dz| …", "ALG: …", "ARABIC CHANNEL" instead of
// requiring a bare ISO code prefix.
const REGION_KEYWORDS = [
  [/\b(algerie|alg[eé]rie|algeria|dz\b|alg:)/iu, 'DZ'],
  [/\b(arab(ic)?|العربي|العربية)\b/iu, 'AR'],
  [/\b(maghreb|maghrib|المغرب العربي)\b/iu, 'AR'],
  [/\b(morocco|maroc|marocain|المغرب)\b/iu, 'MA'],
  [/\b(tunisia|tunisie|تونس)\b/iu, 'TN'],
  [/\b(libya|libye|ليبيا)\b/iu, 'LY'],
  [/\b(egypt|egypte|مصر)\b/iu, 'EG'],
  [/\b(saudi|السعودية)\b/iu, 'SA'],
  [/\b(france|french|فرنسا)\b/iu, 'FR'],
  [/\b(united kingdom|uk\b|britain|british|إنجلترا|بريطانيا)\b/iu, 'UK'],
  [/\b(united states|usa\b|us\b|america|american|أمريكا|الولايات المتحدة)\b/iu, 'US'],
  [/\b(canada|canad|كندا)\b/iu, 'CA'],
  [/\b(turkey|turkish|تركيا)\b/iu, 'TR'],
  [/\b(germany|german|deutsch|ألمانيا)\b/iu, 'DE'],
  [/\b(spain|spanish|espa[nñ]a|إسبانيا)\b/iu, 'ES'],
  [/\b(italy|italian|italia|إيطاليا)\b/iu, 'IT'],
  [/\b(portugal|portugu[eê]s|البرتغال)\b/iu, 'PT'],
  [/\b(brazil|brasil|brazilian|البرازيل)\b/iu, 'BR'],
  [/\b(mexico|mexican|m[eé]xico|المكسيك)\b/iu, 'MX'],
  [/\b(india|indian|الهند)\b/iu, 'IN'],
  [/\b(pakistan|باكستان)\b/iu, 'PK'],
  [/\b(iran|persian|إيران)\b/iu, 'IR'],
  [/\b(iraq|العراق)\b/iu, 'IQ'],
  [/\b(uae|emirates|الإمارات)\b/iu, 'AE'],
  [/\b(qatar|قطر)\b/iu, 'QA'],
  [/\b(russia|russian|russia\b|روسيا)\b/iu, 'RU'],
  [/\b(greece|greek|اليونان)\b/iu, 'GR'],
  [/\b(poland|polish|polska|بولندا)\b/iu, 'PL'],
  [/\b(romania|romanian|رومانيا)\b/iu, 'RO'],
  [/\b(bulgaria|bulgarian|بلغاريا)\b/iu, 'BG'],
  [/\b(hungary|hungarian|المجر)\b/iu, 'HU'],
  [/\b(serbia|serbian|صربيا)\b/iu, 'RS'],
  [/\b(croatia|croatian|كرواتيا)\b/iu, 'HR'],
  [/\b(sweden|swedish|السويد)\b/iu, 'SE'],
  [/\b(norway|norwegian|النرويج)\b/iu, 'NO'],
  [/\b(denmark|danish|الدنمارك)\b/iu, 'DK'],
  [/\b(finland|finnish|فنلندا)\b/iu, 'FI'],
  [/\b(netherlands|dutch|هولندا)\b/iu, 'NL'],
  [/\b(belgium|belgian|بلجيكا)\b/iu, 'BE'],
  [/\b(switzerland|suisse|سويسرا)\b/iu, 'CH'],
  [/\b(austria|austrian|النمسا)\b/iu, 'AT'],
  [/\b(czech|التشيك)\b/iu, 'CZ'],
  [/\b(africa|african|أفريقيا|إفريقيا)\b/iu, 'AFR'],
  [/\b(asia|asian|آسيا)\b/iu, 'ASIA'],
  [/\b(europe|european|أوروبا)\b/iu, 'EU'],
  [/\b(latam|latin|أمريكا اللاتينية)\b/iu, 'LATAM'],
];

// Operator-configurable ordering. When set (comma-separated region codes or
// category labels), the customer list is organized by that priority FIRST —
// e.g. DZ,AR,MA,TN,LY,EG,FR puts Algeria before the Arab world before France
// before everything else. Unset = keep the supplier's own order (default).
//
// Two sources of truth, in order:
//   1. Admin panel (AppSetting keys `catalog_country_priority` /
//      `catalog_category_priority`, arrays) — set from the "تنظيم القوائم"
//      page, applied live after a short cache refresh.
//   2. Env vars (CATALOG_COUNTRY_PRIORITY / CATALOG_CATEGORY_PRIORITY) —
//      fallback when the panel setting is absent.
// The cache is refreshed by refreshCatalogOrdering() (server boot, admin PUT,
// and a 60s interval started by startCatalogOrderingAutoRefresh()).

const ORDERING_REFRESH_MS = 60_000;
const orderingState = {
  country: null, // { value: string[], source: 'db' | 'env' } | null (not loaded yet)
  category: null,
  loadedAt: 0,
};

function envCountryPriority() {
  return String(process.env.CATALOG_COUNTRY_PRIORITY || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}
function envCategoryPriority() {
  return String(process.env.CATALOG_CATEGORY_PRIORITY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizePriorityList(value, upper) {
  if (!Array.isArray(value)) return [];
  const list = value
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .map((v) => (upper ? v.toUpperCase() : v));
  return [...new Set(list)];
}

async function readAppSettingValue(key) {
  try {
    const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
    const doc = await AppSetting.findOne({ key }).lean().exec();
    return doc ? doc.value : undefined;
  } catch {
    return undefined;
  }
}

/** Reload the ordering cache from AppSettings (env fallback). Async — safe to
 *  call from server boot and after an admin update. */
async function refreshCatalogOrdering() {
  try {
    const [countryDb, categoryDb] = await Promise.all([
      readAppSettingValue('catalog_country_priority'),
      readAppSettingValue('catalog_category_priority'),
    ]);
    orderingState.country = {
      value: normalizePriorityList(countryDb, true),
      source: Array.isArray(countryDb) && countryDb.length ? 'db' : 'env',
    };
    orderingState.category = {
      value: normalizePriorityList(categoryDb, false),
      source: Array.isArray(categoryDb) && categoryDb.length ? 'db' : 'env',
    };
    if (orderingState.country.source === 'env') orderingState.country.value = envCountryPriority();
    if (orderingState.category.source === 'env') orderingState.category.value = envCategoryPriority();
  } catch (error) {
    console.error('[catalog] ordering refresh failed:', error?.message);
    orderingState.country = { value: envCountryPriority(), source: 'env' };
    orderingState.category = { value: envCategoryPriority(), source: 'env' };
  }
  orderingState.loadedAt = Date.now();
}

/** Sync test hook: force the cache (bypassing the DB). null value = env fallback. */
function setCatalogOrderingOverride(country, category) {
  orderingState.country = {
    value: normalizePriorityList(country, true),
    source: country === null || country === undefined ? 'env' : 'db',
  };
  orderingState.category = {
    value: normalizePriorityList(category, false),
    source: category === null || category === undefined ? 'env' : 'db',
  };
  if (orderingState.country.source === 'env') orderingState.country.value = envCountryPriority();
  if (orderingState.category.source === 'env') orderingState.category.value = envCategoryPriority();
  orderingState.loadedAt = Date.now();
}

function clearCatalogOrderingCache() {
  orderingState.country = null;
  orderingState.category = null;
  orderingState.loadedAt = 0;
}

/** Admin-facing view of the CURRENT effective ordering (with its source). */
async function getCatalogOrdering() {
  if (!orderingState.country || Date.now() - orderingState.loadedAt > ORDERING_REFRESH_MS) {
    await refreshCatalogOrdering();
  }
  return {
    countryPriority: orderingState.country,
    categoryPriority: orderingState.category,
  };
}

function countryPriority() {
  return orderingState.country ? orderingState.country.value : envCountryPriority();
}
function categoryPriority() {
  return orderingState.category ? orderingState.category.value : envCategoryPriority();
}

let orderingRefreshTimer = null;
/** Start the periodic cache refresh (idempotent). Call once from server boot. */
function startCatalogOrderingAutoRefresh() {
  if (orderingRefreshTimer) return orderingRefreshTimer;
  void refreshCatalogOrdering();
  orderingRefreshTimer = setInterval(() => {
    void refreshCatalogOrdering();
  }, ORDERING_REFRESH_MS);
  if (orderingRefreshTimer.unref) orderingRefreshTimer.unref();
  return orderingRefreshTimer;
}

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

const CATEGORY_LABELS = CATEGORY_RULES.map(([label]) => label).concat([DEFAULT_CATEGORY]);

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
  [0x02b0, 0x02ff], // spacing modifier letters (ʰ ˢ ˡ — HEVC/SD/low markers)
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

// ── Duplicate-channel dedup (operator-controlled) ─────────────────────────
// Supplier catalogs list the SAME broadcast several times per visible group
// under package/quality tags ("BE: beIN SPRTS 1", "NM: beIN SPRTS 1",
// "8K: beIN SPRTS 1 SD", "beIN Sprts 1 ʰ"...). CATALOG_DEDUP=true (default)
// hides every copy after the first per normalized name, per visible group —
// nothing is deleted, keep-first follows the supplier's own order. Set
// CATALOG_DEDUP=false to disable.
function dedupEnabled() {
  const raw = String(process.env.CATALOG_DEDUP ?? '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'none' || raw === 'off') return false;
  return true;
}

/** Normalized identity of a channel copy: cleaned name, package/quality tags
 *  (leading "BE:" / "8K:" prefixes and trailing SD/LQ/HEVC/RAW markers)
 *  removed, case-folded. Two channels with the same key are the same
 *  broadcast at different quality/package — keep one. */
function dedupKeyForChannel(channel) {
  const raw = asText(channel?.channelName) || asText(channel?.tvgName) || '';
  if (!raw) return '';
  const key = cleanDisplayText(raw)
    .replace(/^[A-Z0-9+]{1,12}-?[A-Z0-9]{0,5}:\s*/i, '')
    .replace(/\s*(?:SD|LQ|HEVC|FHD|UHD|8K|4K|RAW)\s*$/i, '');
  return key.toLowerCase().trim();
}

/** Pure dedup decision: given all candidate channels, return the _ids to hide
 *  (every copy after the first per normalized name within a visible group).
 *  Keep-first uses the supplier's order (order asc, then _id) so the primary
 *  copy is always the one that survives. */
function selectCatalogDedup(channels) {
  const byGroup = new Map();
  for (const channel of channels) {
    const group = cleanDisplayText(channel?.channelGroup || '');
    if (!group) continue;
    const list = byGroup.get(group) || [];
    list.push(channel);
    byGroup.set(group, list);
  }
  const hidden = [];
  for (const list of byGroup.values()) {
    const sorted = [...list].sort(
      (a, b) =>
        (Number(a?.order) || 0) - (Number(b?.order) || 0) ||
        String(a?._id ?? '').localeCompare(String(b?._id ?? '')),
    );
    const seen = new Set();
    for (const channel of sorted) {
      const key = dedupKeyForChannel(channel);
      if (!key) continue;
      if (seen.has(key)) hidden.push(String(channel._id));
      else seen.add(key);
    }
  }
  return hidden;
}

/** Mongo condition hiding duplicate copies from customer-facing outputs
 *  ({} when dedup is disabled or nothing to hide). Computed over the shared
 *  catalog and cached; safe to call on every request. */
async function publicCatalogDedupQuery() {
  if (!dedupEnabled()) return {};
  try {
    const channelCache = require('../services/cache').channelCache;
    let hidden = await channelCache.get('catalog:dedup:ids');
    if (!hidden) {
      const Channel = require('../models/Channel').default || require('../models/Channel');
      const channels = await Channel.find({
        $and: [
          { ownerId: null, isActive: { $ne: false } },
          publicCatalogPresentationQuery(),
          publicCatalogHideQuery(),
        ],
      })
        .select('channelGroup channelName tvgName order')
        .lean();
      hidden = selectCatalogDedup(channels);
      await channelCache.set('catalog:dedup:ids', hidden, 600);
    }
    return hidden.length ? { _id: { $nin: hidden } } : {};
  } catch (error) {
    console.error('[catalog] dedup query failed:', error?.message);
    return {};
  }
}

function regionFromGroup(group, name = '') {
  const raw = asText(group);
  const haystack = `${raw} ${asText(name)}`;
  // 1) Bare ISO prefix (e.g. "DZ| …", "FR| …").
  const [prefix] = raw.split('|', 1);
  const code = asText(prefix).toUpperCase();
  if (REGION_LABELS[code]) {
    return { code, label: REGION_LABELS[code] };
  }
  // 2) Keyword scan of the group/name text (supplier labels like
  //    "~ ALGERIE ~", "ALG: …", "ARABIC CHANNEL").
  for (const [re, keywordCode] of REGION_KEYWORDS) {
    if (re.test(haystack)) {
      return { code: keywordCode, label: REGION_LABELS[keywordCode] };
    }
  }
  return { code: null, label: DEFAULT_COUNTRY };
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
  // Operator-configured region/category priority (CATALOG_COUNTRY_PRIORITY /
  // CATALOG_CATEGORY_PRIORITY): when set, organize by that order FIRST — e.g.
  // Algeria → Arab world → France → rest — then fall back to the supplier's
  // curated group/order/name. Unset = pure supplier order (default behavior).
  const lCountry = presentationForChannel(left).countryCode;
  const rCountry = presentationForChannel(right).countryCode;
  const countryOrder = countryPriority();
  if (countryOrder.length > 0) {
    const li = countryOrder.indexOf(lCountry);
    const ri = countryOrder.indexOf(rCountry);
    if (li !== ri) {
      // Unknown/other regions go after all prioritized ones (keep stable).
      const lRank = li === -1 ? countryOrder.length : li;
      const rRank = ri === -1 ? countryOrder.length : ri;
      if (lRank !== rRank) return lRank - rRank;
    }
  }
  const lCategory = presentationForChannel(left).category;
  const rCategory = presentationForChannel(right).category;
  const catOrder = categoryPriority();
  if (catOrder.length > 0 && lCategory !== rCategory) {
    const li = catOrder.indexOf(lCategory);
    const ri = catOrder.indexOf(rCategory);
    const lRank = li === -1 ? catOrder.length : li;
    const rRank = ri === -1 ? catOrder.length : ri;
    if (lRank !== rRank) return lRank - rRank;
  }
  // Restore the supplier's intended ordering (group, then per-group order,
  // then name) — the operator's curated channel structure must stay visible.
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
  publicCatalogDedupQuery,
  dedupKeyForChannel,
  selectCatalogDedup,
  isHiddenGroup,
  presentationForChannel,
  presentChannelForClient,
  safeClientMetadata,
  safeClientAlternates,
  sortClientCatalogChannels,
  cleanDisplayText,
  cleanVodTitle,
  refreshCatalogOrdering,
  setCatalogOrderingOverride,
  clearCatalogOrderingCache,
  getCatalogOrdering,
  startCatalogOrderingAutoRefresh,
  REGION_LABELS,
  CATEGORY_LABELS,
};
