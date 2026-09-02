import mongoose from 'mongoose';
import axios from 'axios';
import XtreamSource from '../models/XtreamSource';
import Channel from '../models/Channel';
import Movie from '../models/Movie';
import Series from '../models/Series';
import Season from '../models/Season';
import Episode from '../models/Episode';
import { diagnoseXtreamSource, verifyXtreamSource, syncXtreamSource, buildXtreamApiUrl, ensureSeriesSeasons } from '../services/xtream-service';
import { probeStream } from '../services/stream-prober';
import { encryptSecret, decryptSecret } from '../utils/crypto';

jest.mock('axios');
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn(async () => ({ safe: true, resolvedAddresses: ['198.51.100.10'] })),
  createPinnedLookup: jest.fn(() => undefined),
}));

jest.mock('../services/stream-prober', () => ({
  probeStream: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedProbeStream = probeStream as jest.MockedFunction<typeof probeStream>;

const SERVER = 'http://panel.example:8080';
const USER = 'user1';
const PASS = 'pass1';

function fixturePayload(action: string | undefined, seriesId?: string) {
  if (!action) {
    return { user_info: { auth: 1, status: 'Active', exp_date: '1750000000' }, server_info: { url: SERVER } };
  }
  switch (action) {
    case 'get_live_categories':
      return [{ category_id: '1', category_name: 'Algeria' }];
    case 'get_live_streams':
      return [
        { num: 1, name: 'ENTV', stream_id: 101, stream_icon: 'http://logo/entv.png', category_id: '1', epg_channel_id: 'ENTV.epg' },
        { num: 2, name: 'Canal Algerie', stream_id: 102, category_id: '1' },
      ];
    case 'get_vod_categories':
      return [{ category_id: '2', category_name: 'Movies' }];
    case 'get_vod_streams':
      return [
        { num: 1, name: 'Inception', stream_id: 201, stream_icon: 'http://poster/inc.jpg', category_id: '2', container_extension: 'mp4', rating_5based: 8.8, plot: 'A dream heist', year: 2010 },
      ];
    case 'get_series_categories':
      return [{ category_id: '3', category_name: 'Series' }];
    case 'get_series':
      return [
        { num: 1, name: 'Breaking Bad', series_id: 301, cover: 'http://cover/bb.jpg', category_id: '3', rating_5based: 9.5, plot: 'Chemistry teacher' },
      ];
    case 'get_series_info':
      return {
        seasons: [
          {
            season_number: 1,
            name: 'Season 1',
            episodes: [
              { id: 30101, episode_num: 1, title: 'Pilot', container_extension: 'mp4', info: { plot: 'Pilot episode', duration: '47' } },
              { id: 30102, episode_num: 2, title: 'Cat in the Bag', container_extension: 'mp4' },
            ],
          },
        ],
      };
    default:
      return [];
  }
}

async function makeSource() {
  return XtreamSource.create({
    name: 'Test Panel',
    serverUrl: SERVER,
    usernameEncrypted: encryptSecret(USER),
    passwordEncrypted: encryptSecret(PASS),
    status: 'Active',
    verificationStatus: 'verified',
  });
}

describe('xtream-service', () => {
  beforeEach(() => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const action = parsed.searchParams.get('action') || undefined;
      const seriesId = parsed.searchParams.get('series_id') || undefined;
      return { data: fixturePayload(action, seriesId) };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('diagnoses metadata separately from M3U and live playback', async () => {
    const source = await makeSource();
    mockedProbeStream
      .mockResolvedValueOnce({ status: 'dead', statusCode: 884, error: 'HTTP 884', responseTimeMs: 20, manifestValid: null, segmentReachable: null, manifestInfo: null })
      .mockResolvedValue({ status: 'dead', statusCode: 456, error: 'HTTP 456', responseTimeMs: 30, manifestValid: null, segmentReachable: null, manifestInfo: null });

    const result = await diagnoseXtreamSource({ serverUrl: SERVER, username: USER, password: PASS }, 2);

    expect(result.api).toMatchObject({ ok: true, auth: 1, status: 'Active' });
    expect(result.server).toMatchObject({ url: SERVER, protocol: null, port: null });
    expect(result.m3u).toMatchObject({ status: 'dead', statusCode: 884 });
    expect(result.live).toMatchObject({ tested: 2, alive: 0, dead: 2 });
    expect(result.live.samples.map((sample) => sample.statusCode)).toEqual([456, 456]);
  });

  it('falls back to TS when the provider exposes live playback only in TS format', async () => {
    const source = await XtreamSource.create({
      name: 'TS-only Panel',
      serverUrl: SERVER,
      usernameEncrypted: encryptSecret(USER),
      passwordEncrypted: encryptSecret(PASS),
      status: 'Inactive',
      verificationStatus: 'pending',
    });

    mockedProbeStream
      .mockResolvedValueOnce({ status: 'dead', statusCode: 884, error: 'HTTP 884', responseTimeMs: 20, manifestValid: null, segmentReachable: null, manifestInfo: null })
      .mockResolvedValueOnce({ status: 'dead', statusCode: 456, error: 'HTTP 456', responseTimeMs: 30, manifestValid: null, segmentReachable: null, manifestInfo: null })
      .mockResolvedValueOnce({ status: 'alive', statusCode: 200, error: null, responseTimeMs: 40, manifestValid: null, segmentReachable: null, manifestInfo: null });

    const result = await verifyXtreamSource(String(source._id), 1);

    expect(result.live).toMatchObject({ tested: 1, alive: 1, dead: 0, playbackFormat: 'ts' });
    expect(result.live.samples[0]).toMatchObject({ streamId: '101', format: 'ts', statusCode: 200 });
    const refreshed = await XtreamSource.findById(source._id).lean();
    expect(refreshed!.playbackFormat).toBe('ts');
    expect(refreshed!.verificationStatus).toBe('verified');
  });

  it('uses a provider-supplied direct_source after it passes live verification', async () => {
    const source = await XtreamSource.create({
      name: 'Direct-source Panel',
      serverUrl: SERVER,
      usernameEncrypted: encryptSecret(USER),
      passwordEncrypted: encryptSecret(PASS),
      status: 'Inactive',
      verificationStatus: 'pending',
    });
    const directUrl = 'https://cdn.example/live/entv.ts';

    mockedAxios.get.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const action = parsed.searchParams.get('action') || undefined;
      if (action === 'get_live_streams') {
        return {
          data: [{
            num: 1,
            name: 'ENTV',
            stream_id: 101,
            direct_source: directUrl,
            category_id: '1',
          }],
        };
      }
      return { data: fixturePayload(action) };
    });
    mockedProbeStream
      .mockResolvedValueOnce({ status: 'dead', statusCode: 884, error: 'HTTP 884', responseTimeMs: 20, manifestValid: null, segmentReachable: null, manifestInfo: null })
      .mockResolvedValueOnce({ status: 'alive', statusCode: 200, error: null, responseTimeMs: 25, manifestValid: null, segmentReachable: null, manifestInfo: null });

    const result = await verifyXtreamSource(String(source._id), 1);

    expect(result.live).toMatchObject({ tested: 1, alive: 1, dead: 0, playbackFormat: 'direct' });
    expect(result.live.samples[0]).toMatchObject({ streamId: '101', format: 'direct', statusCode: 200 });
    const refreshed = await XtreamSource.findById(source._id).lean();
    expect(refreshed!.status).toBe('Active');
    expect(refreshed!.verificationStatus).toBe('verified');
    expect(refreshed!.playbackFormat).toBeNull();

    const synced = await syncXtreamSource(String(source._id));
    expect(synced.ok).toBe(true);
    const channels = await Channel.find({ ownerId: null, 'metadata.xtreamSourceId': String(source._id) }).lean();
    expect(channels.find((channel: any) => channel.channelName === 'ENTV')!.channelUrl).toBe(directUrl);
  });

  it('keeps a metadata-only source inactive and verifies it after live playback succeeds', async () => {
    const source = await XtreamSource.create({
      name: 'Pending Panel',
      serverUrl: SERVER,
      usernameEncrypted: encryptSecret(USER),
      passwordEncrypted: encryptSecret(PASS),
      status: 'Inactive',
      verificationStatus: 'pending',
    });

    mockedProbeStream
      .mockResolvedValueOnce({ status: 'dead', statusCode: 884, error: 'HTTP 884', responseTimeMs: 20, manifestValid: null, segmentReachable: null, manifestInfo: null })
      .mockResolvedValue({ status: 'dead', statusCode: 456, error: 'HTTP 456', responseTimeMs: 30, manifestValid: null, segmentReachable: null, manifestInfo: null });
    const rejected = await verifyXtreamSource(String(source._id), 2);
    expect(rejected.decision).toMatchObject({ verified: false, status: 'Inactive', verificationStatus: 'degraded' });

    mockedProbeStream
      .mockResolvedValueOnce({ status: 'alive', statusCode: 200, error: null, responseTimeMs: 20, manifestValid: null, segmentReachable: null, manifestInfo: null })
      .mockResolvedValue({ status: 'alive', statusCode: 200, error: null, responseTimeMs: 30, manifestValid: null, segmentReachable: null, manifestInfo: null });
    const accepted = await verifyXtreamSource(String(source._id), 2);
    expect(accepted.decision).toMatchObject({ verified: true, status: 'Active', verificationStatus: 'verified' });

    const refreshed = await XtreamSource.findById(source._id).lean();
    expect(refreshed!.status).toBe('Active');
    expect(refreshed!.verificationStatus).toBe('verified');
  });

  it('builds player_api URLs with credentials', () => {
    const url = buildXtreamApiUrl({ serverUrl: SERVER, username: USER, password: PASS }, 'get_live_streams');
    expect(url).toContain('/player_api.php');
    expect(url).toContain(`username=${USER}`);
    expect(url).toContain(`password=${PASS}`);
    expect(url).toContain('action=get_live_streams');
  });

  it('encrypts and decrypts credentials round-trip', () => {
    const enc = encryptSecret('s3cret');
    expect(enc).not.toContain('s3cret');
    expect(enc.startsWith('enc:')).toBe(true);
    expect(decryptSecret(enc)).toBe('s3cret');
  });

  it('syncs live channels, movies and series into the catalog', async () => {
    const source = await makeSource();
    const result = await syncXtreamSource(String(source._id));

    expect(result.ok).toBe(true);
    expect(result.stats).toEqual({ channels: 2, movies: 1, series: 1 });

    // Live channels
    const channels = await Channel.find({ ownerId: null, 'metadata.xtreamSourceId': String(source._id) }).lean();
    expect(channels).toHaveLength(2);
    const entv = channels.find((c: any) => c.channelName === 'ENTV')!;
    expect(entv.channelUrl).toBe(`${SERVER}/live/${USER}/${PASS}/101.m3u8`);
    expect(entv.channelGroup).toBe('Algeria');
    expect(entv.tvgId).toBe('ENTV.epg');
    expect((entv.metadata as any).source).toBe('xtream');
    // Xtream channels are flagged catch-up capable with the timeshift window.
    expect((entv.catchup as any).type).toBe('timeshift');
    expect((entv.catchup as any).days).toBeGreaterThan(0);

    // Movies
    const movies = await Movie.find({ sourceId: source._id }).lean();
    expect(movies).toHaveLength(1);
    expect(movies[0].streamUrl).toBe(`${SERVER}/movie/${USER}/${PASS}/201.mp4`);
    expect(movies[0].title).toBe('Inception');
    expect(movies[0].rating).toBe(8.8);

    // Series are imported WITHOUT seasons/episodes (lazy loading by design —
    // episodes are fetched on demand when a season is opened).
    const seriesList = await Series.find({ sourceId: source._id }).lean();
    expect(seriesList).toHaveLength(1);
    const seasonsBefore = await Season.find({ seriesId: seriesList[0]._id }).lean();
    expect(seasonsBefore).toHaveLength(0);
    const episodesBefore = await Episode.find({ seriesId: seriesList[0]._id }).lean();
    expect(episodesBefore).toHaveLength(0);

    // Lazy fetch on demand populates seasons + episodes from the panel.
    const fetchedSeasons = await ensureSeriesSeasons(String(seriesList[0]._id));
    expect(fetchedSeasons).toHaveLength(1);
    const episodes = await Episode.find({ seriesId: seriesList[0]._id }).sort({ episodeNumber: 1 }).lean();
    expect(episodes).toHaveLength(2);
    expect(episodes[0].streamUrl).toBe(`${SERVER}/series/${USER}/${PASS}/30101.mp4`);

    const refreshed = await XtreamSource.findById(source._id).lean();
    expect(refreshed!.syncStatus).toBe('idle');
    expect(refreshed!.lastSyncAt).toBeDefined();
  });

  it('prunes content that disappeared from the panel on re-sync', async () => {
    const source = await makeSource();
    await syncXtreamSource(String(source._id));

    // Panel drops one live channel (id 102)
    mockedAxios.get.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const action = parsed.searchParams.get('action') || undefined;
      const data: any = fixturePayload(action);
      if (action === 'get_live_streams') {
        return { data: (data as any[]).filter((s: any) => s.stream_id !== 102) };
      }
      return { data };
    });

    await syncXtreamSource(String(source._id));

    const gone = await Channel.findOne({ channelId: `xt:${String(source._id)}:102` }).lean();
    expect((gone as any)!.isActive).toBe(false);
    const kept = await Channel.findOne({ channelId: `xt:${String(source._id)}:101` }).lean();
    expect((kept as any)!.isActive).toBe(true);
  });

  it('marks sync as error when the panel is unreachable', async () => {
    const source = await makeSource();
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(syncXtreamSource(String(source._id))).rejects.toThrow();
    const refreshed = await XtreamSource.findById(source._id).lean();
    expect(refreshed!.syncStatus).toBe('error');
    expect(refreshed!.lastError).toBeTruthy();
  });

  it('preserves a manual admin movie disable across re-syncs', async () => {
    const source = await makeSource();
    await syncXtreamSource(String(source._id));

    // Admin manually disables the movie.
    await Movie.updateOne({ sourceId: source._id, externalId: '201' }, { $set: { isActive: false } });

    // Re-sync with the panel unchanged — the disable must survive.
    await syncXtreamSource(String(source._id));

    const movie = await Movie.findOne({ sourceId: source._id, externalId: '201' }).lean();
    expect(movie!.isActive).toBe(false);
  });

  it('preserves a manual admin series disable across re-syncs', async () => {
    const source = await makeSource();
    await syncXtreamSource(String(source._id));

    await Series.updateOne({ sourceId: source._id, externalId: '301' }, { $set: { isActive: false } });
    await syncXtreamSource(String(source._id));

    const series = await Series.findOne({ sourceId: source._id, externalId: '301' }).lean();
    expect(series!.isActive).toBe(false);
  });

  it('keeps pruned movies/series inactive when the panel still lists them as gone', async () => {
    const source = await makeSource();
    await syncXtreamSource(String(source._id));

    // Panel drops the movie (201) and series (301).
    mockedAxios.get.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const action = parsed.searchParams.get('action') || undefined;
      if (action === 'get_vod_streams') return { data: [] };
      if (action === 'get_series') return { data: [] };
      return { data: fixturePayload(action) };
    });
    await syncXtreamSource(String(source._id));

    // Pruned.
    expect((await Movie.findOne({ externalId: '201' }).lean())!.isActive).toBe(false);
    expect((await Series.findOne({ externalId: '301' }).lean())!.isActive).toBe(false);

    // Panel brings them back — a fresh sync re-activates them ONLY on insert;
    // since docs already exist, isActive stays false until an admin re-enables.
    mockedAxios.get.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const action = parsed.searchParams.get('action') || undefined;
      return { data: fixturePayload(action) };
    });
    await syncXtreamSource(String(source._id));

    expect((await Movie.findOne({ externalId: '201' }).lean())!.isActive).toBe(false);
    expect((await Series.findOne({ externalId: '301' }).lean())!.isActive).toBe(false);
  });
});
