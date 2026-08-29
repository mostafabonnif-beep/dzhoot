import axios from 'axios';
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
import { createPinnedLookup, validateUrlForSSRF } from '../utils/ssrf-guard';
import { redactSensitiveText } from './audit-log';
import { reconcileChannelIdentities } from './channel-identity-service';
import { createSyncPreview, markSnapshotApplied } from './sync-snapshot-service';
import { probeStream, type ProbeResult } from './stream-prober';
import { channelCache } from './cache';

const API_TIMEOUT_MS = 30000;

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

  return axios.get(url, {
    timeout: API_TIMEOUT_MS,
    maxRedirects: 0,
    httpAgent: parsed.protocol === 'http:' ? agent : undefined,
    httpsAgent: parsed.protocol === 'https:' ? agent : undefined,
    validateStatus: (status) => status >= 200 && status < 300,
  });
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
  const url = buildXtreamApiUrl(creds, action, extra);
  const res = await safeAxiosGet(url);
  return res.data;
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
}

/**
 * Diagnose a source without importing it. This deliberately separates API
 * metadata from actual playback so an account that only lists channels is not
 * presented as a working source to the customer.
 */
export async function diagnoseXtreamSource(creds: XtreamCredentials, sampleLimit = 3): Promise<XtreamDiagnostics> {
  const result: XtreamDiagnostics = {
    api: { ok: false, error: null, auth: null, status: null },
    server: { url: null, protocol: null, port: null, httpsPort: null, rtmpPort: null },
    m3u: { status: 'not-tested', statusCode: null, error: null },
    live: { tested: 0, alive: 0, dead: 0, playbackFormat: null, samples: [] },
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

  return result;
}

export async function verifyXtreamSource(sourceId: string, sampleLimit = 3) {
  const source = await XtreamSource.findById(sourceId).exec();
  if (!source) throw new Error('Source not found');

  const diagnostics = await diagnoseXtreamSource({
    serverUrl: source.serverUrl,
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  }, sampleLimit);

  const now = new Date();
  const liveAvailable = diagnostics.live.alive > 0;
  const apiAvailable = diagnostics.api.ok;
  const verified = apiAvailable && liveAvailable;
  const verificationStatus = verified ? 'verified' : apiAvailable ? 'degraded' : 'blocked';
  const error = verified
    ? diagnostics.m3u.status === 'dead'
      ? 'Live playback is available, but M3U export is unavailable'
      : null
    : diagnostics.api.error || (diagnostics.live.tested > 0 ? 'No tested live stream is playable' : 'No live stream could be verified');

  source.verificationStatus = verificationStatus;
  source.status = verified ? 'Active' : 'Inactive';
  source.lastDiagnosticsAt = now;
  source.lastDiagnostics = diagnostics as unknown as Record<string, unknown>;
  source.lastError = error;
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
      status: source.status,
      verified,
      reason: error,
    },
  };
}

function toStringOrEmpty(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(' ');
  return String(value || '').trim();
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

async function upsertChannel(sourceId: mongoose.Types.ObjectId, item: any, group: string, creds: XtreamCredentials, playbackFormat: XtreamPlaybackFormat = 'm3u8') {
  const channelId = `xt:${String(sourceId)}:${item.stream_id}`;
  const update: Record<string, any> = {
    $set: {
      channelId,
      channelName: String(item.name || `Channel ${item.stream_id}`).trim(),
      channelUrl: resolvedLiveUrl(creds, item, playbackFormat),
      channelImg: iconUrl(item.stream_icon),
      channelGroup: group || 'Uncategorized',
      // tvgId is set ONLY on INSERT ($setOnInsert) and never overwritten by a
      // sync: operator-assigned tvgIds (which may point at a better guide than
      // the provider's epg_channel_id, e.g. epgshare TR1 real schedules vs
      // iptv-org "No Data" placeholders) must survive scheduled syncs. New
      // channels still inherit the provider's epg_channel_id on first import.
      tvgName: String(item.name || '').trim(),
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
        category: group || 'Uncategorized',
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
        category: group || 'Uncategorized',
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
  return {
    channelId: `xt:${String(sourceId)}:${item.stream_id}`,
    channelName: String(item.name || `Channel ${item.stream_id}`).trim(),
    channelUrl: resolvedLiveUrl(creds, item, playbackFormat),
    channelImg: iconUrl(item.stream_icon),
    channelGroup: group || 'Uncategorized',
    tvgId: item.epg_channel_id || '',
    tvgName: String(item.name || '').trim(),
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
  if (!catalogOnly && (source.status !== 'Active' || source.verificationStatus !== 'verified')) {
    throw new Error('Xtream source must pass live playback verification before sync');
  }
  if (catalogOnly && source.verificationStatus === 'blocked') {
    throw new Error('Xtream source API is blocked; catalog import cannot proceed');
  }
  if (source.syncStatus === 'syncing') throw new Error('Sync already in progress');

  const creds: XtreamCredentials = {
    serverUrl: source.serverUrl,
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
      apiGet(creds, 'get_live_categories').catch(() => []),
      apiGet(creds, 'get_live_streams'),
      apiGet(creds, 'get_vod_categories').catch(() => []),
      apiGet(creds, 'get_vod_streams'),
      apiGet(creds, 'get_series_categories').catch(() => []),
      apiGet(creds, 'get_series'),
    ]);

    const liveCatMap = await mapCategories(liveCats);
    const vodCatMap = await mapCategories(vodCats);
    const livePreview = await createSyncPreview({
      sourceType: 'xtream',
      sourceId: String(id),
      nextChannels: (Array.isArray(liveStreams) ? liveStreams : []).map((item) =>
        liveChannelSnapshot(id, item, liveCatMap.get(String(item.category_id)) || 'Uncategorized', creds, source.playbackFormat || 'm3u8'),
      ),
    });
    const seriesCatMap = await mapCategories(seriesCats);

    // Live channels
    const liveIds = new Set<string>();
    for (const item of Array.isArray(liveStreams) ? liveStreams : []) {
      const group = liveCatMap.get(String(item.category_id)) || 'Uncategorized';
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
    await Movie.updateMany(
      { sourceId: id, externalId: { $nin: [...vodIds] } },
      { $set: { isActive: false } },
    ).exec();
    await Series.updateMany(
      { sourceId: id, externalId: { $nin: [...seriesExternalIds] } },
      { $set: { isActive: false } },
    ).exec();

    const identity = await reconcileChannelIdentities();
    await markSnapshotApplied(livePreview.snapshotId);
    source.stats = { channels, movies, series: seriesCount };
    source.syncStatus = 'idle';
    source.lastSyncAt = new Date();
    if (catalogOnly) source.catalogOnlyImportedAt = new Date();
    await source.save();

    return { ok: true, stats: source.stats, identity, catalogOnly };
  } catch (err: any) {
    source.syncStatus = 'error';
    source.lastError = redactSensitiveText(err);
    await source.save();
    throw err;
  }
}

module.exports = {
  buildXtreamApiUrl,
  testXtreamConnection,
  diagnoseXtreamSource,
  verifyXtreamSource,
  syncXtreamSource,
  previewXtreamSource,
  ensureSeriesSeasons,
  ensureSeasonEpisodes,
  encryptSecret,
  decryptSecret,
};
