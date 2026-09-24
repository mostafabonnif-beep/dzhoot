import mongoose from 'mongoose';
import Channel from '../models/Channel';

/**
 * Catalog taxonomy — turns 379 raw source group names ("RADIO MIX",
 * "AFRICA VIP HD", "GENERAL HD", …) into a small browsing tree tauss
 * approved on 2026-09-24 (8 sections + fallback). Approved live in chat:
 * "اكمل" after the proposal.
 *
 * Safety rails:
 *  - Only rewrites shared, active, xtream-imported channels (channelId
 *    prefix "xt:"). iptv-org (m3u, periodically re-synced) keeps its own
 *    curated groups so the sync never fights the taxonomy.
 *  - Original group is preserved once in metadata.originalGroup; recovery
 *    is copying it back.
 *  - Pure mapping function — unit-tested.
 */

export const TAXONOMY_CATEGORIES = [
  'رياضة',
  'أفلام',
  'مسلسلات',
  'أطفال',
  'إخبارية',
  'مباشر عربي',
  'فرنسي',
  'راديو',
  'متنوع',
] as const;

export type TaxonomyCategory = (typeof TAXONOMY_CATEGORIES)[number];

// Order matters: first match wins. Sport before French (CANAL+ SPORT),
// radio before everything (RADIO MIX), kids before series (cartoon drama).
const RULES: { category: TaxonomyCategory; re: RegExp }[] = [
  { category: 'راديو', re: /RADIO|FM\b|WEBAUDIO/i },
  {
    category: 'رياضة',
    re: /SPORT|FOOT|BEIN|ESPN|SSC|ARENA|DAZN|EOS|GOLF|TENNIS|NBA|NFL|WWE|UFC|FIGHT|RACING|MOTOR|F1\b|CYCLING|BASKET|HAND|VOLLEY|LIGA|SERIE A|BUNDES|PREMIER|CALCIO|PUCK|HOCKEY|DOLLY|TOD|ARENA/i,
  },
  { category: 'أطفال', re: /KID|CARTOON|ANIME|JUNIOR|NICKELODEON|NICK\b|DISNEY|BOOMERANG|SPROUT|BABY|JEUNESSE/i },
  { category: 'إخبارية', re: /NEWS|INFO|BBC|CNN|FRANCE.?24|AL ?JAZ|SKY NEWS|MSNBC|EURONEWS|TRT.?WORLD|DW\b|EUTEL/i },
  { category: 'أفلام', re: /CINEMA|CINE\b|MOVIE|FILM|VOD|NETFLIX|HBO|OSN.?MOV|PARAMOUNT|ACTION\b|THRILLER|HORROR|WESTERN/i },
  { category: 'مسلسلات', re: /SERIE|DRAMA|NOVELA|SHAHID|TURK|SOAP|REALITY|LIFETIME|HALLMARK/i },
  {
    category: 'مباشر عربي',
    re: /ARAB|MBC|LBC|FUTURE|OTV|ALGER|TUNIS|MAROC|MAGHR|EGYPT|SAUDI|IRAQ|SYRIA|KURD|ROTANA|ART\b|DUBAI|ABU ?DHABI|QATAR|KUWAIT|BAHRAIN|OMAN|YEMEN|JORDAN|PALEST|LEBANON|LIBYA|SUDAN|MAURIT|NILE|SAT\.?7|SHAM|ORBIT|NAHAR|ON ?E|DREAM|MEHWAR|CBC\b|DMC|AL ?HAYAT|TAHRIR|SKY NEWS ARABIA|SHARJAH|AJMAN|RASD|ZAYTOUNA|HANNIBAL|ATTASSIAA|EL ?HIWAR|NESSMA|CARTHAGE|WATANIA|CANAL ALGERIE|TOKEN|TAMAZIGHT|CHAINE|CHOUROUK|ECHOROUK|ENNAHAR|ECHIBEK|SAMIRA|ZITOUNA|AL ?MADINA|SAUDI|SUNNAH|AQSA|IQRAA|RESALAH|MAJDTOOL|ZAD|TILAWA|MIX ?ARAB|RAMADAN/i,
  },
  {
    category: 'فرنسي',
    re: /\bFR\b|FRANCE|CANAL\+|CANAL ?\d|CANALPLUS|TF1|FR2|FR3|FR4|FR5|M6\b|W9|TMC|C8\b|CSTAR|GULLI|GAME ?ONE|TELETOON\+?FR|NICKELODEON\+?FR|COMEDIE\+|OCS\b|CINE\+|PLANETE|NATIONAL GEO|USHUAIA|RYM|BE ?1|13EME|RUE|TV5|EURO|TOUTE|C+ |GOLF\+|INFOS\+|POLITIQUE/i,
  },
];

/** Pure — unit-tested. */
export function mapGroupToCategory(groupName: string): TaxonomyCategory {
  const g = (groupName || '').trim();
  if (!g) return 'متنوع';
  for (const { category, re } of RULES) {
    if (re.test(g)) return category;
  }
  return 'متنوع';
}

export interface TaxonomyResult {
  scanned: number;
  updated: number;
  perCategory: Record<string, number>;
}

export async function applyTaxonomy(dryRun = false): Promise<TaxonomyResult> {
  const docs = await Channel.find(
    { ownerId: null, isActive: true, channelId: { $regex: '^xt:' } },
    { channelGroup: 1, 'metadata.originalGroup': 1 },
  ).lean();

  const perCategory: Record<string, number> = {};
  const updates: {
    _id: mongoose.Types.ObjectId;
    category: TaxonomyCategory;
    rawGroup: string;
    hasOriginal: boolean;
  }[] = [];
  for (const d of docs) {
    // A channel already normalized keeps its category even if the raw group
    // moved on (idempotency across runs).
    const current = (d as any).metadata?.category as TaxonomyCategory | undefined;
    const category =
      current && TAXONOMY_CATEGORIES.includes(current)
        ? current
        : mapGroupToCategory(d.channelGroup || '');
    perCategory[category] = (perCategory[category] || 0) + 1;
    if (!current || current !== category) {
      updates.push({
        _id: d._id,
        category,
        rawGroup: d.channelGroup || '',
        hasOriginal: Boolean((d as any).metadata?.originalGroup),
      });
    }
  }

  const result: TaxonomyResult = {
    scanned: docs.length,
    updated: dryRun ? updates.length : 0,
    perCategory,
  };
  if (dryRun) return result;

  for (const { _id, category, rawGroup, hasOriginal } of updates) {
    await Channel.updateOne(
      { _id, ownerId: null },
      {
        $set: {
          // Visible change: the app browses channelGroup directly.
          channelGroup: category,
          'metadata.category': category,
          'metadata.taxonomyAt': new Date(),
        },
      },
    );
    // Preserve the raw source group once — recovery is copying it back.
    if (!hasOriginal && rawGroup) {
      await Channel.updateOne(
        { _id },
        { $set: { 'metadata.originalGroup': rawGroup } },
      );
    }
  }
  result.updated = updates.length;
  return result;
}
