import axios from 'axios';
import mongoose from 'mongoose';
import XtreamSource from '../models/XtreamSource';
import ChannelFailoverMap from '../models/ChannelFailoverMap';
import Channel from '../models/Channel';
import { decryptSecret } from '../utils/crypto';
import { testXtreamConnection, buildXtreamApiUrl } from './xtream-service';
import { sendOperationalAlert } from './alert-notifier';
import { normalizeChannelName } from './channel-identity-service';

/**
 * Source auto-failover (بطاقة «مصدر احتياطي تلقائي»):
 *
 * The catalog lives on a primary Xtream source (Primary Upstream). When that
 * source goes down, EVERY channel dies because they all share it. This service
 * adds a watchdog that light-probes the active sources, and a side map
 * (ChannelFailoverMap) that lets the playback-token flow re-point a channel to
 * a verified backup source (ottstreambox) within seconds — no app update.
 *
 * Rules (from the feasibility report):
 *  - Catch-up NEVER fails over (the backup has no catch-up).
 *  - Only channels WITH a mapping switch; unmapped channels stay on Upstream.
 *  - Sessions in flight are untouched; only NEW playback-token requests switch
 *    (that is what makes the return to Upstream gradual — no flapping).
 *  - The watchdog probes the API every 60s and a live stream at most every 5min.
 */

export type SourceHealth = 'verified' | 'degraded' | 'blocked' | 'unknown';

interface HealthCacheEntry {
  health: SourceHealth;
  checkedAt: number;
}

// 20s: failover decisions (token issue + mid-stream reconnect) must reflect a
// source outage almost immediately; probes re-verify on their own cadence.
const HEALTH_CACHE_TTL_MS = 20 * 1000;

const healthCache = new Map<string, HealthCacheEntry>();
const lastAlertedHealth = new Map<string, SourceHealth>();
// Recovery hysteresis: a source must pass TWO consecutive verified probes before
// it is allowed back from degraded/blocked — one flaky probe must not flap the
// whole catalog between primary and backup.
const consecutiveVerified = new Map<string, number>();

/** Build the HLS live URL for a stream on a given Xtream source. */
export function buildFailoverStreamUrl(
  creds: { serverUrl: string; username: string; password: string },
  streamId: string | number,
): string {
  return `${creds.serverUrl.replace(/\/+$/, '')}/live/${creds.username}/${creds.password}/${streamId}.m3u8`;
}

function mapDbStatusToHealth(status: string | undefined | null): SourceHealth {
  if (status === 'verified') return 'verified';
  if (status === 'degraded') return 'degraded';
  if (status === 'blocked') return 'blocked';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Channel-name matching helpers (auto-match)
//
// Maghreb panels name channels very differently from the catalog
// ('Dz|ENTV 1 FULL HD ✦' vs 'AR: Algerie EN TV 1', 'Echorouk' vs 'Echourouk').
// Two layers: a curated canonical-key dictionary for the important Arabic/
// Algerian channels, and a typo-tolerant token-Jaccard fallback for the rest.
// ---------------------------------------------------------------------------

/** NFKC-decorated, lowercased, junk-token-stripped channel name. */
export function cleanChannelName(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tokens that say nothing about identity: source prefixes, quality, formats.
const JUNK_TOKENS = new Set([
  'dz', 'alg', 'algerie', 'algeria', 'ar', 'fr', 'hd', 'hdtv', 'fhd', 'uhd', '4k', '8k',
  'sd', 'lq', 'hq', 'raw', 'full', '720', '720p', '1080', '1080p', '2160', '2160p',
  'h265', 'hevc', 'x265', 'h264', 'avc', 'web', 'ts', 'm3u8', 'mpegts', '6h', '+6h',
  'tv', 'ch', 'channel', 'chaîne', 'canal', 'قناة', 'بث', 'تدفق',
]);

export function tokenize(cleaned: string): string[] {
  return cleaned.split(' ').filter((t) => t.length >= 3 && !JUNK_TOKENS.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Do two tokens count as the same identity token? (typo-tolerant) */
function tokensMatch(t1: string, t2: string): boolean {
  if (t1 === t2) return true;
  if (t1.length >= 5 && t2.length >= 5) {
    if (levenshtein(t1, t2) <= 1) return true; // echorouk ~ echourouk
    if (t1.startsWith(t2) || t2.startsWith(t1)) return true; // entv1 ~ entv
  }
  return false;
}

/** Jaccard over token sets with typo-tolerant per-token matching. */
export function nameMatchScore(aCleaned: string, bCleaned: string): number {
  const ta = tokenize(aCleaned);
  const tb = tokenize(bCleaned);
  if (ta.length === 0 || tb.length === 0) return 0;
  const used = new Set<number>();
  let inter = 0;
  for (const t of ta) {
    for (let i = 0; i < tb.length; i++) {
      if (used.has(i)) continue;
      if (tokensMatch(t, tb[i])) {
        inter += 1;
        used.add(i);
        break;
      }
    }
  }
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : inter / union;
}

const FUZZY_MATCH_THRESHOLD = 0.6;

// Catalog channels prefixed with a foreign country code (FI:, SE:, UK:, BR:,
// FR:, …) are never Maghreb/Arabic channels — the backup panel is a Maghreb
// catalog, so matching them would produce wrong failover targets (e.g. the
// Finnish 'Yle TV1' matching 'ENTV 1').
const FOREIGN_CATALOG_PREFIX = /^(fi|se|uk|br|fr|us|de|it|es|pt|ru|tr|gr|nl|pl|dk|no|cz|hu|ro|bg|rs|hr|sk|at|ch|ie|cn|jp|kr|in|pk|th|vn|id|mx)\b/;

function isForeignCatalogChannel(name: string): boolean {
  return FOREIGN_CATALOG_PREFIX.test(cleanChannelName(name));
}

/** Accept a fuzzy match: strong multi-token overlap, or a single significant
 *  token that is an identity match after typo tolerance. */
function fuzzyAccepted(aCleaned: string, bCleaned: string): boolean {
  const ta = tokenize(aCleaned);
  const tb = tokenize(bCleaned);
  if (ta.length === 0 || tb.length === 0) return false;
  if (nameMatchScore(aCleaned, bCleaned) >= FUZZY_MATCH_THRESHOLD) return true;
  if (ta.length === 1 && tb.length === 1 && tokensMatch(ta[0], tb[0])) return true;
  return false;
}

/**
 * Curated canonical key for important Arabic/Algerian channels — both the
 * catalog and the backup get mapped to the same key, which defeats the
 * 'Dz|ENTV 1 FULL HD' vs 'AR: Algerie EN TV 1' naming gap.
 */
export function channelCanonicalKey(name: string): string | null {
  const n = cleanChannelName(name);
  if (!n) return null;
  const has = (re: RegExp) => re.test(n);
  if (has(/entv\s*1|en\s*tv\s*1|algerie\s*(premiere|première|1(ere|ère)?)\b|programe? national|tv1\b|a1\b/)) return 'entv1';
  if (has(/canal\s*algerie|algerie\s*2\b|algerie\s*deux/)) return 'canal-algerie';
  if (has(/algerie\s*3\b|a3\b|algerie\s*trois/)) return 'algerie-3';
  if (has(/tamazight|algerie\s*4\b|tv\s*4\b/)) return 'tamazight';
  if (has(/coran|quran|algerie\s*5\b/)) return 'quran-algerie';
  if (has(/algerie\s*6\b|tv\s*6\b/)) return 'algerie-6';
  if (has(/el\s*maarifa|maarifa|algerie\s*7\b/)) return 'el-maarifa';
  if (has(/edhakira|algerie\s*8\b/)) return 'edhakira';
  if (has(/echourouk\s*news|echorouk\s*news/)) return 'echourouk-news';
  if (has(/ech.*rouk/)) return 'echourouk';
  if (has(/ennahar|ennahaar/)) return 'ennahar';
  if (has(/el\s*bilad|elbilad/)) return 'el-bilad';
  if (has(/djazairia|djazairia/)) return 'el-djazairia';
  if (has(/al\s*24\b|al24/)) return 'al24';
  if (has(/heddaf/)) return 'el-heddaf';
  if (has(/el?\s*hayat/)) return 'el-hayat';
  if (has(/watania/)) return 'el-watania';
  if (has(/bahia/)) return 'el-bahia';
  if (has(/be\s*in\s*sports?|beinsports?/)) return 'beinsports';
  if (has(/be\s*in\s*movies?/)) return 'bein-movies';
  if (has(/be\s*in\b/)) return 'bein';
  // Big Arabic families (Egyptian, Gulf, pan-Arab) — the +6H / package tags
  // ('SSC 1 FHD', 'mbc1 4K', 'OSN Movies HD') differ per supplier, so map the
  // family, not the exact variant.
  if (has(/mbc\s*[1-4]\b/)) {
    const m = n.match(/mbc\s*([1-4])\b/);
    return m ? `mbc-${m[1]}` : 'mbc';
  }
  if (has(/mbc\s*(action|drama|max|masr|masr\s*2|bollywood|iraq|africa|the\s*first)/)) return 'mbc-extra';
  if (has(/ssc\s*[1-5]\b/)) return 'ssc-sports';
  if (has(/rotana/)) return 'rotana';
  if (has(/dubai\s*(one|tv|sports)?|dubai\b/)) return 'dubai';
  if (has(/abu\s*dhabi|adtv/)) return 'abu-dhabi';
  if (has(/al\s*jazeera|الجزيرة/)) return 'aljazeera';
  if (has(/al\s*arabiya|العربية/)) return 'alarabiya';
  if (has(/al\s*oula|saudi\s*(tv\s*)?1\b|السعودية\s*الأولى|sbc\b/)) return 'al-oula';
  if (has(/al\s*iraqiya|العراقية/)) return 'al-iraqiya';
  if (has(/al\s*sharqiya|الشرقية/)) return 'al-sharqiya';
  if (has(/on\s*time\s*sports|ontv|on\s*tv\s*sport/)) return 'on-time-sports';
  if (has(/(^|\s)dmc(\s|$)/)) return 'dmc';
  if (has(/osn\s*(movies|series|sports|ya\s*hala)?/)) return 'osn';
  if (has(/el\s*fadjr|elfadjr|elfajr/)) return 'el-fadjr';
  return null;
}

/** Lower = better variant to map (base/HD over +6H/LQ/RAW/SD clones). */
export function channelVariantRank(name: string): number {
  const n = cleanChannelName(name);
  if (/\+?\s*6h|6\s*heures/.test(n)) return 100;
  if (/\blq\b/.test(n)) return 90;
  if (/\braw\b/.test(n)) return 80;
  if (/\bsd\b/.test(n)) return 70;
  if (/\bhd\b|\bfhd\b|\buhd\b|\b4k\b/.test(n)) return 10;
  return 50;
}

/** Cached health of a source (falls back to the persisted verificationStatus). */
export async function getSourceHealth(sourceId: string): Promise<SourceHealth> {
  const key = String(sourceId);
  const cached = healthCache.get(key);
  if (cached && Date.now() - cached.checkedAt < HEALTH_CACHE_TTL_MS) {
    return cached.health;
  }
  const source = await XtreamSource.findById(sourceId).select('verificationStatus').lean().exec();
  const health = mapDbStatusToHealth(source?.verificationStatus);
  healthCache.set(key, { health, checkedAt: Date.now() });
  return health;
}

/** True only when the source is explicitly DOWN (degraded or blocked). */
export async function isSourceDown(sourceId: string): Promise<boolean> {
  const health = await getSourceHealth(sourceId);
  return health === 'degraded' || health === 'blocked';
}

/**
 * Resolve a failover target for a channel, or null.
 * Returns the backup stream URL + the backup source (for the direct flag).
 */
export async function getFailoverTarget(
  channel: { _id: mongoose.Types.ObjectId | string; channelId?: string; metadata?: any },
  primarySourceId?: string | mongoose.Types.ObjectId | null,
): Promise<{ streamUrl: string; source: any } | null> {
  const mapFilter: Record<string, unknown> = { enabled: true };
  const orClauses: Record<string, unknown>[] = [];
  if (channel.channelId) orClauses.push({ channelRef: String(channel.channelId) });
  if (channel._id) orClauses.push({ channelId: channel._id });
  if (orClauses.length === 0) return null;
  mapFilter.$or = orClauses;
  if (primarySourceId) mapFilter.backupSourceId = { $ne: primarySourceId };

  // Multi-tier cascade: a channel can map to several backup sources, each with
  // a priority (lower = tried first, e.g. NEO 4K=10 then MIBOX=20). Iterate in
  // priority order and return the first backup that is eligible AND healthy —
  // if the top tier is down we fall through to the next instead of giving up.
  const maps = await ChannelFailoverMap.aggregate([
    { $match: mapFilter },
    // Old maps may lack the field; treat them as the default tier (100).
    { $addFields: { _priority: { $ifNull: ['$priority', 100] } } },
    { $sort: { _priority: 1, updatedAt: -1 } },
  ]).exec();
  if (!maps || maps.length === 0) return null;

  for (const map of maps) {
    // Backup sources are added with status Inactive + directPlayback true (so the
    // setup never disturbs live streams) — eligible via the same rule as above.
    const source = await XtreamSource.findOne({
      _id: map.backupSourceId,
      $or: [{ status: 'Active' }, { directPlayback: true }],
    }).lean().exec();
    if (!source) continue;

    // Never fail over to a backup that is itself down — try the next tier.
    const health = await getSourceHealth(String(source._id));
    if (health !== 'verified') continue;

    return {
      streamUrl: buildFailoverStreamUrl(getSourceCreds(source), map.backupStreamId),
      source,
    };
  }
  return null;
}

/**
 * Light probe for one source.
 *
 * Direct-playback sources (Upstream primary, ottstreambox backup) are judged by the
 * STREAM customers actually use — the primary probes one of its own catalog
 * channels, the backup probes a mapped stream. The server-side API reachability
 * is NOT customer-relevant for direct playback (Upstream's API is unreachable from
 * this server while its CDN streams work fine — a TLS block on the API domain).
 *
 * Proxy-mode sources relay playback through the server, so their API
 * reachability IS the customer-relevant signal and is probed directly.
 */
async function probeSource(source: any): Promise<{ health: SourceHealth; error: string | null; latencyMs: number }> {
  const started = Date.now();
  let error: string | null = null;

  if (source.directPlayback === true) {
    let probeUrls: string[] = [];
    const map = await ChannelFailoverMap.findOne({
      backupSourceId: source._id,
      enabled: true,
      backupStreamId: { $exists: true, $ne: '' },
    }).lean().exec();
    if (map) {
      probeUrls.push(buildFailoverStreamUrl(getSourceCreds(source), map.backupStreamId));
    } else {
      // Primary source: sample a few catalog channels — a single flaky channel
      // must not mark the whole source down.
      const chs = await Channel.find({
        isActive: { $ne: false },
        'metadata.source': 'xtream',
        'metadata.xtreamSourceId': source._id,
        channelUrl: { $exists: true, $ne: '' },
      })
        .select('channelUrl')
        .limit(3)
        .lean()
        .exec();
      probeUrls = chs.map((c) => String(c.channelUrl || '')).filter(Boolean);
    }

    if (probeUrls.length === 0) {
      // No stream to probe yet (backup before any maps) — API check as a
      // fallback so the source at least reports auth health.
      return probeApiOnly(source, started);
    }

    // Any live sample ⇒ the source serves customers.
    for (const probeUrl of probeUrls) {
      const playbackOk = await probePlaybackUrl(probeUrl);
      if (playbackOk.ok) {
        return { health: 'verified', error: null, latencyMs: Date.now() - started };
      }
      if (playbackOk.error) {
        // keep the last error for diagnostics
        error = playbackOk.error;
      }
    }
    return {
      health: 'degraded',
      error: error || 'Direct stream probe failed',
      latencyMs: Date.now() - started,
    };
  }

  return probeApiOnly(source, started);
}

/**
 * Lightweight liveness probe for a direct playback URL.
 *
 * HLS manifests (the ottstreambox case): follow redirects, expect an HLS
 * manifest (HTTP 200-399 + #EXTM3U / #EXT-X- marker). Deliberately NOT the
 * deep probeStream segment check — some panels return manifests with RELATIVE
 * segment paths after a 302 to a signed CDN host, so resolving the first
 * segment against the ORIGINAL URL always fails even though playback works
 * fine for customers.
 *
 * TS transport streams (the Business Cloud NEO case): a .ts live URL never
 * ends — an HTTP 200-399 response IS the liveness signal. Probe it like
 * stream-prober does for non-HLS (stream response, tiny 1 KB cap, destroy
 * immediately) instead of the 512 KB HLS-manifest read, which always fails
 * with "maxContentLength size of 524288 exceeded" on a healthy TS stream and
 * wrongly marks the source degraded every watchdog cycle.
 */
async function probePlaybackUrl(url: string): Promise<{ ok: boolean; error: string | null }> {
  const isTs = /\.ts(?:\?|#|$)/i.test(url) || /[?&]output=ts(?:&|$)/i.test(url);
  try {
    const res = await axios.get(url, {
      timeout: 6000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 500,
      maxContentLength: isTs ? 1024 : 512 * 1024,
      responseType: isTs ? 'stream' : 'text',
      headers: { 'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18', Accept: '*/*' },
    });
    const httpOk = res.status >= 200 && res.status < 400;
    if (!httpOk) {
      if (isTs && res.data && typeof res.data.destroy === 'function') res.data.destroy();
      return { ok: false, error: `HTTP ${res.status}` };
    }
    if (isTs) {
      // A TS transport stream is unbounded — a healthy HTTP response is enough.
      if (res.data && typeof res.data.destroy === 'function') res.data.destroy();
      return { ok: true, error: null };
    }
    const body = String(res.data || '');
    if (!body.includes('#EXTM3U') && !body.includes('#EXT-X-')) {
      return { ok: false, error: 'Invalid HLS manifest' };
    }
    return { ok: true, error: null };
  } catch (err: any) {
    if (isTs && String(err?.message || '').includes('maxContentLength')) {
      // Cap hit while the stream is flowing = the source is alive.
      return { ok: true, error: null };
    }
    return { ok: false, error: err?.response?.status ? `HTTP ${err.response.status}` : String(err?.message || 'Manifest probe failed') };
  }
}

function getSourceCreds(source: any): { serverUrl: string; username: string; password: string; mirrorServerUrls?: string[] } {
  return {
    serverUrl: source.serverUrl,
    mirrorServerUrls: source.mirrorServerUrls || [],
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  };
}

async function probeApiOnly(source: any, started: number): Promise<{ health: SourceHealth; error: string | null; latencyMs: number }> {
  try {
    const auth = await testXtreamConnection(getSourceCreds(source));
    if (!auth.ok) {
      return { health: 'blocked', error: auth.error || 'Authentication failed', latencyMs: Date.now() - started };
    }
    return { health: 'verified', error: null, latencyMs: Date.now() - started };
  } catch (err: any) {
    return {
      health: 'blocked',
      error: err?.response?.status ? `HTTP ${err.response.status}` : String(err?.message || 'API probe failed'),
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Watchdog entry point (task-registry): probe every Active Xtream source,
 * persist the health, refresh the cache and alert on transitions.
 */
export async function runSourceWatchdog(): Promise<{
  checked: number;
  states: Array<{ sourceId: string; name: string; health: SourceHealth }>;
}> {
  // Probe every source that can serve playback: Active ones AND direct-playback
  // ones. The backup source is deliberately added with status Inactive +
  // directPlayback true (no impact on current streams while it is set up), so
  // an Active-only query would never probe it — and Upstream itself may be Inactive
  // while its direct URLs still work.
  const sources = await XtreamSource.find({ $or: [{ status: 'Active' }, { directPlayback: true }] })
    .select('name serverUrl usernameEncrypted passwordEncrypted verificationStatus directPlayback')
    .lean()
    .exec();
  const states: Array<{ sourceId: string; name: string; health: SourceHealth }> = [];

  for (const source of sources) {
    const key = String(source._id);
    const prev = mapDbStatusToHealth(source.verificationStatus);
    let next: SourceHealth;
    let error: string | null = null;

    try {
      const probe = await probeSource(source);
      next = probe.health;
      error = probe.error;
    } catch (err: any) {
      next = 'blocked';
      error = String(err?.message || 'Watchdog probe failed');
    }

    // Hysteresis on RECOVERY only: going down applies immediately (fast
    // failover); coming back requires two consecutive verified probes.
    if (next === 'verified' && prev !== 'verified') {
      const streak = (consecutiveVerified.get(key) || 0) + 1;
      consecutiveVerified.set(key, streak);
      if (streak < 2) {
        next = prev; // not yet — keep the source marked down
      }
    } else if (next === 'verified') {
      consecutiveVerified.set(key, 0);
    } else {
      consecutiveVerified.set(key, 0);
    }

    // Persist only when something actually changed (avoid write churn every 60s).
    const errorChanged = error !== null && String(source.lastError || '') !== error;
    if (next !== prev || errorChanged || source.verificationStatus === 'pending') {
      await XtreamSource.updateOne(
        { _id: source._id },
        {
          $set: {
            verificationStatus: next,
            ...(errorChanged || next !== prev ? { lastError: error } : {}),
            lastDiagnosticsAt: new Date(),
          },
        },
      ).exec();
    }

    healthCache.set(key, { health: next, checkedAt: Date.now() });
    states.push({ sourceId: key, name: String(source.name || ''), health: next });

    // Alert on transitions only (no alert spam every 60s while down).
    const lastAlerted = lastAlertedHealth.get(key);
    if (next !== lastAlerted && next !== prev) {
      lastAlertedHealth.set(key, next);
      const name = String(source.name || key);
      if (next === 'blocked') {
        await sendOperationalAlert({
          event: 'xtream-source-down',
          severity: 'critical',
          message: `مصدر ${name} متوقف — ستفشل القنوات المرتبطة به؛ التبديل الاحتياطي نشط للمطابَقة`,
        }).catch(() => {});
      } else if (next === 'degraded') {
        await sendOperationalAlert({
          event: 'xtream-source-degraded',
          severity: 'warning',
          message: `مصدر ${name} متدهور (البث المباشر لا يستجيب)`,
        }).catch(() => {});
      } else if (next === 'verified' && prev !== 'verified') {
        await sendOperationalAlert({
          event: 'xtream-source-recovered',
          severity: 'warning',
          message: `مصدر ${name} عاد للعمل — الجلسات الجديدة ستستخدمه من جديد`,
        }).catch(() => {});
      }
    } else if (next === lastAlerted && next === prev) {
      // keep the alerted state so a recovery after silence still fires
    }
  }

  return { checked: sources.length, states };
}

/**
 * Auto-match helper (admin action): pull the backup source's live streams and
 * match them to catalog channels by normalized name. Returns the created maps.
 */
export async function autoMatchFailoverMaps(
  backupSourceId: string,
  opts: { limit?: number; nameContains?: string; categories?: string[] } = {},
): Promise<{ created: number; skipped: number; errors: number }> {
  const source = await XtreamSource.findById(backupSourceId).lean().exec();
  if (!source) throw new Error('Source not found');

  const creds = {
    serverUrl: source.serverUrl,
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  };

  // A Maghreb panel can list 100k+ streams — fetching them all in one call is
  // slow and wasteful. When category names are given, resolve them to ids and
  // fetch only those categories' streams (the feasibility report's own plan:
  // «لا تستورد 115k كما هي — فلتر الفئات المغاربية أولًا»).
  let streams: any[] = [];
  const wantedCategories = (opts.categories || []).map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  if (wantedCategories.length > 0) {
    const catRes = await axios.get(buildXtreamApiUrl(creds, 'get_live_categories'), { timeout: 60000 });
    const cats = Array.isArray(catRes.data) ? catRes.data : [];
    const catIds = cats
      .filter((c: any) => wantedCategories.some((w) => String(c?.category_name || '').toLowerCase().includes(w)))
      .map((c: any) => String(c?.category_id || ''))
      .filter(Boolean);
    for (const catId of catIds) {
      const sRes = await axios.get(buildXtreamApiUrl(creds, 'get_live_streams', { category_id: catId }), { timeout: 90000 });
      if (Array.isArray(sRes.data)) streams.push(...sRes.data);
    }
  } else {
    const res = await axios.get(buildXtreamApiUrl(creds, 'get_live_streams'), { timeout: 120000 });
    streams = Array.isArray(res.data) ? res.data : [];
  }
  const limit = Math.min(Math.max(opts.limit || 500, 1), 2000);

  const catalog = await Channel.find({ isActive: { $ne: false } })
    .select('channelId channelName channelGroup')
    .lean()
    .exec();
  // Index catalog channels by canonical key (curated dictionary) and by cleaned
  // name (fuzzy fallback via an inverted token index — the catalog is ~16k rows,
  // scoring each row per backup stream would be far too slow).
  const byCanonicalKey = new Map<string, any[]>();
  const catalogTokenIndex = new Map<string, Array<{ cleanedName: string; chans: any[] }>>();
  for (const ch of catalog) {
    if (isForeignCatalogChannel(ch.channelName || '')) continue;
    const ck = channelCanonicalKey(ch.channelName || '');
    if (ck) {
      if (!byCanonicalKey.has(ck)) byCanonicalKey.set(ck, []);
      byCanonicalKey.get(ck)!.push(ch);
    }
    const key = normalizeChannelName(ch.channelName || '');
    if (!key) continue;
    const toks = new Set(tokenize(cleanChannelName(ch.channelName || '')));
    for (const t of toks) {
      if (!catalogTokenIndex.has(t)) catalogTokenIndex.set(t, []);
      catalogTokenIndex.get(t)!.push({ cleanedName: cleanChannelName(ch.channelName || ''), chans: [ch] });
    }
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;
  const seen = new Set<string>();
  for (const item of streams) {
    const name = String(item?.name || '').trim();
    const streamId = String(item?.stream_id ?? '').trim();
    if (!name || !streamId) {
      skipped += 1;
      continue;
    }
    if (opts.nameContains && !name.toLowerCase().includes(String(opts.nameContains).toLowerCase())) continue;

    // 1) Curated dictionary match (handles the messy Maghreb naming: 'Dz|ENTV 1
    //    FULL HD' vs 'AR: Algerie EN TV 1', 'Echorouk' vs 'Echourouk', …).
    const ck = channelCanonicalKey(name);
    let matches: any[] | undefined = ck ? byCanonicalKey.get(ck) : undefined;
    // 2) Fuzzy fallback: cleaned-token Jaccard with a typo-tolerant token match,
    //    restricted to catalog channels sharing at least one token.
    if (!matches || matches.length === 0) {
      const cleaned = cleanChannelName(name);
      const tokens = tokenize(cleaned);
      const candidateChans = new Map<string, any[]>();
      for (const t of tokens) {
        for (const cand of catalogTokenIndex.get(t) || []) {
          if (!candidateChans.has(cand.cleanedName)) candidateChans.set(cand.cleanedName, cand.chans);
        }
      }
      let best: any[] | undefined;
      let bestScore = 0;
      for (const [catalogName, chans] of candidateChans) {
        const score = nameMatchScore(cleaned, catalogName);
        if (score > bestScore) {
          bestScore = score;
          best = chans;
        }
      }
      if (best && fuzzyAccepted(cleaned, best[0]?.channelName ? cleanChannelName(best[0].channelName) : '')) matches = best;
    }

    if (!matches || matches.length === 0) {
      skipped += 1;
      continue;
    }
    // Prefer the base variant over +6H / LQ / RAW / SD clones.
    const ch = matches.sort((a, b) => channelVariantRank(a.channelName || '') - channelVariantRank(b.channelName || ''))[0];
    const mapKey = `${String(ch.channelId)}:${backupSourceId}`;
    if (seen.has(mapKey)) continue;
    seen.add(mapKey);
    try {
      await ChannelFailoverMap.findOneAndUpdate(
        { channelRef: String(ch.channelId), backupSourceId },
        {
          $set: {
            channelId: ch._id,
            backupChannelName: name,
            backupStreamId: streamId,
            matchedBy: 'name',
            enabled: true,
          },
        },
        { upsert: true, new: true },
      ).exec();
      created += 1;
      if (created >= limit) break;
    } catch {
      errors += 1;
    }
  }
  return { created, skipped, errors };
}

module.exports = {
  buildFailoverStreamUrl,
  getSourceHealth,
  isSourceDown,
  getFailoverTarget,
  runSourceWatchdog,
  autoMatchFailoverMaps,
  cleanChannelName,
  channelCanonicalKey,
  channelVariantRank,
  nameMatchScore,
  tokenize,
  fuzzyAccepted,
  isForeignCatalogChannel,
};
