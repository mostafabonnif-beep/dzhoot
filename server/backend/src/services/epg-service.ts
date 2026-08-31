import axios from 'axios';
import http from 'http';
import https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { createGunzip } from 'zlib';
import EpgProgram from '../models/EpgProgram';
import M3USource from '../models/M3USource';
import EpgSourceOverride from '../models/EpgSourceOverride';
import { epgCache } from './cache';
import { decryptSecret } from '../utils/crypto';
import { createPinnedLookup, validateUrlForSSRF } from '../utils/ssrf-guard';
import { runBoundedBatch } from '../utils/concurrency';
const Channel = require('../models/Channel');


const EPG_REFRESH_INTERVAL = parseInt(process.env.EPG_REFRESH_INTERVAL_MS || '21600000', 10); // 6 hours

// Bounded-concurrency EPG fetching (audit-remediation-v1).
// Default 1: sequential fetching keeps peak memory proportional to a single
// guide instead of `concurrency` guides, which previously drove the scheduler
// into a heap OOM crash (each parsed XMLTV tree is several times the raw size).
// Capped at 2 (merged from release-5d86615) — operators may raise it only
// after observing sufficient memory headroom.
const EPG_FETCH_CONCURRENCY = Math.max(
  1,
  Math.min(parseInt(process.env.EPG_FETCH_CONCURRENCY || '1', 10) || 1, 2),
);

// Per-source hard timeout — a slow/hung guide must not pin the event loop or
// accumulate buffers indefinitely. Matches the axios request timeout by default.
const EPG_SOURCE_TIMEOUT_MS = Math.max(
  5000,
  parseInt(process.env.EPG_SOURCE_TIMEOUT_MS || '120000', 10) || 120000,
);

// Decompressed XML cap per guide (was a fixed 200MB). Default 50MB — merged
// from release-5d86615 (parsing XML expands memory far beyond the compressed
// file); operators may raise it up to 100MB after capacity tests.
const EPG_MAX_DECOMPRESSED_MB = Math.max(
  10,
  Math.min(parseInt(process.env.EPG_MAX_DECOMPRESSED_MB || '50', 10) || 50, 100),
);

// Programs kept per source before the 48h lookahead window filter is applied.
// Guards the in-memory programs array + the bulk upsert ops array.
const EPG_MAX_PROGRAMS_PER_SOURCE = Math.max(
  1000,
  parseInt(process.env.EPG_MAX_PROGRAMS_PER_SOURCE || '50000', 10) || 50000,
);

// Auto-disable a source after this many CONSECUTIVE size-limit failures.
// A guide that decompresses beyond EPG_MAX_DECOMPRESSED_MB will never succeed
// without raising the cap, and re-downloading it every refresh cycle wastes
// bandwidth, disk and memory. After the threshold the source is disabled with
// a durable note; an operator can re-enable it from the admin UI after
// capacity tests (see EPG_MAX_DECOMPRESSED_MB comment).
const EPG_AUTO_DISABLE_CONSECUTIVE_FAILURES = Math.max(
  2,
  parseInt(process.env.EPG_AUTO_DISABLE_CONSECUTIVE_FAILURES || '3', 10) || 3,
);
const EPG_OVERSIZED_ERROR_RE = /exceeds maximum decompressed size/i;

// Heap/RSS guard: before starting each source, if the process RESIDENT memory
// (what the container cgroup actually counts) is above this threshold the
// source is skipped and recorded as an error instead of letting the process
// crash with a fatal OOM. RSS is used (not just V8 heapUsed) because XML
// parsing also allocates large external/string buffers that heapUsed misses
// yet still count against the container memory limit.
const EPG_HEAP_GUARD_MB = Math.max(128, parseInt(process.env.EPG_HEAP_GUARD_MB || '768', 10) || 768);

// Optional country allowlist for the iptv-epg.org auto-discovery
// (e.g. "dz,sa,ae" to only fetch those guides). Empty = all discovered countries.
const EPG_COUNTRY_FILTER = (process.env.EPG_COUNTRY_FILTER || '')
  .split(',')
  .map((c) => c.trim().toLowerCase())
  .filter((c) => /^[a-z]{2}$/.test(c));

// Optional operator-configured custom XMLTV sources (JSON array of {url, label}).
// ONLY legal/authorized sources should be configured. Each URL is SSRF-validated
// at fetch time and its programmes are kept for ALL channels (coveredChannelIds
// includes '*'). Example:
//   EPG_EXTRA_SOURCES=[{"url":"https://example.com/guide.xml.gz","label":"operator-dz"}]
let EPG_EXTRA_SOURCES: Array<{ url: string; label: string }> = [];
try {
  const raw = process.env.EPG_EXTRA_SOURCES || '';
  if (raw.trim()) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      EPG_EXTRA_SOURCES = parsed
        .filter(
          (s) =>
            s && typeof s.url === 'string' && /^https:\/\//i.test(s.url.trim()) && s.url.length < 2048,
        )
        .map((s) => ({ url: s.url.trim(), label: String(s.label || s.url).slice(0, 100) }));
    }
  }
} catch {
  console.warn('[epg-service] EPG_EXTRA_SOURCES is not valid JSON — ignoring');
}

const BATCH_SIZE = 500;
const IPTV_EPG_BASE = 'https://iptv-epg.org/files';

/** Strip userinfo (user:pass@) from URLs before persisting them, so embedded
 *  credentials never land in override docs or the audit log. */
function sanitizeUrlForStorage(url: string): string {
  try {
    return url.replace(/\/\/[^/@\s]+@/, '//***@');
  } catch {
    return url;
  }
}

function heapUsedMb(): number {
  return Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10;
}

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
}

// Whether the runtime exposes a manual GC (started with --expose-gc).
const gcAvailable = typeof (globalThis as any).gc === 'function';

// Give V8 a chance to return freed memory to the OS between EPG sources.
// Each guide allocates a very large XML string + parse tree; those become
// garbage on return, but V8 does not collect eagerly at this size. Forcing a
// collection (when available) and yielding the event loop lets RSS drop back
// under the heap guard so later sources are not all skipped. No-op without
// --expose-gc, where the natural GC cadence applies.
async function reclaimMemory(): Promise<void> {
  if (gcAvailable) {
    try {
      (globalThis as any).gc();
    } catch {
      // never let GC break the refresh loop
    }
  }
  // Yield so pending finalizers/GC callbacks run before the next allocation.
  await new Promise((resolve) => setImmediate(resolve));
}

interface EpgSourceInfo {
  url: string;
  coveredChannelIds: string[];
  source: string;
  /** Operator-set override state (merged at discovery time). */
  disabled?: boolean;
  /** Consecutive failures counter (used for auto-disable of chronic failures). */
  consecutiveFailures?: number;
  lastOkAt?: Date | null;
  lastFailedAt?: Date | null;
  lastError?: string | null;
  lastTestedAt?: Date | null;
  lastTestResult?: { ok: boolean; programCount?: number; error?: string } | null;
}

interface ParsedProgram {
  channelEpgId: string;
  title: string;
  description: string | null;
  category: string[];
  startTime: Date;
  endTime: Date;
  icon: string | null;
  language: string | null;
}

interface EpgCoverageItem {
  source: string;
  coveredChannelCount: number;
  matchedChannelCount: number;
  coveragePercent: number;
  unmatchedChannels: Array<{ channelId: string; name: string; tvgId: string | null }>;
}

interface EpgCoverageStats {
  totalSystemChannels: number;
  matchedSystemChannels: number;
  overallCoveragePercent: number;
  unmatchedChannelCount: number;
  sources: EpgCoverageItem[];
}

interface EpgStats {
  totalPrograms: number;
  channelsWithEpg: number;
  totalSystemChannels: number;
  lastRefreshedAt: Date | null;
  nextRefreshAt: Date | null;
  sourcesDiscovered: number;
  refreshInProgress: boolean;
  lastRefreshDurationMs: number;
  lastRefreshProgramCount: number;
  lastRefreshErrorCount: number;
  lastRefreshErrorSources: string[];
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    concurrency: number;
    heapGuardMb: number;
  };
}

export class EpgService {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private testPromise: Promise<{ ok: boolean; programCount: number; error?: string }> | null = null;
  private lastRefreshedAt: Date | null = null;
  private lastSourceCount = 0;
  private lastRefreshDurationMs = 0;
  private lastRefreshProgramCount = 0;
  private lastRefreshErrorCount = 0;
  private lastRefreshErrorSources: string[] = [];

  // ─── Lifecycle ──────────────────────────────────────────

  async initializeOnStartup(): Promise<void> {
    const programCount = await EpgProgram.countDocuments();
    if (programCount === 0) {
      console.log('[epg-service] No EPG data found, starting initial fetch...');
      this.refreshEpg().catch((err) =>
        console.error('[epg-service] Initial EPG fetch failed:', err.message),
      );
    } else {
      console.log(`[epg-service] ${programCount} EPG programs in database`);
      // Check if stale
      const oldest = await EpgProgram.findOne().sort({ updatedAt: 1 }).lean();
      if (oldest && Date.now() - new Date(oldest.updatedAt).getTime() > EPG_REFRESH_INTERVAL) {
        console.log('[epg-service] EPG data stale, refreshing in background...');
        this.refreshEpg().catch((err) =>
          console.error('[epg-service] Background EPG refresh failed:', err.message),
        );
      }
    }

    // Recurring EPG refresh is handled by scheduler-service.ts (no in-process timer needed)
    console.log('[epg-service] Recurring refresh managed by scheduler service');
  }

  stopBackgroundUpdates(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      console.log('[epg-service] Background updates stopped');
    }
  }

  // ─── Main Refresh ───────────────────────────────────────

  async refreshEpg(): Promise<void> {
    // Dedup concurrent refresh calls.
    // NOTE: The check and assignment below are synchronous (no await between them),
    // so no concurrent call can slip through in single-threaded Node.js.
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    // Store the actual work promise so concurrent callers share it. The no-op
    // catch prevents an unhandled rejection if no one else is awaiting, while
    // callers that do await still receive the rejection.
    this.refreshPromise = this.doRefreshEpg();
    this.refreshPromise.catch(() => {});
    return this.refreshPromise;
  }

  private async doRefreshEpg(): Promise<void> {
    const startTime = Date.now();
    this.lastRefreshErrorCount = 0;
    this.lastRefreshErrorSources = [];
    this.lastRefreshProgramCount = 0;
    try {
      console.log('[epg-service] Starting EPG refresh...');

      // 1. Discover what XMLTV files we need (operator-disabled sources are
      //    still returned with state but excluded from the fetch list).
      const allSources = await this.discoverEpgSources();
      const sources = allSources.filter((s) => !s.disabled);
      this.lastSourceCount = sources.length;

      if (sources.length === 0) {
        console.log('[epg-service] No EPG sources discovered for current channels');
        this.lastRefreshedAt = new Date();
        this.lastRefreshDurationMs = Date.now() - startTime;
        return;
      }

      console.log(`[epg-service] Discovered ${sources.length} EPG sources to fetch (concurrency=${EPG_FETCH_CONCURRENCY}, heap=${heapUsedMb()}MB)`);

      // 2. Fetch with bounded concurrency + per-source timeout + heap guard.
      //    A failing or oversized source is recorded and skipped — it never
      //    aborts the remaining sources (audit-remediation-v1).
      const batchStats = await runBoundedBatch(
        sources,
        EPG_FETCH_CONCURRENCY,
        async (source) => {
          // Reclaim memory from the PREVIOUS source before evaluating the guard.
          // V8 defers GC while RSS sits below --max-old-space-size, so without an
          // explicit collection the freed XML/parse trees from prior sources kept
          // RSS above EPG_HEAP_GUARD_MB and every subsequent source was skipped
          // (production: 49/52 sources failed with "RSS exceeds EPG_HEAP_GUARD_MB").
          await reclaimMemory();
          if (rssMb() > EPG_HEAP_GUARD_MB) {
            throw new Error(`Skipped: RSS ${rssMb()}MB exceeds EPG_HEAP_GUARD_MB (${EPG_HEAP_GUARD_MB}MB)`);
          }
          const beforeHeap = heapUsedMb();
          try {
            const programs = await this.fetchAndParseXmltv(source.url, source.coveredChannelIds);
            const count = programs.length > 0 ? await this.upsertPrograms(programs) : 0;
            // Persist per-source health so the admin UI can show durable
            // ok/failed state (and operators can disable chronic failures).
            await this.recordSourceResult(source.url, true);
            return count;
          } catch (err: any) {
            await this.recordSourceResult(source.url, false, err?.message || String(err));
            throw err;
          } finally {
            console.log(
              `[epg-service] Source ${source.source}: heap ${beforeHeap}MB -> ${heapUsedMb()}MB (rss ${rssMb()}MB, ${Math.round((Date.now() - startTime) / 1000)}s elapsed)`,
            );
          }
        },
        {
          timeoutMs: EPG_SOURCE_TIMEOUT_MS,
          label: (source: any) => source.source || String(source.url || ''),
          onError: (label, err: any) => {
            this.lastRefreshErrorCount += 1;
            if (this.lastRefreshErrorSources.length < 10) {
              this.lastRefreshErrorSources.push(label);
            }
            console.warn(`[epg-service] Failed to fetch ${label}: ${err.message}`);
          },
        },
      );

      const durationMs = Date.now() - startTime;
      this.lastRefreshDurationMs = durationMs;
      this.lastRefreshProgramCount = batchStats.processedCount === 0 ? 0 : await this.countProgramsSince(startTime);
      this.lastRefreshedAt = new Date();

      // Bust cached EPG responses AND the known-ids set — a refresh can introduce
      // programs for channelEpgIds the cached set would otherwise filter out.
      await epgCache.deletePattern('*');

      console.log(
        `[epg-service] EPG refresh complete: ${this.lastRefreshProgramCount} programs upserted from ${sources.length} sources ` +
          `(${batchStats.failedCount} failed) in ${durationMs}ms — heap ${heapUsedMb()}MB`,
      );
    } catch (err: any) {
      console.error('[epg-service] EPG refresh failed:', err.message);
      throw err;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async countProgramsSince(startTime: number): Promise<number> {
    try {
      return await EpgProgram.countDocuments({ updatedAt: { $gte: new Date(startTime) } });
    } catch {
      return 0;
    }
  }

  // ─── Source Discovery ───────────────────────────────────

  async discoverEpgSources(): Promise<EpgSourceInfo[]> {
    const channels = await Channel.find({}).lean();
    if (channels.length === 0) return [];

    const sources: EpgSourceInfo[] = [];
    const seenUrls = new Set<string>();

    // Group channels by country code (extracted from channelId TLD: "AajTak.in" → "in")
    const countryToChannelIds = new Map<string, string[]>();

    for (const ch of channels) {
      const metaSource = ch.metadata?.source || '';
      const metaCountry = ch.metadata?.country || '';

      // Pluto TV → i.mjh.nz EPG
      if (metaSource === 'pluto-tv' && metaCountry) {
        const region = metaCountry.toLowerCase();
        const url = `https://i.mjh.nz/PlutoTV/${region}.xml`;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          const coveredIds = channels
            .filter(
              (c: any) =>
                c.metadata?.source === 'pluto-tv' && c.metadata?.country?.toLowerCase() === region,
            )
            .map((c: any) => c.channelId);
          sources.push({ url, coveredChannelIds: coveredIds, source: 'pluto-tv' });
        }
        continue;
      }

      // Samsung TV Plus → i.mjh.nz EPG
      if (metaSource === 'samsung-tv-plus' && metaCountry) {
        const region = metaCountry.toLowerCase();
        const url = `https://i.mjh.nz/SamsungTVPlus/${region}.xml`;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          const coveredIds = channels
            .filter(
              (c: any) =>
                c.metadata?.source === 'samsung-tv-plus' &&
                c.metadata?.country?.toLowerCase() === region,
            )
            .map((c: any) => c.channelId);
          sources.push({ url, coveredChannelIds: coveredIds, source: 'samsung-tv-plus' });
        }
        continue;
      }

      // For iptv-org channels: extract country from the provider id suffix.
      // Keep both tvgId and channelId as aliases: guides frequently publish one
      // while the catalog stores the other. Matching remains exact after
      // lowercasing, so this improves coverage without fuzzy name collisions.
      const epgIds = [ch.tvgId, ch.channelId].filter(Boolean).map(String);
      const countryId = epgIds.find((id) => {
        const dotIdx = id.lastIndexOf('.');
        return dotIdx > 0 && dotIdx < id.length - 1 && id.substring(dotIdx + 1).length === 2;
      });
      if (countryId) {
        const country = countryId.substring(countryId.lastIndexOf('.') + 1).toLowerCase();
        if (!countryToChannelIds.has(country)) countryToChannelIds.set(country, []);
        const ids = countryToChannelIds.get(country)!;
        for (const epgId of epgIds) {
          if (!ids.some((existing) => existing.toLowerCase() === epgId.toLowerCase())) ids.push(epgId);
        }
      }
    }

    // Add custom XMLTV URLs configured on active M3U sources. These sources
    // are intentionally read from the encrypted value and are validated again
    // at fetch time, so a changed DNS record cannot turn the scheduler into an
    // internal network proxy.
    const customM3USources = await M3USource.find({
      status: 'Active',
      epgUrlEncrypted: { $nin: [null, ''] },
    }).lean();

    for (const source of customM3USources) {
      try {
        const url = decryptSecret(source.epgUrlEncrypted || '');
        if (!url || seenUrls.has(url)) continue;
        const sourceChannels = channels.filter(
          (channel: any) => String(channel.metadata?.m3uSourceId || '') === String(source._id),
        );
        const coveredChannelIds = sourceChannels
          .flatMap((channel: any) => [channel.tvgId, channel.channelId])
          .filter(Boolean)
          .map(String);
        if (coveredChannelIds.length === 0) continue;
        seenUrls.add(url);
        sources.push({
          url,
          coveredChannelIds,
          source: `m3u:${source._id}`,
        });
      } catch {
        console.warn(`[epg-service] Invalid encrypted XMLTV URL for M3U source ${source._id}`);
      }
    }

    // Add iptv-epg.org sources per country
    for (const [country, channelIds] of countryToChannelIds) {
      if (EPG_COUNTRY_FILTER.length > 0 && !EPG_COUNTRY_FILTER.includes(country)) continue;
      const url = `${IPTV_EPG_BASE}/epg-${country}.xml.gz`;
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        sources.push({ url, coveredChannelIds: channelIds, source: 'iptv-epg.org' });
      }
    }

    // Operator-configured custom XMLTV sources (EPG_EXTRA_SOURCES env, JSON).
    // Programmes are matched to every channel by tvg-id/channelId via '*' so a
    // single authorized guide can cover the whole catalog.
    for (const extra of EPG_EXTRA_SOURCES) {
      if (seenUrls.has(extra.url)) continue;
      seenUrls.add(extra.url);
      sources.push({
        url: extra.url,
        coveredChannelIds: ['*'],
        source: `custom:${extra.label}`,
      });
    }

    // Merge per-source override state (operator disabled + durable health).
    // Disabled sources are still returned here so the admin UI can re-enable
    // them; refreshEpg() filters them out before fetching.
    const overrides = await EpgSourceOverride.find({}).lean();
    const overrideByUrl = new Map(overrides.map((o: any) => [o.url, o]));
    return sources.map((s) => {
      const ov = overrideByUrl.get(s.url);
      if (!ov) {
        return {
          ...s,
          disabled: false,
          consecutiveFailures: 0,
          lastOkAt: null,
          lastFailedAt: null,
          lastError: null,
          lastTestedAt: null,
          lastTestResult: null,
        };
      }
      return {
        ...s,
        disabled: Boolean(ov.disabled),
        consecutiveFailures: ov.consecutiveFailures ?? 0,
        lastOkAt: ov.lastOkAt ?? null,
        lastFailedAt: ov.lastFailedAt ?? null,
        lastError: ov.lastError ?? null,
        lastTestedAt: ov.lastTestedAt ?? null,
        lastTestResult: ov.lastTestResult ?? null,
      };
    });
  }

  // ─── Per-source overrides & health (admin) ─────────────────

  /** Persist a durable ok/failed marker for a source (used by refresh + tests). */
  async recordSourceResult(url: string, ok: boolean, error?: string): Promise<void> {
    const safeUrl = sanitizeUrlForStorage(url);
    try {
      if (ok) {
        await EpgSourceOverride.updateOne(
          { url: safeUrl },
          {
            $set: { lastOkAt: new Date(), consecutiveFailures: 0 },
            $unset: { lastFailedAt: 1, lastError: 1 },
          },
          { upsert: true },
        );
        return;
      }
      const updated = await EpgSourceOverride.findOneAndUpdate(
        { url: safeUrl },
        {
          $set: {
            lastFailedAt: new Date(),
            lastError: sanitizeUrlForStorage(String(error || 'unknown error')).slice(0, 500),
          },
          $inc: { consecutiveFailures: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      // A guide that permanently exceeds the decompressed size limit (e.g. a
      // country file that expands to several times the memory budget) fails on
      // every refresh. Auto-disable it once the threshold is reached so the
      // scheduler stops re-downloading a guide it can never process — the admin
      // UI keeps the override visible and can re-enable it after capacity tests.
      const errText = String(error || '');
      const consecutive = updated?.consecutiveFailures ?? 0;
      if (consecutive >= EPG_AUTO_DISABLE_CONSECUTIVE_FAILURES && EPG_OVERSIZED_ERROR_RE.test(errText)) {
        await this.setSourceDisabled(
          safeUrl,
          true,
          `Auto-disabled after ${consecutive} consecutive size-limit failures (guide exceeds the maximum decompressed EPG size; re-enable only after capacity tests)`,
        );
      }
    } catch (err) {
      console.warn('[epg-service] Failed to record source result:', err);
    }
  }

  /** Enable/disable a source for future refreshes (persisted). */
  async setSourceDisabled(url: string, disabled: boolean, note?: string): Promise<void> {
    const safeUrl = sanitizeUrlForStorage(url);
    try {
      await EpgSourceOverride.updateOne(
        { url: safeUrl },
        {
          $set: {
            disabled,
            ...(note !== undefined ? { note: String(note).slice(0, 500) } : {}),
          },
        },
        { upsert: true },
      );
    } catch (err: any) {
      // Upsert race on the unique index (e.g. a refresh recording a result at
      // the same moment) — retry once, then surface the error.
      if (err?.code === 11000) {
        await EpgSourceOverride.updateOne(
          { url: safeUrl },
          { $set: { disabled, ...(note !== undefined ? { note: String(note).slice(0, 500) } : {}) } },
        );
        return;
      }
      throw err;
    }
  }

  /** Fetch + parse a single source on demand (bounded), persist the result. */
  async testSource(url: string): Promise<{ ok: boolean; programCount: number; error?: string }> {
    // Serialize manual tests: a single large guide can already spike RSS close
    // to the heap guard; parallel manual tests must not stack on top of it.
    if (this.testPromise) {
      return { ok: false, programCount: 0, error: 'Another source test is already in progress' };
    }
    if (rssMb() > EPG_HEAP_GUARD_MB) {
      return {
        ok: false,
        programCount: 0,
        error: `Server memory is too high to test (RSS ${rssMb()}MB, limit ${EPG_HEAP_GUARD_MB}MB)`,
      };
    }

    this.testPromise = this.runSourceTest(url);
    try {
      const result = await this.testPromise;
      try {
        await EpgSourceOverride.updateOne(
          { url: sanitizeUrlForStorage(url) },
          { $set: { lastTestedAt: new Date(), lastTestResult: result } },
          { upsert: true },
        );
      } catch (err) {
        console.warn('[epg-service] Failed to persist source test:', err);
      }
      return result;
    } finally {
      this.testPromise = null;
    }
  }

  private async runSourceTest(url: string): Promise<{ ok: boolean; programCount: number; error?: string }> {
    let coveredIds: string[] = ['*'];
    try {
      const sources = await this.discoverEpgSources();
      const match = sources.find((s) => s.url === url);
      if (match) coveredIds = match.coveredChannelIds;
    } catch {
      // Fall back to '*' when discovery itself fails; the fetch is what we test.
    }
    try {
      const programs = await this.fetchAndParseXmltv(url, coveredIds);
      return { ok: true, programCount: programs.length };
    } catch (err: any) {
      return { ok: false, programCount: 0, error: String(err?.message || err).slice(0, 500) };
    }
  }

  // ─── Fetch & Parse XMLTV ───────────────────────────────

  async fetchAndParseXmltv(url: string, coveredChannelIds: string[]): Promise<ParsedProgram[]> {
    const coveredSet = new Set(coveredChannelIds.map((id) => id.toLowerCase()));

    // Stream the response to avoid holding compressed + decompressed buffers simultaneously
    const validation = await validateUrlForSSRF(url);
    if (!validation.safe || !validation.resolvedAddresses?.length) {
      throw new Error(`EPG URL rejected: ${validation.reason || 'unsafe URL'}`);
    }

    let currentUrl = url;
    let response;

    // Follow redirects manually (max 4 hops), re-validating every hop against
    // the SSRF guard so a redirect can never escape to a private/internal host.
    for (let hop = 0; hop < 4; hop += 1) {
      const hopValidation = hop === 0 ? validation : await validateUrlForSSRF(currentUrl);
      if (!hopValidation.safe || !hopValidation.resolvedAddresses?.length) {
        throw new Error(`EPG URL rejected: ${hopValidation.reason || 'unsafe URL'}`);
      }

      const parsedUrl = new URL(currentUrl);
      const lookup = createPinnedLookup(hopValidation.resolvedAddresses);
      const agent = parsedUrl.protocol === 'https:'
        ? new https.Agent({ lookup: lookup as any })
        : new http.Agent({ lookup: lookup as any });

      const hopResponse = await axios.get(currentUrl, {
        timeout: 120000,
        responseType: 'stream',
        maxContentLength: 100 * 1024 * 1024,
        maxBodyLength: 100 * 1024 * 1024,
        maxRedirects: 0,
        validateStatus: (status: number) => status < 400,
        httpAgent: parsedUrl.protocol === 'http:' ? agent : undefined,
        httpsAgent: parsedUrl.protocol === 'https:' ? agent : undefined,
        headers: { 'User-Agent': 'DZ-HOOF/1.0' },
      });

      const location = hopResponse.headers?.location;
      if ([301, 302, 303, 307, 308].includes(hopResponse.status) && location) {
        currentUrl = new URL(String(location), currentUrl).toString();
        if (hop === 3) throw new Error('EPG URL redirect limit exceeded');
        continue;
      }
      response = hopResponse;
      break;
    }

    if (!response) throw new Error('EPG URL fetch failed');
    const isGzip = currentUrl.endsWith('.gz') || url.endsWith('.gz');

    // Accumulate the decompressed XML as a string (V8 rope concatenation) rather
    // than a Buffer[] + Buffer.concat() — the latter kept two full copies of the
    // guide in memory at once, which dominated peak heap on large guides.
    const xmlData = await new Promise<string>((resolve, reject) => {
      let xml = '';
      let totalBytes = 0;
      const maxSizeBytes = EPG_MAX_DECOMPRESSED_MB * 1024 * 1024;

      let stream: any = response.data;
      if (isGzip) {
        const gunzip = createGunzip();
        stream = stream.pipe(gunzip);
        gunzip.on('error', reject);
      }
      stream.setEncoding('utf8');

      stream.on('data', (chunk: string) => {
        totalBytes += Buffer.byteLength(chunk);
        if (totalBytes > maxSizeBytes) {
          stream.destroy(new Error(`EPG XML exceeds maximum decompressed size (${EPG_MAX_DECOMPRESSED_MB}MB)`));
          return;
        }
        xml += chunk;
      });
      stream.on('end', () => resolve(xml));
      stream.on('error', reject);
      response.data.on('error', reject);
    });

    // Parse, extract the programmes we care about, then drop the parse tree as
    // soon as possible so the heap can be reclaimed before the upsert phase.
    let parsed: any;
    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        isArray: (name) => name === 'programme' || name === 'channel' || name === 'category',
      });
      parsed = parser.parse(xmlData);
    } finally {
      // xmlData is the largest single string in the process; release it now that
      // the parse tree exists (the tree itself is freed when we return).
    }

    const tv = parsed.tv || parsed['!xml']?.tv || parsed;
    const programmes = tv?.programme || [];
    parsed = null;

    const programs: ParsedProgram[] = [];

    for (const prog of programmes) {
      const channelId = prog['@_channel'] || '';
      // Only include programs for channels we care about
      if (!coveredSet.has(channelId.toLowerCase()) && coveredSet.size > 0) {
        // For i.mjh.nz sources, channel IDs may not match exactly — include all
        // if the source is known to be relevant
        if (coveredSet.size > 0 && !coveredChannelIds.includes('*')) {
          continue;
        }
      }

      const startTime = this.parseXmltvDate(prog['@_start']);
      const endTime = this.parseXmltvDate(prog['@_stop']);

      if (!startTime || !endTime) continue;

      // Skip programs that already ended more than 24h ago
      if (endTime.getTime() < Date.now() - 86400000) continue;

      // Skip programs starting beyond the lookahead window — bounds stored EPG size.
      // Upstream XMLTV often carries ~6 days; we only keep ~2 days ahead by default.
      const maxAheadMs = (Number(process.env.EPG_MAX_LOOKAHEAD_HOURS) || 48) * 3600000;
      if (startTime.getTime() > Date.now() + maxAheadMs) continue;

      const title = this.extractText(prog.title);
      if (!title) continue;

      const categories: string[] = [];
      if (prog.category) {
        const cats = Array.isArray(prog.category) ? prog.category : [prog.category];
        for (const cat of cats) {
          const text = typeof cat === 'string' ? cat : cat['#text'] || '';
          if (text) categories.push(text);
        }
      }

      programs.push({
        channelEpgId: channelId,
        title,
        description: this.extractText(prog.desc) || null,
        category: categories,
        startTime,
        endTime,
        icon: prog.icon?.['@_src'] || null,
        language: this.extractLang(prog.title) || null,
      });

      // Bound the in-memory programs array + the later bulk-write ops. Sources
      // beyond the cap are skipped for this run (logged once).
      if (programs.length >= EPG_MAX_PROGRAMS_PER_SOURCE) {
        console.warn(
          `[epg-service] Source ${currentUrl}: reached EPG_MAX_PROGRAMS_PER_SOURCE (${EPG_MAX_PROGRAMS_PER_SOURCE}); truncating`,
        );
        break;
      }
    }

    return programs;
  }

  // ─── Bulk Upsert ────────────────────────────────────────

  async upsertPrograms(programs: ParsedProgram[]): Promise<number> {
    if (programs.length === 0) return 0;

    let upsertedCount = 0;

    for (let i = 0; i < programs.length; i += BATCH_SIZE) {
      const batch = programs.slice(i, i + BATCH_SIZE);
      const ops = batch.map((prog) => ({
        updateOne: {
          filter: {
            channelEpgId: prog.channelEpgId,
            startTime: prog.startTime,
          },
          update: {
            $set: {
              title: prog.title,
              description: prog.description,
              category: prog.category,
              endTime: prog.endTime,
              icon: prog.icon,
              language: prog.language,
            },
          },
          upsert: true,
        },
      }));

      const result = await EpgProgram.bulkWrite(ops, { ordered: false });
      upsertedCount += (result.upsertedCount || 0) + (result.modifiedCount || 0);
    }

    return upsertedCount;
  }

  // ─── Query EPG for Channels ─────────────────────────────

  async getEpgForChannels(epgIds: string[], hours: number = 24): Promise<any[]> {
    const now = new Date();
    const endRange = new Date(now.getTime() + hours * 3600000);

    return EpgProgram.find({
      channelEpgId: { $in: epgIds },
      endTime: { $gte: now },
      startTime: { $lte: endRange },
    })
      // Guides and provider-issued tvgIds disagree on casing (beINSPORTS1.tr vs
      // beINSports1.tr) — match case-insensitively so the app guide fills in for
      // every channel whose tvgId matches a stored program id.
      .collation({ locale: 'en', strength: 2 })
      .sort({ channelEpgId: 1, startTime: 1 })
      .lean();
  }

  // ─── Generate XMLTV Output ──────────────────────────────

  generateXmltv(
    channels: Array<{ epgId: string; name: string; icon?: string }>,
    programs: any[],
  ): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<!DOCTYPE tv SYSTEM "xmltv.dtd">\n';
    xml += '<tv generator-info-name="DZ HOOF">\n';

    // Channel definitions
    for (const ch of channels) {
      xml += `  <channel id="${this.escapeXml(ch.epgId)}">\n`;
      xml += `    <display-name>${this.escapeXml(ch.name)}</display-name>\n`;
      if (ch.icon) {
        xml += `    <icon src="${this.escapeXml(ch.icon)}" />\n`;
      }
      xml += '  </channel>\n';
    }

    // Programme entries
    for (const prog of programs) {
      const start = this.formatXmltvDate(prog.startTime);
      const stop = this.formatXmltvDate(prog.endTime);

      xml += `  <programme start="${start}" stop="${stop}" channel="${this.escapeXml(prog.channelEpgId)}">\n`;
      xml += `    <title${prog.language ? ` lang="${this.escapeXml(prog.language)}"` : ''}>${this.escapeXml(prog.title)}</title>\n`;

      if (prog.description) {
        xml += `    <desc${prog.language ? ` lang="${this.escapeXml(prog.language)}"` : ''}>${this.escapeXml(prog.description)}</desc>\n`;
      }

      if (prog.category && prog.category.length > 0) {
        for (const cat of prog.category) {
          xml += `    <category>${this.escapeXml(cat)}</category>\n`;
        }
      }

      if (prog.icon) {
        xml += `    <icon src="${this.escapeXml(prog.icon)}" />\n`;
      }

      xml += '  </programme>\n';
    }

    xml += '</tv>\n';
    return xml;
  }

  // ─── Stats ──────────────────────────────────────────────

  async getCoverage(): Promise<EpgCoverageStats> {
    const [channels, programIds, sources] = await Promise.all([
      Channel.find({ ownerId: null }).select('channelId channelName tvgId metadata').lean(),
      EpgProgram.distinct('channelEpgId'),
      this.discoverEpgSources(),
    ]);
    const programIdSet = new Set(programIds.map((id: any) => String(id).toLowerCase()));
    const channelByIdentifier = new Map<string, any>();
    for (const channel of channels as any[]) {
      for (const identifier of [channel.tvgId, channel.channelId].filter(Boolean)) {
        channelByIdentifier.set(String(identifier).toLowerCase(), channel);
      }
    }

    const coverageSources = sources.map((source) => {
      const identifiers = [...new Set(source.coveredChannelIds.map((id) => String(id).trim().toLowerCase()))].filter(Boolean);
      const channelMatches = new Map<string, { channel: any; matched: boolean }>();
      for (const id of identifiers) {
        if (id === '*') continue;
        const channel = channelByIdentifier.get(id);
        if (!channel) continue;
        const key = String(channel._id || channel.channelId);
        const current = channelMatches.get(key);
        channelMatches.set(key, { channel, matched: Boolean(current?.matched || programIdSet.has(id)) });
      }
      const coveredChannels = identifiers.includes('*')
        ? (channels as any[]).map((channel) => ({
            channel,
            matched: [channel.tvgId, channel.channelId]
              .filter(Boolean)
              .some((id: any) => programIdSet.has(String(id).trim().toLowerCase())),
          }))
        : [...channelMatches.values()];
      const matchedChannels = coveredChannels.filter((entry) => entry.matched);
      const unmatchedChannels = coveredChannels
        .filter((entry) => !entry.matched)
        .slice(0, 100)
        .map(({ channel }) => ({
          channelId: String(channel.channelId),
          name: String(channel.channelName || ''),
          tvgId: channel.tvgId ? String(channel.tvgId) : null,
        }));
      return {
        source: source.source,
        coveredChannelCount: coveredChannels.length,
        matchedChannelCount: matchedChannels.length,
        coveragePercent: coveredChannels.length === 0 ? 0 : Math.round((matchedChannels.length / coveredChannels.length) * 100),
        unmatchedChannels,
      };
    });

    const matchedSystemChannels = channels.filter((channel: any) =>
      [channel.tvgId, channel.channelId].filter(Boolean).some((id: any) => programIdSet.has(String(id).toLowerCase())),
    ).length;
    const unmatchedChannelCount = Math.max(0, channels.length - matchedSystemChannels);

    return {
      totalSystemChannels: channels.length,
      matchedSystemChannels,
      overallCoveragePercent: channels.length === 0 ? 0 : Math.round((matchedSystemChannels / channels.length) * 100),
      unmatchedChannelCount,
      sources: coverageSources,
    };
  }

  async getStats(): Promise<EpgStats> {
    const [totalPrograms, distinctChannels, totalSystemChannels] = await Promise.all([
      EpgProgram.countDocuments(),
      EpgProgram.distinct('channelEpgId').then((ids) => ids.length),
      Channel.countDocuments(),
    ]);

    return {
      totalPrograms,
      channelsWithEpg: distinctChannels,
      totalSystemChannels,
      lastRefreshedAt: this.lastRefreshedAt,
      nextRefreshAt: this.lastRefreshedAt
        ? new Date(this.lastRefreshedAt.getTime() + EPG_REFRESH_INTERVAL)
        : null,
      sourcesDiscovered: this.lastSourceCount,
      refreshInProgress: this.refreshPromise !== null,
      lastRefreshDurationMs: this.lastRefreshDurationMs,
      lastRefreshProgramCount: this.lastRefreshProgramCount,
      lastRefreshErrorCount: this.lastRefreshErrorCount,
      lastRefreshErrorSources: this.lastRefreshErrorSources,
      memory: {
        heapUsedMb: heapUsedMb(),
        heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1048576),
        rssMb: rssMb(),
        concurrency: EPG_FETCH_CONCURRENCY,
        heapGuardMb: EPG_HEAP_GUARD_MB,
      },
    };
  }

  // ─── Helpers ────────────────────────────────────────────

  private parseXmltvDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    // Format: YYYYMMDDHHmmss +HHMM or YYYYMMDDHHmmss
    const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/);
    if (!match) return null;

    const [, year, month, day, hour, min, sec, tz] = match;
    let isoStr = `${year}-${month}-${day}T${hour}:${min}:${sec}`;

    if (tz) {
      const tzSign = tz[0];
      const tzHours = tz.slice(1, 3);
      const tzMinutes = tz.slice(3, 5);
      isoStr += `${tzSign}${tzHours}:${tzMinutes}`;
    } else {
      isoStr += 'Z';
    }

    const date = new Date(isoStr);
    return isNaN(date.getTime()) ? null : date;
  }

  private formatXmltvDate(date: Date | string): string {
    const d = new Date(date);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
      `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`
    );
  }

  private extractText(field: any): string {
    if (!field) return '';
    if (typeof field === 'string') return field;
    if (Array.isArray(field)) {
      const first = field[0];
      return typeof first === 'string' ? first : first?.['#text'] || '';
    }
    return field['#text'] || '';
  }

  private extractLang(field: any): string | null {
    if (!field) return null;
    if (Array.isArray(field)) {
      const first = field[0];
      return first?.['@_lang'] || null;
    }
    return field['@_lang'] || null;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

export const epgService = new EpgService();

module.exports = { epgService, EpgService };
