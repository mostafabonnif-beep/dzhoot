import mongoose from 'mongoose';
import axios from 'axios';
import XtreamSource from '../models/XtreamSource';
import Channel from '../models/Channel';
import Movie from '../models/Movie';
import Series from '../models/Series';
import Season from '../models/Season';
import Episode from '../models/Episode';
import { syncXtreamSource, buildXtreamApiUrl } from '../services/xtream-service';
import { encryptSecret, decryptSecret } from '../utils/crypto';

jest.mock('axios');
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn(async () => ({ safe: true, resolvedAddresses: ['198.51.100.10'] })),
  createPinnedLookup: jest.fn(() => undefined),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

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
    const entv = channels.find((c) => c.channelName === 'ENTV')!;
    expect(entv.channelUrl).toBe(`${SERVER}/live/${USER}/${PASS}/101.m3u8`);
    expect(entv.channelGroup).toBe('Algeria');
    expect(entv.tvgId).toBe('ENTV.epg');
    expect((entv.metadata as any).source).toBe('xtream');

    // Movies
    const movies = await Movie.find({ sourceId: source._id }).lean();
    expect(movies).toHaveLength(1);
    expect(movies[0].streamUrl).toBe(`${SERVER}/movie/${USER}/${PASS}/201.mp4`);
    expect(movies[0].title).toBe('Inception');
    expect(movies[0].rating).toBe(8.8);

    // Series + seasons + episodes
    const seriesList = await Series.find({ sourceId: source._id }).lean();
    expect(seriesList).toHaveLength(1);
    const seasons = await Season.find({ seriesId: seriesList[0]._id }).lean();
    expect(seasons).toHaveLength(1);
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
});
