'use strict';

// Customer-facing catalog presentation must be independent of upstream naming.
// This module never mutates source metadata in MongoDB; source/rights records stay
// available to authorized operators while client payloads receive only neutral data.

const HASH_MARKER = /#{3,}/u;
const UPSTREAM_NAME_MARKER = /(?:^|[\s|_-])neo(?:[\s|_-]|$)/iu;
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
  return {
    ...safeChannel,
    channelName: asText(source?.channelName),
    tvgName: asText(source?.tvgName) || asText(source?.channelName),
    channelGroup: presentation.group,
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
  const leftPresentation = presentationForChannel(left);
  const rightPresentation = presentationForChannel(right);
  return (
    leftPresentation.country.localeCompare(rightPresentation.country, 'ar') ||
    leftPresentation.category.localeCompare(rightPresentation.category, 'ar') ||
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
  presentationForChannel,
  presentChannelForClient,
  safeClientMetadata,
  safeClientAlternates,
  sortClientCatalogChannels,
};
