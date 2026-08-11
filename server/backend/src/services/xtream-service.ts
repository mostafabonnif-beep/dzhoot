import axios from 'axios';
import mongoose from 'mongoose';
import XtreamSource from '../models/XtreamSource';
import Channel from '../models/Channel';
import Movie from '../models/Movie';
import Series from '../models/Series';
import Season from '../models/Season';
import Episode from '../models/Episode';
import { encryptSecret, decryptSecret } from '../utils/crypto';

/**
 * Xtream Codes API integration.
 * player_api.php is the well-known endpoint exposed by Xtream Codes panels:
 *   GET {server}/player_api.php?username=U&password=P&action=...
 */

const API_TIMEOUT_MS = 30000;

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
  const res = await axios.get(url, { timeout: API_TIMEOUT_MS });
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

function getContainerExt(item: any): string {
  const ext = item?.container_extension || 'm3u8';
  return String(ext).replace(/^\./, '');
}

function liveUrl(creds: XtreamCredentials, streamId: string | number): string {
  return `${creds.serverUrl.replace(/\/+$/, '')}/live/${creds.username}/${creds.password}/${streamId}.m3u8`;
}

function vodUrl(creds: XtreamCredentials, streamId: string | number, ext: string): string {
  return `${creds.serverUrl.replace(/\/+$/, '')}/movie/${creds.username}/${creds.password}/${streamId}.${ext}`;
}

function episodeUrl(creds: XtreamCredentials, episodeId: string | number, ext: string): string {
  return `${creds.serverUrl.replace(/\/+$/, '')}/series/${creds.username}/${creds.password}/${episodeId}.${ext}`;
}

export function buildXtreamStreamUrl(
  creds: XtreamCredentials,
  contentType: string,
  streamId: string | number,
  extension = 'm3u8',
): string {
  if (contentType === 'LIVE') return liveUrl(creds, streamId);
  if (contentType === 'MOVIE') return vodUrl(creds, streamId, extension);
  if (contentType === 'EPISODE') return episodeUrl(creds, streamId, extension);
  throw new Error('Unsupported Xtream content type');
}

async function upsertChannel(sourceId: mongoose.Types.ObjectId, item: any, group: string) {
  const channelId = `xt:${String(sourceId)}:${item.stream_id}`;
  return Channel.findOneAndUpdate(
    { ownerId: null, channelId },
    {
      $set: {
        channelId,
        channelName: String(item.name || `Channel ${item.stream_id}`).trim(),
        channelUrl: '',
        channelImg: item.stream_icon || '',
        channelGroup: group || 'Uncategorized',
        tvgId: item.epg_channel_id || '',
        tvgName: String(item.name || '').trim(),
        isActive: true,
        order: Number(item.num) || 0,
        'metadata.source': 'xtream',
        'metadata.xtreamSourceId': String(sourceId),
        'metadata.xtreamStreamId': Number(item.stream_id),
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  ).exec();
}

async function upsertMovie(sourceId: mongoose.Types.ObjectId, item: any, group: string) {
  const ext = getContainerExt(item);
  return Movie.findOneAndUpdate(
    { sourceId, externalId: String(item.stream_id) },
    {
      $set: {
        title: String(item.name || `Movie ${item.stream_id}`).trim(),
        category: group || 'Uncategorized',
        poster: item.stream_icon || '',
        backdrop: '',
        description: item.plot || item.description || '',
        year: item.year ? Number(item.year) : null,
        duration: item.duration ? Number(item.duration) : null,
        rating: item.rating_5based ? Number(item.rating_5based) : null,
        streamUrl: '',
        containerExtension: ext,
        isActive: true,
      },
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
        backdrop: item.backdrop_path || '',
        plot: item.plot || '',
        cast: Array.isArray(item.cast) ? item.cast.join(', ') : String(item.cast || ''),
        director: item.director || '',
        genre: item.genre || '',
        releaseDate: item.releaseDate || '',
        rating: item.rating_5based ? Number(item.rating_5based) : null,
        isActive: true,
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  ).exec();
}

/** Fetch + store seasons and episodes for one series. */
async function syncSeriesEpisodes(sourceId: mongoose.Types.ObjectId, seriesDoc: any, creds: XtreamCredentials) {
  try {
    const info = await apiGet(creds, 'get_series_info', { series_id: seriesDoc.externalId });
    const seasons = Array.isArray(info?.seasons) ? info.seasons : [];
    for (const s of seasons) {
      const season = await Season.findOneAndUpdate(
        { seriesId: seriesDoc._id, seasonNumber: Number(s.season_number) || 0 },
        {
          $set: {
            name: String(s.name || `Season ${s.season_number}`),
            cover: s.cover || '',
          },
        },
        { upsert: true, setDefaultsOnInsert: true, new: true },
      ).exec();

      const episodes = Array.isArray(s.episodes) ? s.episodes : [];
      for (const ep of episodes) {
        const ext = ep.container_extension || 'm3u8';
        await Episode.findOneAndUpdate(
          { seriesId: seriesDoc._id, externalId: String(ep.id) },
          {
            $set: {
              seasonId: season._id,
              episodeNumber: Number(ep.episode_num) || 0,
              title: String(ep.title || `Episode ${ep.episode_num || ''}`).trim(),
              description: ep.info?.plot || '',
              thumbnail: ep.info?.movie_image || ep.info?.thumb || '',
              duration: ep.info?.duration ? Number(ep.info.duration) : null,
              streamUrl: '',
              containerExtension: String(ext).replace(/^\./, ''),
            },
          },
          { upsert: true, setDefaultsOnInsert: true },
        ).exec();
      }
    }
  } catch (err) {
    // Episodes are best-effort — a single series must not fail the whole sync.
    console.warn(`[xtream] episodes sync failed for series ${seriesDoc.externalId}:`, (err as Error).message);
  }
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
export async function syncXtreamSource(sourceId: string) {
  const source = await XtreamSource.findById(sourceId).exec();
  if (!source) throw new Error('Xtream source not found');
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
    const seriesCatMap = await mapCategories(seriesCats);

    // Live channels
    const liveIds = new Set<string>();
    for (const item of Array.isArray(liveStreams) ? liveStreams : []) {
      const group = liveCatMap.get(String(item.category_id)) || 'Uncategorized';
      await upsertChannel(id, item, group);
      liveIds.add(`xt:${String(id)}:${item.stream_id}`);
      channels += 1;
    }

    // Movies
    const vodIds = new Set<string>();
    for (const item of Array.isArray(vodStreams) ? vodStreams : []) {
      const group = vodCatMap.get(String(item.category_id)) || 'Uncategorized';
      await upsertMovie(id, item, group);
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

    // Episodes — bounded concurrency to avoid hammering the source panel.
    const seriesDocs = await Series.find({ sourceId: id, isActive: true }).lean().exec();
    const CONCURRENCY = 3;
    let idx = 0;
    const worker = async () => {
      while (idx < seriesDocs.length) {
        const doc = seriesDocs[idx++];
        await syncSeriesEpisodes(id, doc, creds);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    // Prune: deactivate channels/movies/series from this source that disappeared.
    await Channel.updateMany(
      { ownerId: null, 'metadata.xtreamSourceId': String(id), channelId: { $nin: [...liveIds] } },
      { $set: { isActive: false } },
    ).exec();
    await Movie.updateMany(
      { sourceId: id, externalId: { $nin: [...vodIds] } },
      { $set: { isActive: false } },
    ).exec();
    await Series.updateMany(
      { sourceId: id, externalId: { $nin: [...seriesExternalIds] } },
      { $set: { isActive: false } },
    ).exec();

    source.stats = { channels, movies, series: seriesCount };
    source.syncStatus = 'idle';
    source.lastSyncAt = new Date();
    await source.save();

    return { ok: true, stats: source.stats };
  } catch (err: any) {
    source.syncStatus = 'error';
    source.lastError = (err as Error).message;
    await source.save();
    throw err;
  }
}

module.exports = {
  buildXtreamApiUrl,
  buildXtreamStreamUrl,
  testXtreamConnection,
  syncXtreamSource,
  encryptSecret,
  decryptSecret,
};
