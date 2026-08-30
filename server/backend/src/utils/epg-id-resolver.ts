import { cleanDisplayChannelName } from './catalog-name-cleaner';

/**
 * EPG tvg-id resolution for catalog channels.
 *
 * Extracted from migration 0013 so the family-matching logic is unit-testable
 * and can be reused (e.g. future re-runs of the backfill or a periodic
 * matcher). Policy:
 *   - Only ever returns an id that ACTUALLY exists in the fetched guides.
 *   - Exact normalized-name matches only (no fuzzy/wrong links).
 *   - If a channel name carries a number (e.g. "BEIN SPORTS 5") it maps to
 *     THAT channel's guide id — it NEVER silently falls back to channel 1
 *     when the guide lacks that number (this was a live bug: "beIN SP⚽RTS 5"
 *     resolved to beIN_SPORTS1 because the raw name still contained the ball
 *     emoji, so the digit capture failed and the code defaulted to 1).
 */

/** Strip quality/mode tokens so 'CARTOON NETWORK HD' ≡ 'cartoon network'. */
const QUALITY_TOKENS = /\b(hd|hdtv|fhd|uhd|4k|8k|sd|hevc|h265|x265|h264|avc|raw|60fps|full|lq|hq)\b/g;

/**
 * Some providers spell "SPORTS" with a ball emoji in place of the O
 * ("SP⚽RTS"). Fix the raw token before cleaning so the digit capture and
 * canonical matching actually see "SPORTS".
 */
const BALL_EMOJI_SPORTS = /SP\s*[⚽🏀🏈🎾⚾🥅]\s*RTS/giu;

/** Canonical, comparison-safe form of a catalog channel name. */
export function canonicalKey(value: string): string {
  const raw = String(value ?? '');
  return cleanDisplayChannelName(raw.replace(BALL_EMOJI_SPORTS, 'SPORTS'))
    .toLowerCase()
    .replace(QUALITY_TOKENS, ' ')
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Derive a canonical name from an EPG id: 'AL.JAZEERA.ARABIC.tr' → 'al jazeera arabic'.
 *
 * The trailing token is stripped when it looks like a country/brand suffix:
 *   - any ISO-style 2-letter code (`.tr`, `.eg`, `.qa`, `.il`, …) — a fixed
 *     allowlist previously missed guides like epgshare01's `.eg`/`.il`/`.pk`
 *     files, so their ids never matched ("MBC.MASR.2.eg" → 'mbc masr 2 eg');
 *   - the legacy multi-letter brand TLDs (`.bein`, `.com`) that guides append.
 */
export function epgIdName(id: string): string {
  const s = id
    .toLowerCase()
    .replace(/\.(bein|com)$/i, '')
    .replace(/\.[a-z]{2}$/i, '');
  return s.replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface EpgIdResolverInput {
  channelName: string;
  /** Lowercased guide ids that actually exist (EpgProgram.channelEpgId). */
  availableIds: Set<string>;
  /** Lowercase guide id → original-case id (to write the canonical form). */
  byLower: Map<string, string>;
  /** Canonical epg-id-derived name → preferred guide id (generic matching). */
  nameToId: Map<string, string>;
}

export interface EpgIdResolution {
  tvgId: string;
  via: string;
}

/**
 * Extract the beIN channel number from a catalog name, using the same
 * decoration handling as the resolver ("8K: beIN SP⚽RTS 5 ᴴᴰ" → "5",
 * "BEIN SPORT TOD 5" → "5"). Returns null when no number is present.
 */
export function extractBeinNumber(name: string): string | null {
  const clean = cleanDisplayChannelName(String(name || '').replace(BALL_EMOJI_SPORTS, 'SPORTS')).toUpperCase();
  const m = clean.match(/BEIN[^0-9]{0,40}?(\d{1,2})(?![0-9])/);
  return m ? m[1] : null;
}


/**
 * True when a beIN-branded name looks like a SPORTS feed (contains "SPORT"
 * or is a bare "BEIN n"). Non-sports beIN brands (CINEMA/FILM/ACTION/…) must
 * never map to the Sports guide ids.
 */
export function isBeinSportsFeed(name: string): boolean {
  const clean = cleanDisplayChannelName(String(name || '').replace(BALL_EMOJI_SPORTS, 'SPORTS')).toUpperCase();
  return (
    /SPORT/.test(clean) ||
    !/CINEMA|FILM|MOVIES|ACTION|DOCUMENTARY|SERIES|\bOD\b|ARABIC|FRENCH|ENGLISH|KIDS|\bPLUS\b|24\s*\/?\s*7/.test(clean)
  );
}

function lookup(byLower: Map<string, string>, ...candidates: string[]): string | null {
  for (const c of candidates) {
    const hit = byLower.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

export function resolveEpgIdForChannel(input: EpgIdResolverInput): EpgIdResolution | null {
  const { channelName, availableIds, byLower, nameToId } = input;
  const name = String(channelName || '');
  if (!name.trim()) return null;

  // Family matching operates on the CLEANED name: "8K: beIN SP⚽RTS 5 ᴴᴰ" →
  // "8K BEIN SPORTS 5 HD" so the digit capture actually sees the 5.
  const clean = cleanDisplayChannelName(name.replace(BALL_EMOJI_SPORTS, 'SPORTS')).toUpperCase();

  // ─── beIN family ───────────────────────────────────────────────
  if (/BEIN/.test(clean)) {
    if (/\bMAX\b/.test(clean)) return null; // guide has no MAX feeds
    // Only beIN *SPORTS* feeds map to the beIN SPORTS guide ids. beIN's other
    // brands (CINEMA/FILM/ACTION/DOCUMENTARY/OD/ARABIC/FRENCH/…) must NOT be
    // stamped with a Sports schedule — a channel named "BEIN CINEMA COMEDY 2"
    // is not beIN Sports 2.
    if (!isBeinSportsFeed(name)) return null;
    const beinMatch = extractBeinNumber(name);
    if (beinMatch) {
      // A number is present: map to THAT channel only. Never fall back to 1 —
      // if the guide lacks this beIN number the channel stays unmatched.
      const n = beinMatch;
      const ar = byLower.get(`bein_sports${n}_digital_mono_ar.bein`);
      const tr = byLower.get(`beinsp${n}.tr`);
      if (ar) return { tvgId: ar, via: 'bein-ar' };
      if (tr) return { tvgId: tr, via: 'bein-tr' };
      return null;
    }
    // Unnumbered generic beIN: only the guide's beIN 1 ids are safe defaults.
    const g = lookup(byLower, 'bein_sports1_digital_mono_ar.bein', 'beinsp1.tr', 'beinsports.tr');
    return g ? { tvgId: g, via: 'bein-tr' } : null;
  }

  // ─── Alkass family ─────────────────────────────────────────────
  if (/ALKASS/.test(clean)) {
    const m = clean.match(/ALKASS\s*(\d{1,2})/);
    const n = m ? m[1] : '1';
    const ar = byLower.get(`alkass_${n}_ar.bein`);
    const en = byLower.get(`alkass_${n}_en.bein`);
    if (ar) return { tvgId: ar, via: 'alkass-ar' };
    if (en) return { tvgId: en, via: 'alkass-en' };
    return null;
  }

  // ─── Al Jazeera ────────────────────────────────────────────────
  if (/AL\s*JAZEERA/.test(clean)) {
    const ar = byLower.get('al.jazeera.arabic.tr');
    const en = byLower.get('al.jazeera.international.tr');
    if (/ARABIC/.test(clean) && ar) return { tvgId: ar, via: 'jazeera-ar' };
    if (/INTERNATIONAL|INTL|EN\b/.test(clean) && en) return { tvgId: en, via: 'jazeera-en' };
    if (ar) return { tvgId: ar, via: 'jazeera-ar' };
    return null;
  }

  // ─── Generic exact match (cartoon, disney, cnn, tf1…) ──────────
  const canon = canonicalKey(name);
  if (canon && nameToId.has(canon)) {
    const id = nameToId.get(canon)!;
    if (availableIds.has(id.toLowerCase())) return { tvgId: id, via: 'generic' };
  }

  return null;
}
