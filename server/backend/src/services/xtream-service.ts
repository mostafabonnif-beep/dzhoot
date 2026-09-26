import axios from 'axios';
import { clearChannelGateCache } from './channel-gate-cache';
import http from 'http';
import https from 'https';
import mongoose from 'mongoose';
import XtreamSource from '../models/XtreamSource';
import Channel from '../models/Channel';
import Movie from '../models/Movie';
import Series from '../models/Series';
import Season from '../models/Season';
import Episode from '../models/Episode';
import { encryptSecret, decryptSecret } from '../utils/crypto';
import { decideCatalogPrune, DEFAULT_PRUNE_MIN_RATIO } from './catalog-prune-guard';
import { syncFamilyPlan } from './source-eligibility';
import { createPinnedLookup, validateUrlForSSRF } from '../utils/ssrf-guard';
import { redactSensitiveText } from './audit-log';
import { reconcileChannelIdentities } from './channel-identity-service';
import { createSyncPreview, markSnapshotApplied } from './sync-snapshot-service';
import { probeStream, type ProbeResult } from './stream-prober';
import { channelCache } from './cache';
import ChannelFailoverMap from '../models/ChannelFailoverMap';
import {
  channelCanonicalKey,
  cleanChannelName,
  channelVariantRank,
} from './source-failover-service';
// Customer-facing cleaner: strips provider decoration (ᴿᴬᵂ, wrappers, country
// prefixes) so synced catalogs stay professional no matter how the upstream
// panel names its streams. Applied at IMPORT time so every scheduled sync
// re-persists already-clean names instead of re-dirtying operator curation.
import { cleanDisplayChannelName } from '../utils/catalog-name-cleaner';
// isForeignCatalogChannel is exported at runtime (module.exports) but not as a
// TS export — pull it via require alongside the typed imports above.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isForeignCatalogChannel, tokenize, nameMatchScore, fuzzyAccepted } = require('./source-failover-service');

// ── Customer-list stability fingerprint ────────────────────────────────────
// Merge-on-sync promises the operator that syncing a new source never
// reshuffles the customer list: existing channels are only ever mapped to
// failover backups, never edited. To PROVE it, we fingerprint the shared
// catalog (the exact order customers see in M3U/TV: group asc, order asc,
// channelId asc) before and after the sync and record both hashes.
import { createHash } from 'crypto';

export async function snapshotCatalogFingerprint(): Promise<{ count: number; fingerprint: string }> {
  const docs = await Channel.find({
    ownerId: null,
    isActive: { $ne: false },
  })
    .select('channelGroup order channelId channelName')
    .sort({ channelGroup: 1, order: 1, channelId: 1 })
    .lean()
    .exec();
  const hash = createHash('sha256');
  for (const d of docs) {
    hash.update(`${String(d.channelGroup || '')}\u0001${Number(d.order) || 0}\u0001${String(d.channelId || '')}\u0001${String(d.channelName || '')}\u0001`);
  }
  return { count: docs.length, fingerprint: hash.digest('hex') };
}

async function recordStabilityReport(
  source: any,
  before: { count: number; fingerprint: string },
  after: { count: number; fingerprint: string },
  matched: number,
): Promise<void> {
  const report = {
    at: new Date(),
    beforeCount: before.count,
    afterCount: after.count,
    added: Math.max(0, after.count - before.count),
    matched,
    listUnchanged: before.fingerprint === after.fingerprint && before.count === after.count,
    fingerprintBefore: before.fingerprint,
    fingerprintAfter: after.fingerprint,
  };
  source.stabilityReport = report;
  const history = Array.isArray(source.stabilityHistory) ? source.stabilityHistory : [];
  history.unshift({ ...report });
  source.stabilityHistory = history.slice(0, 10);
  await source.save();
  console.log(`[xtream] stability report for ${String(source.name)}: unchanged=${report.listUnchanged} added=${report.added} matched=${matched}`);
}

/**
 * Merge-on-sync: index existing catalog channels (from OTHER sources) by
 * canonical key and cleaned name so a mergeCatalog source can attach itself
 * as a failover backup instead of duplicating the channel in the list.
 */
interface CatalogMatchIndex {
  byCanonical: Map<string, any[]>;
  byCleanName: Map<string, any[]>;
  byToken: Map<string, Array<{ cleanedName: string; chans: any[] }>>;
}
function buildCatalogMatchIndex(catalogChannels: any[]): CatalogMatchIndex {
  const byCanonical = new Map<string, any[]>();
  const byCleanName = new Map<string, any[]>();
  const byToken = new Map<string, Array<{ cleanedName: string; chans: any[] }>>();
  const push = (map: Map<string, any[]>, key: string, channel: any) => {
    const list = map.get(key);
    if (list) list.push(channel);
    else map.set(key, [channel]);
  };
  for (const channel of catalogChannels) {
    const name = String(channel?.channelName || '');
    if (!name || isForeignCatalogChannel(name)) continue;
    const ck = channelCanonicalKey(name);
    if (ck) push(byCanonical, ck, channel);
    const cn = cleanChannelName(name).toLowerCase();
    if (cn) {
      push(byCleanName, cn, channel);
      // Token index for the fuzzy fallback (same scoring as autoMatch).
      for (const token of tokenize(cn)) {
        if (!byToken.has(token)) byToken.set(token, []);
        byToken.get(token)!.push({ cleanedName: cn, chans: [channel] });
      }
    }
  }
  return { byCanonical, byCleanName, byToken };
}
function matchCatalogChannel(item: any, index: CatalogMatchIndex): any | null {
  const name = String(item?.name || '').trim();
  if (!name) return null;
  const ck = channelCanonicalKey(name);
  let candidates = ck ? index.byCanonical.get(ck) : undefined;
  if (!candidates || candidates.length === 0) {
    candidates = index.byCleanName.get(cleanChannelName(name).toLowerCase());
  }
  // Fuzzy fallback: shared-token candidates scored with the same
  // typo-tolerant matcher used by autoMatchFailoverMaps — catches
  // 'ENTV' vs 'AR: ENTV 1 FULL HD' gaps that canonical keys miss.
  if (!candidates || candidates.length === 0) {
    const cleaned = cleanChannelName(name);
    const tokens = tokenize(cleaned);
    const candidateChans = new Map<string, any[]>();
    for (const token of tokens) {
      for (const cand of index.byToken.get(token) || []) {
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
    if (best && fuzzyAccepted(cleaned, best[0]?.channelName ? cleanChannelName(best[0].channelName) : '')) {
      candidates = best;
    }
  }
  if (!candidates || candidates.length === 0) return null;
  // Prefer the base variant over +6H / LQ / RAW / SD clones.
  return [...candidates].sort(
    (a, b) => channelVariantRank(a.channelName || '') - channelVariantRank(b.channelName || ''),
  )[0];
}
async function upsertMergeFailoverMap(
  existingChannel: any,
  sourceId: mongoose.Types.ObjectId,
  item: any,
  priority: number,
): Promise<void> {
  await ChannelFailoverMap.findOneAndUpdate(
    { channelRef: String(existingChannel.channelId), backupSourceId: sourceId },
    {
      $set: {
        channelId: existingChannel._id,
        backupChannelName: String(item?.name || '').trim(),
        backupStreamId: String(item?.stream_id ?? '').trim(),
        matchedBy: 'name',
        enabled: true,
        priority: Number(priority) || 20,
      },
    },
    { upsert: true, new: true },
  ).exec();
}

const API_TIMEOUT_MS = 30000;

/**
 * Panels count connections per source IP: the second concurrent request from one
 * IP is rejected with HTTP 407 and the third with 405 (measured in production
 * 2026-09-21, re-confirmed 2026-09-26). `syncXtreamSource` issues six
 * `player_api.php` calls, so a bare `Promise.all` made the sync race against
 * itself — and against the source watchdog and playback — for the same panel
 * seat, which surfaced as `lastError: "HTTP 407"` and an Inactive source.
 *
 * Fix: serialise outbound panel requests per origin, FIFO, one in flight at a
 * time. Different panels still run in parallel because the queue is keyed by
 * origin. Each request already carries its own timeout, so a stuck call cannot
 * wedge the queue forever.
 */
const panelQueues = new Map<string, Promise<unknown>>();

function runOnPanelQueue<T>(origin: string, task: () => Promise<T>): Promise<T> {
  const previous = panelQueues.get(origin) ?? Promise.resolve();
  // `then(task, task)` runs the task whether the previous one resolved or rejected,
  // so one failed call can never cancel the calls queued behind it.
  const current = previous.then(task, task);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  panelQueues.set(origin, tail);
  // Drop the entry once this chain is the last one, so the map cannot grow with
  // every panel ever contacted.
  void tail.then(() => {
    if (panelQueues.get(origin) === tail) panelQueues.delete(origin);
  });
  return current;
}

async function safeAxiosGet(url: string) {
  const validation = await validateUrlForSSRF(url);
  if (!validation.safe || !validation.resolvedAddresses?.length) {
    throw new Error(`Xtream URL rejected: ${validation.reason || 'unsafe URL'}`);
  }

  const parsed = new URL(url);
  const lookup = createPinnedLookup(validation.resolvedAddresses);
  const agent = parsed.protocol === 'https:'
    ? new https.Agent({ lookup: lookup as any })
    : new http.Agent({ lookup: lookup as any });

  return runOnPanelQueue(parsed.origin, () => axios.get(url, {
    timeout: API_TIMEOUT_MS,
    maxRedirects: 0,
    httpAgent: parsed.protocol === 'http:' ? agent : undefined,
    httpsAgent: parsed.protocol === 'https:' ? agent : undefined,
    validateStatus: (status) => status >= 200 && status < 300,
  }));
}

/**
 * Xtream Codes API integration.
 * player_api.php is the well-known endpoint exposed by Xtream Codes panels:
 *   GET {server}/player_api.php?username=U&password=P&action=...
 */

export interface XtreamCredentials {
  serverUrl: string;
  username: string;
  password: string;
  /** Alternate panel domains for the same account — tried after serverUrl. */
  mirrorServerUrls?: string[];
}

/** [primary, ...mirrors] — normalized (no trailing slash), de-duplicated. */
export function endpointCandidates(creds: XtreamCredentials): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [creds.serverUrl, ...(creds.mirrorServerUrls || [])]) {
    const base = String(raw || '').trim().replace(/\/+$/, '');
    if (!base || seen.has(base)) continue;
    seen.add(base);
    out.push(base);
  }
  return out;
}

/**
 * Rewrite the origin (scheme+host+port) of a stream URL to another panel
 * domain, keeping the path and query intact. Used for mirror fallback: the
 * same panel account serves the same stream id on both domains.
 */
export function rewriteStreamUrlBase(streamUrl: string, newBase: string): string | null {
  try {
    const u = new URL(streamUrl);
    const b = new URL(newBase.replace(/\/+$/, ''));
    u.protocol = b.protocol;
    u.host = b.host;
    u.port = b.port;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * The panel's HLS rendition of the same live stream id.
 *
 * An Xtream panel serves one stream id in several containers, and a given id frequently works in
 * one and fails in the other. Measured on production 2026-09-21 (issue #360):
 *
 *   .../live/USER/PASS/297641.ts    -> sometimes HTTP 200 with an entirely empty body
 *   .../live/USER/PASS/297641.m3u8  -> a valid 169-byte media playlist
 *
 * and the panel advertised `allowed_output_formats: [m3u8, ts, rtmp]`. Playback handed the `.ts`
 * URL to the customer, who got a black screen that never errors: a valid-looking 200 arrived
 * through the direct redirect AND through the server relay, because both fetch the same upstream.
 *
 * Returns null when [streamUrl] is not a `.ts` live URL, so callers can treat "no twin" as
 * "leave the URL alone". The query string is preserved verbatim — panels keep tokens and output
 * flags there — by rebuilding the string rather than reparsing it through `URL`.
 *
 * The health pipeline's bidirectional `.ts` <-> `.m3u8` swap lives in
 * `services/stream-health-service.ts` (`siblingStreamUrl`); this one is the one-way playback-side
 * twin, which is why it is not shared.
 */
export function hlsTwinStreamUrl(streamUrl: string | null | undefined): string | null {
  if (!streamUrl || typeof streamUrl !== 'string') return null;

  const queryIndex = streamUrl.search(/[?#]/);
  const base = queryIndex === -1 ? streamUrl : streamUrl.slice(0, queryIndex);
  const suffix = queryIndex === -1 ? '' : streamUrl.slice(queryIndex);

  if (!/\.ts$/i.test(base)) return null;
  return `${base.slice(0, -3)}.m3u8${suffix}`;
}

export function buildXtreamApiUrl(
  creds: XtreamCredentials,
  action?: string,
  extra: Record<string, string | number> = {},
): string {
  const base = creds.serverUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ username: creds.username, password: creds.password });
  if (action) params.set('action', action);
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return `${base}/player_api.php?${params.toString()}`;
}

async function apiGet(creds: XtreamCredentials, action?: string, extra: Record<string, string | number> = {}) {
  // Mirror fallback: try the primary panel domain first, then each mirror.
  // A dead primary must not break sync/verification when a mirror is up.
  const endpoints = endpointCandidates(creds);
  let lastError: unknown = null;
  for (const base of endpoints) {
    try {
      const res = await safeAxiosGet(buildXtreamApiUrl({ ...creds, serverUrl: base }, action, extra));
      return res.data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('apiGet: no reachable endpoint');
}

/** Verify credentials: player_api.php without action returns user_info/server_info. */
export async function testXtreamConnection(creds: XtreamCredentials) {
  const data = await apiGet(creds);
  const auth = data?.user_info?.auth === 1;
  return {
    ok: auth,
    userInfo: auth ? data.user_info : null,
    serverInfo: auth ? data.server_info : null,
    error: auth ? null : 'Authentication failed',
  };
}

export type XtreamPlaybackFormat = 'm3u8' | 'ts';
type XtreamProbeFormat = XtreamPlaybackFormat | 'direct';

export interface XtreamDiagnostics {
  api: { ok: boolean; error: string | null; auth: number | null; status: string | null };
  server: {
    url: string | null;
    protocol: string | null;
    port: string | null;
    httpsPort: string | null;
    rtmpPort: string | null;
  };
  m3u: { status: 'not-tested' | 'alive' | 'dead'; statusCode: number | null; error: string | null };
  live: {
    tested: number;
    alive: number;
    dead: number;
    playbackFormat: XtreamProbeFormat | null;
    samples: Array<{
      streamId: string;
      format: XtreamProbeFormat;
      status: ProbeResult['status'];
      statusCode: number | null;
      error: string | null;
      responseTimeMs: number;
    }>;
  };
  /**
   * On-demand health, measured separately from `live` on purpose. A provider can stop
   * serving live channels (or fail its panel probe) while its VOD endpoints keep
   * answering normally — measured in production on 2026-09-25, when one source's live
   * channels were down and the single live verdict delisted all 17,176 movies in the
   * customer catalog. Deciding VOD from a VOD probe is what makes that impossible.
   *
   * Sample URLs are never stored: a VOD URL embeds the panel credentials
   * (`/movie/<user>/<pass>/<id>.mkv`) and `lastDiagnostics` is persisted and shown in
   * the admin panel, so only the outcome is recorded.
   */
  vod: {
    tested: number;
    alive: number;
    dead: number;
    samples: Array<{
      index: number;
      status: ProbeResult['status'];
      statusCode: number | null;
      error: string | null;
      responseTimeMs: number;
    }>;
  };
}

/**
 * Diagnose a source without importing it. This deliberately separates API
 * metadata from actual playback so an account that only lists channels is not
 * presented as a working source to the customer.
 */
export async function diagnoseXtreamSource(
  creds: XtreamCredentials,
  sampleLimit = 3,
  options: { vodSampleUrls?: string[] } = {},
): Promise<XtreamDiagnostics> {
  const result: XtreamDiagnostics = {
    api: { ok: false, error: null, auth: null, status: null },
    server: { url: null, protocol: null, port: null, httpsPort: null, rtmpPort: null },
    m3u: { status: 'not-tested', statusCode: null, error: null },
    live: { tested: 0, alive: 0, dead: 0, playbackFormat: null, samples: [] },
    vod: { tested: 0, alive: 0, dead: 0, samples: [] },
  };

  try {
    const auth = await testXtreamConnection(creds);
    result.api = {
      ok: auth.ok,
      error: auth.error,
      auth: auth.userInfo?.auth ?? null,
      status: auth.userInfo?.status ?? null,
    };
    result.server = {
      url: auth.serverInfo?.url ? String(auth.serverInfo.url) : null,
      protocol: auth.serverInfo?.server_protocol ? String(auth.serverInfo.server_protocol) : null,
      port: auth.serverInfo?.port ? String(auth.serverInfo.port) : null,
      httpsPort: auth.serverInfo?.https_port ? String(auth.serverInfo.https_port) : null,
      rtmpPort: auth.serverInfo?.rtmp_port ? String(auth.serverInfo.rtmp_port) : null,
    };
    if (!auth.ok) return result;

    const m3uProbe = await probeStream(m3uUrl(creds), { timeout: 12000 });
    result.m3u = {
      status: m3uProbe.status,
      statusCode: m3uProbe.statusCode,
      error: m3uProbe.error,
    };

    const streams = await apiGet(creds, 'get_live_streams');
    const samples = Array.isArray(streams) ? streams.slice(0, Math.max(1, Math.min(sampleLimit, 10))) : [];
    for (const item of samples) {
      const streamId = String(item?.stream_id ?? '');
      if (!streamId) continue;

      let selectedFormat: XtreamProbeFormat = 'm3u8';
      let probe: ProbeResult | null = null;
      const directSource = directSourceUrl(item);
      if (directSource) {
        selectedFormat = 'direct';
        probe = await probeStream(directSource, { timeout: 12000 });
      }
      if (!probe || probe.status !== 'alive') {
        for (const format of ['m3u8', 'ts'] as const) {
          selectedFormat = format;
          probe = await probeStream(liveUrl(creds, streamId, format), { timeout: 12000 });
          if (probe.status === 'alive') break;
        }
      }
      if (!probe) continue;

      result.live.tested += 1;
      if (probe.status === 'alive') {
        result.live.alive += 1;
        result.live.playbackFormat ??= selectedFormat;
      } else result.live.dead += 1;
      result.live.samples.push({
        streamId,
        format: selectedFormat,
        status: probe.status,
        statusCode: probe.statusCode,
        error: probe.error,
        responseTimeMs: probe.responseTimeMs,
      });
    }
  } catch (error: any) {
    result.api.error = error?.response?.status ? `HTTP ${error.response.status}` : String(error?.message || 'Diagnostics failed');
  }

  // VOD probe: independent of the live result above, and never fatal to it.
  const vodUrls = (options.vodSampleUrls || []).slice(0, Math.max(1, Math.min(sampleLimit, 10)));
  for (const [index, url] of vodUrls.entries()) {
    try {
      const probe = await probeStream(url, { timeout: 12000 });
      result.vod.tested += 1;
      if (probe.status === 'alive') result.vod.alive += 1;
      else result.vod.dead += 1;
      result.vod.samples.push({
        index,
        status: probe.status,
        statusCode: probe.statusCode,
        error: probe.error,
        responseTimeMs: probe.responseTimeMs,
      });
    } catch (error) {
      result.vod.tested += 1;
      result.vod.dead += 1;
      result.vod.samples.push({
        index,
        status: 'dead',
        statusCode: null,
        error: String((error as Error)?.message || 'VOD probe failed'),
        responseTimeMs: 0,
      });
    }
  }

  return result;
}

/**
 * Up to `limit` on-demand stream URLs for a source, in a stable order.
 *
 * Probe input only: the caller must never persist these. A VOD URL carries the panel
 * credentials in its path, and `lastDiagnostics` is stored and rendered in the panel.
 */
async function sampleVodStreamUrls(sourceId: unknown, limit = 3): Promise<string[]> {
  const rows = await Movie.find({ sourceId, isActive: true, streamUrl: { $ne: null } })
    .select('streamUrl')
    .limit(Math.max(1, limit))
    .lean()
    .exec();
  return rows.map((row) => String((row as { streamUrl?: string })?.streamUrl || '')).filter(Boolean);
}

/**
 * Live probes per verification.
 *
 * Two probes across a 26,000-channel panel is a coin toss, and a wrong verdict is expensive: on
 * 2026-09-25 a source with half its channels actually playing (3 of 6 probes answered with real
 * bytes) was judged dead from a two-probe sample, and that `Inactive` verdict is what kept its
 * 25,960 live channels and 84,545 movies out of sync. A few extra probes in a background task
 * make the verdict describe the panel instead of the draw.
 */
export const DEFAULT_VERIFY_SAMPLE_LIMIT = 6;

export function verifySampleLimit(): number {
  const raw = Number(process.env.XTREAM_VERIFY_SAMPLE_LIMIT);
  return Number.isFinite(raw) && raw >= 1 && raw <= 25 ? Math.floor(raw) : DEFAULT_VERIFY_SAMPLE_LIMIT;
}

export async function verifyXtreamSource(sourceId: string, sampleLimit = 3) {
  const source = await XtreamSource.findById(sourceId).exec();
  if (!source) throw new Error('Source not found');

  const vodSampleUrls = await sampleVodStreamUrls(source._id, sampleLimit);
  const diagnostics = await diagnoseXtreamSource({
    serverUrl: source.serverUrl,
    mirrorServerUrls: source.mirrorServerUrls || [],
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  }, sampleLimit, { vodSampleUrls });

  const now = new Date();
  const liveAvailable = diagnostics.live.alive > 0;
  const apiAvailable = diagnostics.api.ok;
  const verified = apiAvailable && liveAvailable;
  const verificationStatus = verified ? 'verified' : apiAvailable ? 'degraded' : 'blocked';
  // A source with no on-demand titles keeps `pending`: “we could not test VOD” and
  // “VOD is broken” are different claims, and only the second may close a gate.
  const vodVerificationStatus = diagnostics.vod.tested === 0
    ? 'pending'
    : diagnostics.vod.alive > 0
      ? 'verified'
      : 'blocked';
  const error = verified
    ? null
    : diagnostics.api.error || (diagnostics.live.tested > 0 ? 'No tested live stream is playable' : 'No live stream could be verified');
  // The provider's M3U export is optional for this platform (we relay live streams ourselves and
  // never consume the panel's M3U endpoint). Reporting its absence through `lastError` made a
  // perfectly healthy source read as broken in the panel — measured 2026-09-21, when the operator
  // reported "the neo 4k source is not working" while live playback answered 200 in ~160ms.
  const warning =
    verified && diagnostics.m3u.status === 'dead'
      ? 'Live playback works; the provider does not expose its M3U export (not used by this platform)'
      : null;

  source.verificationStatus = verificationStatus;
  source.vodVerificationStatus = vodVerificationStatus;
  source.status = verified ? 'Active' : 'Inactive';
  source.lastDiagnosticsAt = now;
  source.lastDiagnostics = diagnostics as unknown as Record<string, unknown>;
  source.lastError = error;
  source.lastWarning = warning;
  source.playbackFormat = verified && diagnostics.live.playbackFormat !== 'direct'
    ? diagnostics.live.playbackFormat
    : null;
  if (verified) source.verifiedAt = now;
  await source.save();

  // Verification changes whether shared catalog cache may expose these channels.
  await channelCache.deletePattern('catalog:*');

  return {
    ...diagnostics,
    decision: {
      verificationStatus,
      vodVerificationStatus,
      status: source.status,
      verified,
      reason: error,
      // The per-family import plan, so scheduled callers do not have to re-derive it (and cannot
      // drift from the gate inside syncXtreamSource).
      families: syncFamilyPlan({
        status: source.status,
        verificationStatus,
        vodVerificationStatus,
        customerVisible: source.customerVisible,
        directPlayback: source.directPlayback,
      }),
    },
  };
}

function toStringOrEmpty(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(' ');
  return String(value || '').trim();
}

/** Customer-facing cleaner with a safe fallback (never returns empty for a non-empty input). */
function cleanDisplay(value: unknown, fallback = 'Uncategorized'): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const cleaned = cleanDisplayChannelName(raw);
  return cleaned || raw;
}

function iconUrl(value: unknown): string {
  // Some panels return stream_icon as an array of URLs for VOD/Series.
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function getContainerExt(item: any): string {
  const ext = item?.container_extension || 'm3u8';
  return String(ext).replace(/^\./, '');
}

function directSourceUrl(item: any): string | null {
  const candidate = typeof item?.direct_source === 'string' ? item.direct_source.trim() : '';
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}

function liveUrl(creds: XtreamCredentials, streamId: string | number, format: XtreamPlaybackFormat = 'm3u8'): string {
  return `${creds.serverUrl.replace(/\/+$/, '')}/live/${creds.username}/${creds.password}/${streamId}.${format}`;
}

function resolvedLiveUrl(creds: XtreamCredentials, item: any, playbackFormat: XtreamPlaybackFormat = 'm3u8'): string {
  return directSourceUrl(item) || liveUrl(creds, item.stream_id, playbackFormat);
}

function m3uUrl(creds: XtreamCredentials): string {
  const base = creds.serverUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ username: creds.username, password: creds.password, type: 'm3u_plus', output: 'ts' });
  return `${base}/get.php?${params.toString()}`;
}

function vodUrl(creds: XtreamCredentials, streamId: string | number, ext: string): string {
  return `${creds.serverUrl.replace(/\/+$/, '')}/movie/${creds.username}/${creds.password}/${streamId}.${ext}`;
}

function episodeUrl(creds: XtreamCredentials, episodeId: string | number, ext: string): string {
  return `${creds.serverUrl.replace(/\/+$/, '')}/series/${creds.username}/${creds.password}/${episodeId}.${ext}`;
}

/** Default timeshift window assumed for Xtream channels (days). */
const XTREAM_TIMESHIFT_DAYS = Number(process.env.XTREAM_TIMESHIFT_DAYS) || 3;

/**
 * Take over a channel left pointing at a source row that no longer exists.
 *
 * The document is updated in place: `_id`, identities, EPG links, group and order all stay;
 * only the ownership (channelId + source id + live URL) moves to the source that actually
 * serves the stream. That is the difference between a hidden channel and a playable one — the
 * catalog visibility gate hides channels whose xtream source is missing, so without this a
 * re-registered provider leaves its whole catalog invisible while its panel is perfectly
 * healthy (16.7k channels in production on 2026-09-21).
 */
async function adoptOrphanedChannel(
  existing: any,
  sourceId: mongoose.Types.ObjectId,
  item: any,
  group: string,
  creds: XtreamCredentials,
  playbackFormat: XtreamPlaybackFormat = 'm3u8',
) {
  const channelId = `xt:${String(sourceId)}:${item.stream_id}`;
  const rawName = String(item.name || existing.channelName || `Channel ${item.stream_id}`).trim();
  const updated = await Channel.findOneAndUpdate(
    { _id: existing._id },
    {
      $set: {
        channelId,
        channelName: cleanDisplay(rawName, rawName),
        channelUrl: resolvedLiveUrl(creds, item, playbackFormat),
        channelImg: iconUrl(item.stream_icon),
        channelGroup: cleanDisplay(group),
        'metadata.providerName': rawName,
        'metadata.source': 'xtream',
        'metadata.xtreamSourceId': String(sourceId),
        'metadata.xtreamStreamId': Number(item.stream_id),
        isActive: true,
        'catchup.type': 'timeshift',
        'catchup.days': XTREAM_TIMESHIFT_DAYS,
      },
    },
    { new: true },
  ).exec();
  // Same EPG rule as upsertChannel: fill a blank tvgId, never overwrite the operator's.
  const providerTvgId = String(item.epg_channel_id || '').trim();
  if (providerTvgId && updated && !String((updated as any).tvgId || '').trim()) {
    (updated as any).tvgId = providerTvgId;
    await (updated as any).save();
  }
  return updated;
}

async function upsertChannel(sourceId: mongoose.Types.ObjectId, item: any, group: string, creds: XtreamCredentials, playbackFormat: XtreamPlaybackFormat = 'm3u8') {
  const channelId = `xt:${String(sourceId)}:${item.stream_id}`;
  const rawName = String(item.name || `Channel ${item.stream_id}`).trim();
  const update: Record<string, any> = {
    $set: {
      channelId,
      channelName: cleanDisplay(rawName, rawName),
      channelUrl: resolvedLiveUrl(creds, item, playbackFormat),
      channelImg: iconUrl(item.stream_icon),
      channelGroup: cleanDisplay(group),
      // Provider's original name kept for reference / re-import diagnosis; the
      // customer-facing channelName above is always the cleaned display name.
      'metadata.providerName': rawName,
      // tvgId is set ONLY on INSERT ($setOnInsert) and never overwritten by a
      // sync: operator-assigned tvgIds (which may point at a better guide than
      // the provider's epg_channel_id, e.g. epgshare TR1 real schedules vs
      // iptv-org "No Data" placeholders) must survive scheduled syncs. New
      // channels still inherit the provider's epg_channel_id on first import.
      tvgName: rawName,
      isActive: true,
      order: Number(item.num) || 0,
      'metadata.source': 'xtream',
      'metadata.xtreamSourceId': String(sourceId),
      'metadata.xtreamStreamId': Number(item.stream_id),
      // Xtream panels expose catch-up via the /timeshift/ endpoint — flag it
      // so clients know this channel can play past programs.
      'catchup.type': 'timeshift',
      'catchup.days': XTREAM_TIMESHIFT_DAYS,
    },
    $setOnInsert: { tvgId: String(item.epg_channel_id || '').trim() },
  };
  const channel = await Channel.findOneAndUpdate(
    { ownerId: null, channelId },
    update,
    { upsert: true, setDefaultsOnInsert: true, new: true },
  ).exec();
  // Backfill only when still empty: the provider's epg_channel_id is the EPG
  // lifeline for xtream channels — without it the channel is guide-less. Never
  // overwrites an operator-assigned tvgId (only fills blank ones).
  const providerTvgId = String(item.epg_channel_id || '').trim();
  if (providerTvgId && channel && !String((channel as any).tvgId || '').trim()) {
    (channel as any).tvgId = providerTvgId;
    await (channel as any).save();
  }
  return channel;
}

async function upsertMovie(sourceId: mongoose.Types.ObjectId, item: any, group: string, creds: XtreamCredentials) {
  const ext = getContainerExt(item);
  return Movie.findOneAndUpdate(
    { sourceId, externalId: String(item.stream_id) },
    {
      $set: {
        title: String(item.name || `Movie ${item.stream_id}`).trim(),
        category: cleanDisplay(group),
        poster: iconUrl(item.stream_icon),
        backdrop: '',
        description: toStringOrEmpty(item.plot || item.description),
        year: item.year ? Number(item.year) : null,
        duration: item.duration ? Number(item.duration) : null,
        rating: item.rating_5based ? Number(item.rating_5based) : null,
        streamUrl: vodUrl(creds, item.stream_id, ext),
        containerExtension: ext,
      },
      // Only default to active on INSERT. On update, an existing isActive=false
      // (manual admin disable OR a previous prune) is preserved so neither an
      // accidental sync nor routine pruning silently resurrects content the
      // operator deliberately hid.
      $setOnInsert: { isActive: true },
    },
    { upsert: true, setDefaultsOnInsert: true },
  ).exec();
}

async function upsertSeries(sourceId: mongoose.Types.ObjectId, item: any, group: string) {
  return Series.findOneAndUpdate(
    { sourceId, externalId: String(item.series_id) },
    {
      $set: {
        title: String(item.name || `Series ${item.series_id}`).trim(),
        category: cleanDisplay(group),
        poster: item.cover || '',
        backdrop: iconUrl(item.backdrop_path),
        plot: item.plot || '',
        cast: Array.isArray(item.cast) ? item.cast.join(', ') : String(item.cast || ''),
        director: item.director || '',
        genre: item.genre || '',
        releaseDate: item.releaseDate || '',
        rating: item.rating_5based ? Number(item.rating_5based) : null,
      },
      // Only default to active on INSERT (same rationale as upsertMovie).
      $setOnInsert: { isActive: true },
    },
    { upsert: true, setDefaultsOnInsert: true },
  ).exec();
}

/** Fetch + store seasons and episodes for one series. */
async function syncSeriesEpisodes(sourceId: mongoose.Types.ObjectId, seriesDoc: any, creds: XtreamCredentials) {
  try {
    const info = await apiGet(creds, 'get_series_info', { series_id: seriesDoc.externalId });

    // Xtream Codes standard format: `seasons` carries season METADATA only
    // (episode_count, cover, ...), while the actual episodes live in a DICT
    // `episodes` keyed by season number ({ "1": [...], "2": [...] }). Some
    // panels embed an `episodes` array inside each season object instead, and
    // some (Upstream included) return an EMPTY seasons array while the episodes
    // dict is populated. The previous parser read only `seasons[].episodes`,
    // so it imported zero episodes for the standard format — leaving the whole
    // catalog with 0 playable episodes. Parse all three shapes: union the
    // season numbers from both places, then prefer the dict (fall back to the
    // embedded array).
    const seasonsRaw: any[] = Array.isArray(info?.seasons) ? info.seasons : [];
    const episodesDict: Record<string, any[]> =
      info?.episodes && typeof info.episodes === 'object' && !Array.isArray(info.episodes)
        ? info.episodes
        : {};

    const seasonNumbers = new Set<number>();
    for (const s of seasonsRaw) seasonNumbers.add(Number(s?.season_number) || 0);
    for (const key of Object.keys(episodesDict)) {
      if (Array.isArray(episodesDict[key])) seasonNumbers.add(Number(key) || 0);
    }

    for (const seasonNumber of seasonNumbers) {
      const meta =
        seasonsRaw.find((s) => (Number(s?.season_number) || 0) === seasonNumber) || {};
      const season = await Season.findOneAndUpdate(
        { seriesId: seriesDoc._id, seasonNumber },
        {
          $set: {
            name: String(meta.name || `Season ${seasonNumber}`),
            cover: meta.cover || '',
          },
        },
        { upsert: true, setDefaultsOnInsert: true, new: true },
      ).exec();

      const embedded = Array.isArray(meta.episodes) ? meta.episodes : [];
      const episodes =
        embedded.length > 0
          ? embedded
          : Array.isArray(episodesDict[String(seasonNumber)])
            ? episodesDict[String(seasonNumber)]
            : [];
      for (const ep of episodes) {
        if (!ep?.id) continue;
        try {
          const ext = ep.container_extension || 'm3u8';
          // Panels emit duration as free text ("45 min", "01:30:00", "N/A") —
          // Number() then yields NaN and Mongoose throws a CastError that used
          // to abort the WHOLE series import (0 episodes stored). Parse the
          // leading number only, and never let one bad episode kill the rest.
          const rawDuration = String(ep.info?.duration ?? '').match(/[\d.]+/);
          const parsedDuration = rawDuration ? Number(rawDuration[0]) : NaN;
          await Episode.findOneAndUpdate(
            { seriesId: seriesDoc._id, externalId: String(ep.id) },
            {
              $set: {
                seasonId: season._id,
                episodeNumber: Number(ep.episode_num) || 0,
                title: String(ep.title || `Episode ${ep.episode_num || ''}`).trim(),
                description: ep.info?.plot || '',
                thumbnail: ep.info?.movie_image || ep.info?.thumb || '',
                duration: Number.isFinite(parsedDuration) ? parsedDuration : null,
                streamUrl: episodeUrl(creds, ep.id, String(ext).replace(/^\./, '')),
                containerExtension: String(ext).replace(/^\./, ''),
              },
            },
            { upsert: true, setDefaultsOnInsert: true },
          ).exec();
        } catch (epErr) {
          console.warn(
            `[xtream] episode ${ep.id} import failed for series ${seriesDoc.externalId}:`,
            (epErr as Error).message,
          );
        }
      }
    }
    // Stamp ONLY on success: genuinely episode-less series are cached for the
    // stale window, while transient panel/data errors retry on the next open.
    await Series.updateOne(
      { _id: seriesDoc._id },
      { $set: { episodesFetchedAt: new Date() } },
    ).exec();
  } catch (err) {
    // Episodes are best-effort — a single series must not fail the whole sync.
    console.warn(`[xtream] episodes sync failed for series ${seriesDoc.externalId}:`, (err as Error).message);
  }
}

/**
 * Lazy series content loading: fetch seasons + episodes for one series from the
 * panel on demand (when a user opens a series/season in the dashboard), then
 * persist them. Best-effort — callers should catch and degrade gracefully.
 */

async function seriesSourceAndCreds(series: any): Promise<XtreamCredentials> {
  const source = await XtreamSource.findOne({
    _id: series.sourceId,
    verificationStatus: { $ne: 'blocked' },
  }).lean().exec();
  if (!source) throw new Error('Xtream source unavailable for this series');
  return {
    serverUrl: source.serverUrl,
    mirrorServerUrls: source.mirrorServerUrls || [],
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  };
}

/** Fetch seasons (and episodes) for a series from its Xtream panel on demand. */
export async function ensureSeriesSeasons(seriesId: string) {
  const series = await Series.findOne({ _id: seriesId, isActive: true }).lean().exec();
  if (!series) throw new Error('Series not found');
  const creds = await seriesSourceAndCreds(series);
  await syncSeriesEpisodes(series.sourceId, series, creds);
  return Season.find({ seriesId: series._id }).sort({ seasonNumber: 1 }).lean().exec();
}

/** Fetch seasons + episodes for a season's series on demand; returns stored episode count. */
export async function ensureSeasonEpisodes(seasonId: string): Promise<number> {
  const season = await Season.findById(seasonId).lean().exec();
  if (!season) throw new Error('Season not found');
  const series = await Series.findOne({ _id: season.seriesId, isActive: true }).lean().exec();
  if (!series) throw new Error('Series not found');
  const creds = await seriesSourceAndCreds(series);
  await syncSeriesEpisodes(series.sourceId, series, creds);
  return Episode.countDocuments({ seasonId: season._id }).exec();
}

function liveChannelSnapshot(sourceId: mongoose.Types.ObjectId, item: any, group: string, creds: XtreamCredentials, playbackFormat: XtreamPlaybackFormat = 'm3u8') {
  const rawName = String(item.name || `Channel ${item.stream_id}`).trim();
  return {
    channelId: `xt:${String(sourceId)}:${item.stream_id}`,
    channelName: cleanDisplay(rawName, rawName),
    channelUrl: resolvedLiveUrl(creds, item, playbackFormat),
    channelImg: iconUrl(item.stream_icon),
    channelGroup: cleanDisplay(group),
    tvgId: item.epg_channel_id || '',
    tvgName: rawName,
    order: Number(item.num) || 0,
    metadata: {
      source: 'xtream',
      xtreamSourceId: String(sourceId),
      xtreamStreamId: Number(item.stream_id),
    },
    catchup: { type: 'timeshift', days: XTREAM_TIMESHIFT_DAYS },
  };
}

export async function previewXtreamSource(sourceId: string, createdBy?: string | null) {
  const source = await XtreamSource.findById(sourceId).exec();
  if (!source) throw new Error('Xtream source not found');
  if (source.status !== 'Active') throw new Error('Xtream source is inactive');
  if (source.syncStatus === 'syncing') throw new Error('Sync already in progress');

  const creds: XtreamCredentials = {
    serverUrl: source.serverUrl,
    mirrorServerUrls: source.mirrorServerUrls || [],
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  };
  const [liveCats, liveStreams] = await Promise.all([
    apiGet(creds, 'get_live_categories').catch(() => []),
    apiGet(creds, 'get_live_streams'),
  ]);
  const liveCatMap = await mapCategories(liveCats);
  const channels = (Array.isArray(liveStreams) ? liveStreams : []).map((item) =>
    liveChannelSnapshot(source._id, item, liveCatMap.get(String(item.category_id)) || 'Uncategorized', creds, source.playbackFormat || 'm3u8'),
  );
  const preview = await createSyncPreview({
    sourceType: 'xtream',
    sourceId: String(source._id),
    nextChannels: channels,
    createdBy,
  });
  return { ...preview, scope: 'live', stats: { channels: channels.length } };
}

async function mapCategories(items: any[]) {
  const map = new Map<string, string>();
  for (const c of Array.isArray(items) ? items : []) {
    map.set(String(c.category_id), String(c.category_name || 'Uncategorized'));
  }
  return map;
}

/**
 * Full sync of one Xtream source:
 * live streams → Channel catalog, VOD → Movies, series → Series/Seasons/Episodes.
 */
export async function syncXtreamSource(sourceId: string, opts: { allowCatalogOnly?: boolean; syncEpisodes?: boolean } = {}) {
  const source = await XtreamSource.findById(sourceId).exec();
  if (!source) throw new Error('Xtream source not found');
  const catalogOnly = opts.allowCatalogOnly === true;
  // The rule for "which families may this sync import" lives in one place, so the two paths that
  // need it cannot drift: services/source-eligibility.ts#syncFamilyPlan. The old gate here required
  // a LIVE verdict before importing ANY family, so a source whose live channels were down could not
  // refresh its movies or series either, and nothing re-verified it — the catalog froze for good.
  const plan = syncFamilyPlan(source);
  const families = catalogOnly
    // An explicit operator "import the catalog" request keeps its previous meaning — it works on
    // any panel we can authenticate to (a FIRST import has no stored titles to probe, so the
    // on-demand verdict cannot exist yet). It still refuses to import live channels known dead.
    ? { live: plan.live, onDemand: source.verificationStatus !== 'blocked' }
    : plan;
  if (!families.live && !families.onDemand) {
    throw new Error(
      source.verificationStatus === 'blocked'
        ? 'Xtream source API is blocked; catalog import cannot proceed'
        : 'Xtream source must pass verification before sync',
    );
  }
  if (source.syncStatus === 'syncing') throw new Error('Sync already in progress');

  const creds: XtreamCredentials = {
    serverUrl: source.serverUrl,
    mirrorServerUrls: source.mirrorServerUrls || [],
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  };

  source.syncStatus = 'syncing';
  source.lastError = null;
  await source.save();

  const id = source._id;
  let channels = 0;
  let movies = 0;
  let seriesCount = 0;

  try {
    // Categories are non-essential (fall back to "Uncategorized"); the stream
    // lists ARE essential — if they fail, the whole sync is an error.
    const [liveCats, liveStreams, vodCats, vodStreams, seriesCats, seriesList] = await Promise.all([
      families.live ? apiGet(creds, 'get_live_categories').catch(() => []) : Promise.resolve([]),
      // Only fetched when we may actually import them. These two calls are deliberately NOT
      // `.catch`-guarded (a failure means the panel is broken and the sync must fail loudly), so
      // fetching live from a source we will not import from would let a dead live endpoint take
      // the whole sync down with it — movies and series included.
      families.live ? apiGet(creds, 'get_live_streams') : Promise.resolve([]),
      apiGet(creds, 'get_vod_categories').catch(() => []),
      apiGet(creds, 'get_vod_streams'),
      apiGet(creds, 'get_series_categories').catch(() => []),
      apiGet(creds, 'get_series'),
    ]);

    const liveCatMap = await mapCategories(liveCats);
    const vodCatMap = await mapCategories(vodCats);
    // No live import ⇒ no live snapshot: a preview is what an operator reviews before a channel
    // list goes out, so staging an empty one would be a lie about what this sync did.
    const livePreview = families.live
      ? await createSyncPreview({
          sourceType: 'xtream',
          sourceId: String(id),
          nextChannels: (Array.isArray(liveStreams) ? liveStreams : []).map((item) =>
            liveChannelSnapshot(id, item, liveCatMap.get(String(item.category_id)) || 'Uncategorized', creds, source.playbackFormat || 'm3u8'),
          ),
        })
      : null;
    if (!families.live) {
      console.log(
        `[xtream-sync] source ${id}: importing on-demand only (no live channel import) — ` +
          `status=${source.status} verification=${source.verificationStatus} vod=${source.vodVerificationStatus || 'pending'}`,
      );
    }
    const seriesCatMap = await mapCategories(seriesCats);

    // Live channels
    const liveIds = new Set<string>();
    // Merge-on-sync: when the operator flagged this source as mergeCatalog,
    // its streams attach to EXISTING catalog channels as failover backups
    // (canonical-name match) instead of creating duplicate channel docs — the
    // customer list stays exactly where it is; only genuinely new channels
    // are inserted. This is how adding a new source must NOT reshuffle the app.
    const mergeIndex = source.mergeCatalog === true
      ? buildCatalogMatchIndex(
          await Channel.find({
            ownerId: null,
            isActive: { $ne: false },
            'metadata.source': 'xtream',
            'metadata.xtreamSourceId': { $ne: String(id) },
          })
            // Both metadata fields: the projection of a nested path returns only what is
            // asked for, so selecting just the id made `metadata.source` undefined and the
            // adoption check below silently never fired (caught by the adoption test).
            .select('_id channelId channelName metadata.source metadata.xtreamSourceId')
            .lean()
            .exec(),
        )
      : null;
    // Sources that still exist. A channel pointing at an id NOT in this set was orphaned when
    // its source row was replaced — see the adoption branch in the loop.
    const liveSourceIds = new Set(
      (await XtreamSource.find({}).distinct('_id')).map((sid) => String(sid)),
    );
    const mergePriority = Number(source.failoverPriority) || 20;
    // Stability proof: fingerprint the customer-facing list BEFORE the sync.
    // mergeCatalog syncs must never reshuffle it — new channels may be added,
    // matched streams become failover backups, nothing is moved or edited.
    const catalogBefore = source.mergeCatalog === true ? await snapshotCatalogFingerprint() : null;
    let mergeMatched = 0;
    let adopted = 0;
    for (const item of families.live && Array.isArray(liveStreams) ? liveStreams : []) {
      const group = liveCatMap.get(String(item.category_id)) || 'Uncategorized';
      if (mergeIndex) {
        const existing = matchCatalogChannel(item, mergeIndex);
        if (existing) {
          // Adoption, not a failover map, when the matched channel's source is GONE. The
          // visibility gate treats a channel whose xtream source no longer exists as
          // unverified and hides it, so mapping a live stream onto such a channel produced a
          // channel nobody could see: the provider was healthy while the customer's catalog
          // stayed empty (2026-09-21: 16.7k channels hidden this way after the provider was
          // re-registered). Taking the channel over keeps its _id, identities, EPG links and
          // order, and makes it visible on the source that actually serves it.
          const existingSourceId = String(existing.metadata?.xtreamSourceId || '');
          const orphanedCanonical =
            existing.metadata?.source === 'xtream' &&
            existingSourceId.length > 0 &&
            !liveSourceIds.has(existingSourceId);
          if (orphanedCanonical) {
            await adoptOrphanedChannel(existing, id, item, group, creds, source.playbackFormat || 'm3u8');
            // The channel id moves to this source's scheme, so any failover row keyed on the
            // retired id is dead weight — the stream is now the channel's own URL.
            await ChannelFailoverMap.deleteMany({
              channelRef: String(existing.channelId),
              backupSourceId: id,
            }).exec();
            liveIds.add(`xt:${String(id)}:${item.stream_id}`);
            channels += 1;
            adopted += 1;
            continue;
          }
          await upsertMergeFailoverMap(existing, id, item, mergePriority);
          liveIds.add(`xt:${String(id)}:${item.stream_id}`);
          channels += 1;
          mergeMatched += 1;
          continue;
        }
      }
      await upsertChannel(id, item, group, creds, source.playbackFormat || 'm3u8');
      liveIds.add(`xt:${String(id)}:${item.stream_id}`);
      channels += 1;
    }

    // Movies
    const vodIds = new Set<string>();
    for (const item of Array.isArray(vodStreams) ? vodStreams : []) {
      const group = vodCatMap.get(String(item.category_id)) || 'Uncategorized';
      await upsertMovie(id, item, group, creds);
      vodIds.add(String(item.stream_id));
      movies += 1;
    }

    // Series (metadata only — episodes are fetched per-series below)
    const seriesExternalIds = new Set<string>();
    for (const item of Array.isArray(seriesList) ? seriesList : []) {
      const group = seriesCatMap.get(String(item.category_id)) || 'Uncategorized';
      await upsertSeries(id, item, group);
      seriesExternalIds.add(String(item.series_id));
      seriesCount += 1;
    }

    // Episodes are now LAZY: they are fetched on demand when a season is opened
    // (see ensureSeasonEpisodes). A full backfill can still be triggered with
    // opts.syncEpisodes=true — used for targeted imports, never for catalog-only
    // imports of large panels (16k+ series would take hours).
    if (opts.syncEpisodes === true) {
      const seriesDocs = await Series.find({
        sourceId: id,
        isActive: true,
        externalId: { $in: [...seriesExternalIds] },
      }).lean().exec();
      const CONCURRENCY = 3;
      let idx = 0;
      const worker = async () => {
        while (idx < seriesDocs.length) {
          const doc = seriesDocs[idx++];
          await syncSeriesEpisodes(id, doc, creds);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    }

    // Prune: deactivate channels/movies/series from this source that disappeared.
    //
    // Guarded deliberately — see services/catalog-prune-guard.ts. One short fetch used to
    // be enough to deactivate tens of thousands of titles, and because the upserts write
    // `isActive` under `$setOnInsert` (so a re-sync never overrides an operator's manual
    // deactivation), no later sync could undo it. Measured 2026-09-25: a single run
    // deactivated 58,240 movies and 9,538 channels, permanently and silently.
    const previouslyActive = {
      // A family this sync did not import must not be measured for loss — see the per-family prune
      // below: an empty `liveIds` set would otherwise deactivate every channel this source still has.
      channels: families.live
        ? await Channel.countDocuments({
            ownerId: null,
            'metadata.xtreamSourceId': String(id),
            isActive: true,
          })
        : 0,
      movies: await Movie.countDocuments({ sourceId: id, isActive: true }),
      series: await Series.countDocuments({ sourceId: id, isActive: true }),
    };
    const pruneDecision = decideCatalogPrune(
      { channels: families.live ? channels : 0, movies, series: seriesCount },
      previouslyActive,
      Number(process.env.XTREAM_PRUNE_MIN_RATIO) || DEFAULT_PRUNE_MIN_RATIO,
    );
    if (!pruneDecision.prune) {
      console.warn(
        `[xtream-sync] skipping catalog prune for source ${id}: ${pruneDecision.skippedReason} ` +
          `(fetched channels/movies/series=${channels}/${movies}/${seriesCount}, ` +
          `active=${previouslyActive.channels}/${previouslyActive.movies}/${previouslyActive.series}) — ` +
          'the existing catalog is kept, because a short fetch is not evidence of removal',
      );
    } else {
      if (families.live) {
        await Channel.updateMany(
          { ownerId: null, 'metadata.xtreamSourceId': String(id), channelId: { $nin: [...liveIds] } },
          {
            $set: {
              isActive: false,
              identityKey: null,
              identityConfidence: null,
              identityMatch: null,
            },
          },
        ).exec();
      }
      await Movie.updateMany(
        { sourceId: id, externalId: { $nin: [...vodIds] } },
        { $set: { isActive: false } },
      ).exec();
      await Series.updateMany(
        { sourceId: id, externalId: { $nin: [...seriesExternalIds] } },
        { $set: { isActive: false } },
      ).exec();
    }

    const identity = await reconcileChannelIdentities();
    if (livePreview) await markSnapshotApplied(livePreview.snapshotId);
    // Stability proof (after): record the diff — customer list unchanged?
    if (catalogBefore) {
      const catalogAfter = await snapshotCatalogFingerprint();
      await recordStabilityReport(source, catalogBefore, catalogAfter, mergeMatched);
    }
    source.stats = { channels, movies, series: seriesCount };
    source.syncStatus = 'idle';
    source.lastSyncAt = new Date();
    if (catalogOnly) source.catalogOnlyImportedAt = new Date();
    await source.save();

    // A sync creates/updates/deactivates channels and rewrites the shared catalog —
    // drop the in-process visibility memo so customers never see the old gate.
    clearChannelGateCache();

    return {
      ok: true,
      stats: source.stats,
      identity,
      catalogOnly,
      // Channels that used to point at a replaced source and were taken over by this one.
      adopted,
      stabilityReport: source.stabilityReport ?? null,
    };
  } catch (err: any) {
    source.syncStatus = 'error';
    source.lastError = redactSensitiveText(err);
    await source.save();
    throw err;
  }
}

module.exports = {
  buildXtreamApiUrl,
  endpointCandidates,
  rewriteStreamUrlBase,
  testXtreamConnection,
  diagnoseXtreamSource,
  verifyXtreamSource,
  syncXtreamSource,
  previewXtreamSource,
  ensureSeriesSeasons,
  ensureSeasonEpisodes,
  encryptSecret,
  decryptSecret,
  buildCatalogMatchIndex,
  matchCatalogChannel,
  // CommonJS consumers (`require('../services/xtream-service')`, e.g. routes/tv.js) replace the
  // module exports object wholesale, so every named export has to be listed here too.
  hlsTwinStreamUrl,
};
