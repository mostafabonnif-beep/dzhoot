import axios from 'axios';
import http from 'http';
import https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { createGunzip } from 'zlib';
import EpgProgram from '../models/EpgProgram';
import M3USource from '../models/M3USource';
import { epgCache } from './cache';
import { decryptSecret } from '../utils/crypto';
import { createPinnedLookup, validateUrlForSSRF } from '../utils/ssrf-guard';
const Channel = require('../models/Channel');


const EPG_REFRESH_INTERVAL = parseInt(process.env.EPG_REFRESH_INTERVAL_MS || '21600000', 10); // 6 hours
const EPG_FETCH_CONCURRENCY = 5;
const BATCH_SIZE = 500;
const IPTV_EPG_BASE = 'https://iptv-epg.org/files';

interface EpgSourceInfo {
  url: string;
  coveredChannelIds: string[];
  source: string;
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
}

export class EpgService {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshPromise: Promise<void> | null = null;
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

      // 1. Discover what XMLTV files we need
      const sources = await this.discoverEpgSources();
      this.lastSourceCount = sources.length;

      if (sources.length === 0) {
        console.log('[epg-service] No EPG sources discovered for current channels');
        this.lastRefreshedAt = new Date();
        this.lastRefreshDurationMs = Date.now() - startTime;
        return;
      }

      console.log(`[epg-service] Discovered ${sources.length} EPG sources to fetch`);

      // 2. Fetch in parallel with concurrency limit
      let totalPrograms = 0;
      for (let i = 0; i < sources.length; i += EPG_FETCH_CONCURRENCY) {
        const batch = sources.slice(i, i + EPG_FETCH_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (source) => {
            try {
              const programs = await this.fetchAndParseXmltv(source.url, source.coveredChannelIds);
              if (programs.length > 0) {
                const count = await this.upsertPrograms(programs);
                return count;
              }
              return 0;
            } catch (err: any) {
              this.lastRefreshErrorCount += 1;
              if (this.lastRefreshErrorSources.length < 10) {
                this.lastRefreshErrorSources.push(source.source);
              }
              console.warn(`[epg-service] Failed to fetch ${source.source}: ${err.message}`);
              return 0;
            }
          }),
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            totalPrograms += result.value;
          }
        }
      }

      const durationMs = Date.now() - startTime;
      this.lastRefreshDurationMs = durationMs;
      this.lastRefreshProgramCount = totalPrograms;
      this.lastRefreshedAt = new Date();

      // Bust cached EPG responses AND the known-ids set — a refresh can introduce
      // programs for channelEpgIds the cached set would otherwise filter out.
      await epgCache.deletePattern('*');

      console.log(
        `[epg-service] EPG refresh complete: ${totalPrograms} programs upserted from ${sources.length} sources in ${durationMs}ms`,
      );
    } catch (err: any) {
      console.error('[epg-service] EPG refresh failed:', err.message);
      throw err;
    } finally {
      this.refreshPromise = null;
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

      // For iptv-org channels: extract country from channelId TLD
      const epgId = ch.tvgId || ch.channelId || '';
      const dotIdx = epgId.lastIndexOf('.');
      if (dotIdx > 0 && dotIdx < epgId.length - 1) {
        const country = epgId.substring(dotIdx + 1).toLowerCase();
        if (country.length === 2) {
          if (!countryToChannelIds.has(country)) {
            countryToChannelIds.set(country, []);
          }
          countryToChannelIds.get(country)!.push(epgId);
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
      const url = `${IPTV_EPG_BASE}/epg-${country}.xml.gz`;
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        sources.push({ url, coveredChannelIds: channelIds, source: 'iptv-epg.org' });
      }
    }

    return sources;
  }

  // ─── Fetch & Parse XMLTV ───────────────────────────────

  async fetchAndParseXmltv(url: string, coveredChannelIds: string[]): Promise<ParsedProgram[]> {
    const coveredSet = new Set(coveredChannelIds.map((id) => id.toLowerCase()));
    const isGzip = url.endsWith('.gz');

    // Stream the response to avoid holding compressed + decompressed buffers simultaneously
    const validation = await validateUrlForSSRF(url);
    if (!validation.safe || !validation.resolvedAddresses?.length) {
      throw new Error(`EPG URL rejected: ${validation.reason || 'unsafe URL'}`);
    }

    const parsedUrl = new URL(url);
    const lookup = createPinnedLookup(validation.resolvedAddresses);
    const agent = parsedUrl.protocol === 'https:'
      ? new https.Agent({ lookup: lookup as any })
      : new http.Agent({ lookup: lookup as any });

    const response = await axios.get(url, {
      timeout: 120000,
      responseType: 'stream',
      maxContentLength: 100 * 1024 * 1024,
      maxBodyLength: 100 * 1024 * 1024,
      maxRedirects: 0,
      httpAgent: parsedUrl.protocol === 'http:' ? agent : undefined,
      httpsAgent: parsedUrl.protocol === 'https:' ? agent : undefined,
      headers: { 'User-Agent': 'FireVision IPTV/1.0' },
    });

    const xmlData = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      const maxSize = 200 * 1024 * 1024; // 200MB decompressed limit

      let stream = response.data;
      if (isGzip) {
        const gunzip = createGunzip();
        stream = stream.pipe(gunzip);
        gunzip.on('error', reject);
      }

      stream.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          stream.destroy(new Error('EPG XML exceeds maximum decompressed size (200MB)'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
      response.data.on('error', reject);
    });

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => name === 'programme' || name === 'channel' || name === 'category',
    });

    const parsed = parser.parse(xmlData);
    const tv = parsed.tv || parsed['!xml']?.tv || parsed;
    const programmes = tv?.programme || [];

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
    xml += '<tv generator-info-name="FireVision IPTV">\n';

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
      const identifiers = [...new Set(source.coveredChannelIds.map((id) => String(id).toLowerCase()))];
      const matchedIdentifiers = identifiers.filter((id) => programIdSet.has(id));
      const unmatchedChannels = identifiers
        .filter((id) => !programIdSet.has(id))
        .map((id) => channelByIdentifier.get(id))
        .filter(Boolean)
        .slice(0, 100)
        .map((channel: any) => ({
          channelId: String(channel.channelId),
          name: String(channel.channelName || ''),
          tvgId: channel.tvgId ? String(channel.tvgId) : null,
        }));
      return {
        source: source.source,
        coveredChannelCount: identifiers.length,
        matchedChannelCount: matchedIdentifiers.length,
        coveragePercent: identifiers.length === 0 ? 0 : Math.round((matchedIdentifiers.length / identifiers.length) * 100),
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
