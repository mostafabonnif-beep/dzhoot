/**
 * Sports-matches detection for the "مباريات اليوم" (today's matches) feature.
 *
 * Pure logic only — no DB access, so it is cheap to unit-test. The route layer
 * owns the EpgProgram query (time window + channel scope); this module decides
 * whether a program looks like a live sports event and shapes the response.
 */

export interface SportsMatchProgram {
  channelEpgId: string;
  title: string;
  description?: string | null;
  category?: string[] | null;
  startTime: Date | string | number;
  endTime: Date | string | number;
  language?: string | null;
  icon?: string | null;
}

export interface SportsMatch {
  channelEpgId: string;
  startTime: string;
  endTime: string;
  status: 'live' | 'upcoming';
  title: string;
  description: string;
  category: string[];
  language: string | null;
}

interface BuildOptions {
  /** Current epoch ms — "live" vs "upcoming" is decided against this. */
  nowMs?: number;
  /** Maximum number of matches to return. */
  limit?: number;
}

/** Arabic keywords that strongly indicate a live sports event. */
const ARABIC_SPORTS_KEYWORDS = [
  'مباراة',
  'مباريات',
  'كأس',
  'كاس',
  'دوري',
  'دورى',
  'نهائي',
  'نهائى',
  'تصفيات',
  'ودية',
  'الجولة',
  'لقاء',
  'البطولة',
  'ديربي',
  'كلاسيكو',
  'ذهاب',
  'إياب',
  'اياب',
  'ركلات الترجيح',
  'ربع النهائي',
  'نصف النهائي',
  'المونديال',
  'الأولمبياد',
  'أولمبياد',
  'دور المجموعات',
] as const;

/** Latin / French phrases that strongly indicate a sports event. */
const LATIN_SPORTS_PHRASES = [
  'champions league',
  'europa league',
  'premier league',
  'la liga',
  'laliga',
  'serie a',
  'bundesliga',
  'ligue 1',
  'world cup',
  'super bowl',
  'grand prix',
  'formula 1',
  'semi-final',
  'quarter-final',
  'semi final',
  'quarter final',
  'round of 16',
  'play-offs',
  'playoffs',
  'matchday',
  'afcon',
] as const;

/** Single Latin words that indicate a sports event (word-boundary match). */
const LATIN_SPORTS_WORDS = [
  'football',
  'soccer',
  'derby',
  'final',
  'cup',
  'league',
  'championship',
  'qualifier',
  'friendly',
  'tennis',
  'basketball',
  'handball',
  'volleyball',
  'motogp',
  'boxing',
  'mma',
  'ufc',
  'wrestling',
  'rugby',
  'cricket',
  'golf',
  'olympic',
  'olympics',
  'nba',
  'nhl',
  'nfl',
] as const;

/** Category tokens that mark a program as sports regardless of its title. */
const SPORTS_CATEGORY_HINTS = [
  'sport',
  'sports',
  'sportif',
  'sportive',
  'football',
  'soccer',
  'futbol',
  'fútbol',
  'tennis',
  'basketball',
  'handball',
  'volleyball',
  'boxing',
  'mma',
  'motorsport',
  'cycling',
  'athletics',
  'golf',
  'rugby',
  'cricket',
  'hockey',
  'esport',
  'e-sport',
  'olympic',
  'olympics',
] as const;

const LOWERCASE_ARABIC = ARABIC_SPORTS_KEYWORDS.map((k) => k.toLowerCase());

/**
 * Single-source regex alternations so the route can push a coarse sports
 * pre-filter into the MongoDB query (before the scan limit is applied) while
 * the pure JS logic above stays the final authority. Sharing the constants
 * here keeps DB pre-filter and JS filter from drifting apart.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\const LOWERCASE_ARABIC = ARABIC_SPORTS_KEYWORDS.map((k) => k.toLowerCase());');
}

export const SPORTS_TITLE_REGEX_SOURCE = ((): string => {
  const arabic = LOWERCASE_ARABIC.map(escapeRegExp).join('|');
  const phrases = LATIN_SPORTS_PHRASES.map(escapeRegExp).join('|');
  const words = LATIN_SPORTS_WORDS.map((w) => `\\b${escapeRegExp(w)}\\b`).join('|');
  // Loose DB-side "team vs team" (PCRE2 rejects the \uXXXX escapes the precise
  // JS detector uses, and the coarse filter must be a SUPERSET of the JS rule).
  const teamVsTeam = '\\S+\\s+vs\\.?\\s+\\S+';
  return `(?:${arabic}|${phrases}|${words}|${teamVsTeam})`;
})();

export const SPORTS_CATEGORY_REGEX_SOURCE = SPORTS_CATEGORY_HINTS.map(escapeRegExp).join('|');

/** Coarse DB pre-filter predicate mirror — exported for tests. */
export function sportsTitleRegex(): RegExp {
  return new RegExp(SPORTS_TITLE_REGEX_SOURCE, 'i');
}

export function sportsCategoryRegex(): RegExp {
  return new RegExp(SPORTS_CATEGORY_REGEX_SOURCE, 'i');
}

function titleHasArabicKeyword(title: string): boolean {
  return LOWERCASE_ARABIC.some((keyword) => title.includes(keyword));
}

function titleHasLatinKeyword(title: string): boolean {
  const lower = title.toLowerCase();
  if (LATIN_SPORTS_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  if (LATIN_SPORTS_WORDS.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(lower))) return true;
  // "Team A vs Team B" style titles (the word "vs" alone is too noisy).
  return /\b[A-Za-z0-9\u00C0-\u024F .'-]+\s+vs\.?\s+[A-Za-z0-9\u00C0-\u024F .'-]+\b/i.test(title);
}

function titleIsSports(title: string): boolean {
  const trimmed = String(title || '').trim();
  if (!trimmed) return false;
  return titleHasArabicKeyword(trimmed) || titleHasLatinKeyword(trimmed);
}

function categoryIsSports(category: string[] | null | undefined): boolean {
  if (!Array.isArray(category)) return false;
  return category.some((raw) => {
    const token = String(raw || '').trim().toLowerCase();
    if (!token) return false;
    return SPORTS_CATEGORY_HINTS.some((hint) => token === hint || token.includes(hint));
  });
}

export function isLikelySportsProgram(program: SportsMatchProgram): boolean {
  if (categoryIsSports(program.category)) return true;
  return titleIsSports(program.title);
}

function toEpochMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Filters and shapes EPG programs into today's sports matches.
 *
 * Rules:
 * - Only programs still on air or starting later are kept (ended ones drop).
 * - Only sports-looking programs are kept (category hint OR sports keywords).
 * - Results are sorted by start time (soonest first), deduplicated per
 *   channel + start, and capped at `limit`.
 */
export function buildSportsMatches(
  programs: SportsMatchProgram[],
  options: BuildOptions = {},
): SportsMatch[] {
  const nowMs = options.nowMs ?? Date.now();
  const limit = options.limit ?? 100;

  const seen = new Set<string>();
  const matches: SportsMatch[] = [];

  const sorted = [...programs].sort((a, b) => toEpochMs(a.startTime) - toEpochMs(b.startTime));
  for (const program of sorted) {
    if (matches.length >= limit) break;
    const startMs = toEpochMs(program.startTime);
    const endMs = toEpochMs(program.endTime);
    if (!startMs || !endMs) continue;
    // Ended already, or not started yet and start is in the past is handled by
    // status below — skip anything that finished before "now".
    if (endMs <= nowMs) continue;
    if (!isLikelySportsProgram(program)) continue;

    const dedupeKey = `${String(program.channelEpgId).toLowerCase()}|${startMs}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const status: 'live' | 'upcoming' = startMs <= nowMs ? 'live' : 'upcoming';
    matches.push({
      channelEpgId: program.channelEpgId,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      status,
      title: String(program.title || '').trim(),
      description: String(program.description || '').trim().slice(0, 500),
      category: Array.isArray(program.category) ? program.category.slice(0, 5) : [],
      language: program.language || null,
    });
  }
  return matches;
}
