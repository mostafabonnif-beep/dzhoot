/**
 * syncSeriesEpisodes parser regression tests.
 *
 * Root cause of "series never play": Xtream's get_series_info returns season
 * METADATA in `seasons[]` and the actual episodes in a DICT `episodes` keyed by
 * season number. The old parser read only `seasons[].episodes` (a panel variant
 * almost nobody emits), so every series imported zero episodes.
 *
 * Mongo is provided by the global src/test/setup.ts (mongodb-memory-server).
 */
const mongoose = require('mongoose');
const axios = require('axios');
const Series = require('../models/Series');
const Season = require('../models/Season');
const Episode = require('../models/Episode');
const XtreamSource = require('../models/XtreamSource');
const xtreamService = require('../services/xtream-service');

const SOURCE_ID = new mongoose.Types.ObjectId();

type LeanEpisode = {
  externalId: string;
  streamUrl?: string;
  description?: string;
  duration?: number | null;
};

const STANDARD_XTREAM = {
  seasons: [
    { season_number: 1, name: 'Season 1', episode_count: 2, cover: 'c1.jpg' },
    { season_number: 2, name: 'Season 2', episode_count: 1, cover: 'c2.jpg' },
  ],
  episodes: {
    1: [
      { id: '101', episode_num: 1, title: 'Pilot', container_extension: 'mp4', info: { plot: 'p1', movie_image: 't1.jpg', duration: '42' } },
      { id: '102', episode_num: 2, title: 'Second', container_extension: 'mkv', info: {} },
    ],
    2: [{ id: '201', episode_num: 1, title: 'Return', container_extension: 'mp4', info: {} }],
  },
};

const EMPTY_SEASONS_BUT_EPISODES = {
  seasons: [],
  episodes: {
    1: [{ id: '301', episode_num: 1, title: 'Only Ep', container_extension: 'mp4', info: {} }],
  },
};

const EMBEDDED_VARIANT = {
  seasons: [
    {
      season_number: 1,
      name: 'Season 1',
      episodes: [{ id: '401', episode_num: 1, title: 'Embedded', container_extension: 'mp4', info: {} }],
    },
  ],
};

function mockSourceLookup() {
  // Bypass the source/creds lookup (encrypted creds are irrelevant here).
  jest.spyOn(XtreamSource, 'findOne').mockReturnValue({
    lean: () => ({ exec: async () => ({ serverUrl: 'http://example.com', usernameEncrypted: 'u', passwordEncrypted: 'p' }) }),
  });
  jest.spyOn(require('../utils/crypto'), 'decryptSecret').mockImplementation((v) => v);
}

async function seedSeries() {
  return Series.create({ sourceId: SOURCE_ID, externalId: '999', title: 'Test Series', isActive: true });
}

afterEach(() => jest.restoreAllMocks());

describe('syncSeriesEpisodes via ensureSeriesSeasons', () => {
  test('standard Xtream format (episodes dict) imports seasons + episodes', async () => {
    const series = await seedSeries();
    jest.spyOn(axios, 'get').mockResolvedValue({ data: STANDARD_XTREAM });
    mockSourceLookup();

    const seasons = await xtreamService.ensureSeriesSeasons(String(series._id));
    expect(seasons.length).toBe(2);

    const episodes = (await Episode.find({ seriesId: series._id }).lean()) as LeanEpisode[];
    expect(episodes.length).toBe(3);
    expect(episodes.map((episode) => episode.externalId).sort()).toEqual(['101', '102', '201']);

    const s1 = await Season.findOne({ seriesId: series._id, seasonNumber: 1 }).lean();
    expect(s1.name).toBe('Season 1');

    const ep101 = episodes.find((episode) => episode.externalId === '101');
    expect(ep101).toBeDefined();
    expect(ep101?.streamUrl).toBe('http://example.com/series/u/p/101.mp4');
    expect(ep101?.description).toBe('p1');

    const stamped = await Series.findById(series._id).lean();
    expect(stamped.episodesFetchedAt).toBeTruthy();
  });

  test('empty seasons array with populated episodes dict still imports (NEO shape)', async () => {
    const series = await seedSeries();
    jest.spyOn(axios, 'get').mockResolvedValue({ data: EMPTY_SEASONS_BUT_EPISODES });
    mockSourceLookup();

    const seasons = await xtreamService.ensureSeriesSeasons(String(series._id));
    expect(seasons.length).toBe(1);
    expect(seasons[0].seasonNumber).toBe(1);

    const episodes = await Episode.find({ seriesId: series._id }).lean();
    expect(episodes.length).toBe(1);
    expect(episodes[0].streamUrl).toBe('http://example.com/series/u/p/301.mp4');
  });

  test('embedded episodes variant still imports (regression guard)', async () => {
    const series = await seedSeries();
    jest.spyOn(axios, 'get').mockResolvedValue({ data: EMBEDDED_VARIANT });
    mockSourceLookup();

    const seasons = await xtreamService.ensureSeriesSeasons(String(series._id));
    expect(seasons.length).toBe(1);
    expect(await Episode.countDocuments({ seriesId: series._id })).toBe(1);
  });

  test('series with no episodes anywhere is stamped (no re-hammer)', async () => {
    const series = await seedSeries();
    jest.spyOn(axios, 'get').mockResolvedValue({ data: { seasons: [], episodes: {} } });
    mockSourceLookup();

    const seasons = await xtreamService.ensureSeriesSeasons(String(series._id));
    expect(seasons.length).toBe(0);
    const stamped = await Series.findById(series._id).lean();
    expect(stamped.episodesFetchedAt).toBeTruthy();
  });

  test('bad duration text does not abort the series; other episodes still import', async () => {
    const series = await seedSeries();
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        seasons: [],
        episodes: {
          1: [
            { id: '501', episode_num: 1, title: 'Bad Duration', container_extension: 'mp4', info: { duration: '45 min' } },
            { id: '502', episode_num: 2, title: 'NaN Duration', container_extension: 'mp4', info: { duration: 'N/A' } },
            { id: '503', episode_num: 3, title: 'Good', container_extension: 'mp4', info: { duration: '42' } },
          ],
        },
      },
    });
    mockSourceLookup();

    await xtreamService.ensureSeriesSeasons(String(series._id));
    const episodes = (await Episode.find({ seriesId: series._id }).lean()) as LeanEpisode[];
    expect(episodes.length).toBe(3);
    const byId = Object.fromEntries(episodes.map((episode) => [episode.externalId, episode.duration]));
    expect(byId['501']).toBe(45);
    expect(byId['502']).toBeNull();
    expect(byId['503']).toBe(42);
  });

  test('upstream failure does NOT stamp (retry on next open)', async () => {
    const series = await seedSeries();
    jest.spyOn(axios, 'get').mockRejectedValue(new Error('panel down'));
    mockSourceLookup();

    const seasons = await xtreamService.ensureSeriesSeasons(String(series._id));
    expect(seasons.length).toBe(0);
    const unstamped = await Series.findById(series._id).lean();
    expect(unstamped.episodesFetchedAt).toBeFalsy();
  });
});
