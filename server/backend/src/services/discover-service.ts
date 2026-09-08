/**
 * Discover Engine — the intelligence layer that turns a raw 30k-channel
 * catalog into a curated, browsable "platform home".
 *
 * It aggregates, from data the platform ALREADY records:
 *  - trending channels (PlaybackEvent startup_success counts)
 *  - live viewers right now (active stream sessions, Redis)
 *  - what's on now/next (EpgProgram)
 *  - latest VOD additions (Movie/Series createdAt)
 *  - smart collections (rule-based buckets over channel groups/names)
 *
 * Everything is cached (Redis, short TTL) because these queries fan out over
 * tens of thousands of documents and the home page is the hottest path.
 */
import mongoose from 'mongoose';

const Channel = require('../models/Channel');
const Movie = require('../models/Movie');
const Series = require('../models/Series');
const EpgProgram = require('../models/EpgProgram');
const PlaybackEvent = require('../models/PlaybackEvent').default || require('../models/PlaybackEvent');
const { getRedisClient } = require('./redis');
const { publicCatalogPresentationQuery, publicCatalogHideQuery, presentationForChannel, cleanDisplayText } =
  require('../utils/catalog-presentation');

const CACHE_KEY = 'discover:home:v1';
const CACHE_TTL_SECONDS = 60; // home is hot; 60s keeps it fresh and cheap
const TRENDING_WINDOW_HOURS = 48;
const TRENDING_LIMIT = 18;
const LIVE_NOW_LIMIT = 18;
const EPG_NOW_LIMIT = 18;

export interface DiscoverChannelCard {
  _id: string;
  channelId?: string;
  type: 'LIVE';
  name: string;
  logo: string;
  group: string;
  epgKey?: string;
  viewers?: number;
  plays?: number;
  nowPlaying?: { title: string; endsAt: Date | null } | null;
}

interface SessionInfo {
  channelId?: string;
  contentType?: string;
}

/**
 * Count live viewers per channel. Live sessions carry contentName/contentGroup
 * metadata (not a channelId foreign key), so we aggregate viewers per content
 * name and match channels by cleaned name afterwards.
 */
async function getLiveViewerCountsByName(): Promise<{ byName: Map<string, number>; total: number }> {
  const byName = new Map<string, number>();
  let total = 0;
  try {
    const { listActiveStreamSessions } = require('./stream-session-service');
    const sessions = (await listActiveStreamSessions()) as Array<{
      contentType?: string;
      contentName?: string;
    }>;
    total = sessions.length;
    for (const s of sessions) {
      if (s.contentType !== 'live' || !s.contentName) continue;
      const key = cleanDisplayText(s.contentName) || s.contentName;
      byName.set(key, (byName.get(key) || 0) + 1);
    }
  } catch {
    /* Redis down -> live section just renders empty */
  }
  return { byName, total };
}

function presentChannel(c: any): DiscoverChannelCard {
  const p = presentationForChannel(c);
  return {
    _id: String(c._id),
    channelId: c.channelId,
    type: 'LIVE',
    name: cleanDisplayText(c.channelName) || c.channelName,
    logo: c.tvgLogo || c.channelImg || '',
    group: p.group,
    epgKey: c.tvgId || c.channelId || undefined,
  } as DiscoverChannelCard;
}

/** Public-catalog channel filter (shared admin catalog, visible entries). */
function publicChannelFilter(extra: Record<string, unknown> = {}) {
  return {
    $and: [
      { ownerId: null, isActive: { $ne: false } },
      publicCatalogPresentationQuery(),
      publicCatalogHideQuery(),
      extra,
    ],
  };
}

async function getTrendingChannels(viewersByName: Map<string, number>): Promise<DiscoverChannelCard[]> {
  const since = new Date(Date.now() - TRENDING_WINDOW_HOURS * 3600 * 1000);
  const top = await PlaybackEvent.aggregate([
    { $match: { createdAt: { $gte: since }, eventType: 'startup_success' } },
    { $group: { _id: '$channelId', plays: { $sum: 1 } } },
    { $sort: { plays: -1 } },
    { $limit: TRENDING_LIMIT * 3 }, // overfetch; some ids will be filtered out by visibility
  ]).allowDiskUse(true);

  const ids = top.map((t: any) => t._id).filter((id: any) => mongoose.Types.ObjectId.isValid(id));
  if (!ids.length) return [];
  const playsById = new Map<string, number>(top.map((t: any) => [String(t._id), t.plays]));

  const channels = await Channel.find(publicChannelFilter({ _id: { $in: ids } }))
    .select('channelId channelName channelImg tvgLogo tvgId tvgName channelGroup metadata.isWorking')
    .lean();

  const cards = channels
    .map((c: any) => {
      const card = presentChannel(c);
      card.plays = playsById.get(String(c._id)) || 0;
      card.viewers = viewersByName.get(card.name) || 0;
      return card;
    })
    .sort((a: any, b: any) => (b.plays || 0) - (a.plays || 0))
    .slice(0, TRENDING_LIMIT);
  return cards;
}

async function getLiveNowChannels(viewersByName: Map<string, number>): Promise<DiscoverChannelCard[]> {
  if (!viewersByName.size) return [];
  const topNames = [...viewersByName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIVE_NOW_LIMIT * 2)
    .map(([name]) => name);
  const channels = await Channel.find(publicChannelFilter({ channelName: { $in: topNames } }))
    .select('channelId channelName channelImg tvgLogo tvgId tvgName channelGroup')
    .lean();
  return channels
    .map((c: any) => {
      const card = presentChannel(c);
      card.viewers = viewersByName.get(card.name) || 0;
      return card;
    })
    .filter((c: any) => (c.viewers || 0) > 0)
    .sort((a: any, b: any) => (b.viewers || 0) - (a.viewers || 0))
    .slice(0, LIVE_NOW_LIMIT);
}

/** Attach "now playing" EPG titles to channel cards where we have a match.
 *  Programs key on channelEpgId which matches the channel's tvgId or channelId. */
async function attachNowPlaying(cards: DiscoverChannelCard[]): Promise<void> {
  if (!cards.length) return;
  const now = new Date();
  // Collect every identifier a program might be keyed under for these channels.
  const identifiers = new Set<string>();
  for (const c of cards) {
    if (c.epgKey) identifiers.add(String(c.epgKey));
  }
  if (!identifiers.size) return;
  const programs = await EpgProgram.find({
    channelEpgId: { $in: [...identifiers] },
    startTime: { $lte: now },
    endTime: { $gte: now },
  })
    .select('channelEpgId title endTime')
    .lean();
  const byEpgId = new Map<string, any>(programs.map((p: any) => [p.channelEpgId, p]));
  for (const card of cards) {
    if (card.epgKey && byEpgId.has(String(card.epgKey))) {
      const p = byEpgId.get(String(card.epgKey));
      card.nowPlaying = { title: p.title, endsAt: p.endTime || null };
    }
  }
}

/** Rule-based smart collections over the public catalog (country/genre). */
const COLLECTION_RULES: Array<{ key: string; titleAr: string; titleEn: string; match: RegExp }> = [
  { key: 'sports', titleAr: 'رياضة', titleEn: 'Sports', match: /sport|bein|رياضة|kass|ssc|dazn|foot/i },
  { key: 'news', titleAr: 'أخبار', titleEn: 'News', match: /news|أخبار|aljazeera|alarabiya|bbc|france24|sky news/i },
  { key: 'kids', titleAr: 'أطفال', titleEn: 'Kids', match: /kids|أطفال|cartoon|spacetoon|cn |boomerang|jeem|baraem/i },
  { key: 'movies', titleAr: 'أفلام', titleEn: 'Movies', match: /cinema|movie|film|أفلام|rotana|mbc.*action|ifilm/i },
  { key: 'series', titleAr: 'مسلسلات', titleEn: 'Series', match: /series|مسلسل|drama|ت-series|mbc.*drama/i },
  { key: 'algeria', titleAr: 'الجزائر', titleEn: 'Algeria', match: /alger|entv|echourouk|ennahar|el bilad|dz|الجزائر/i },
];

async function getSmartCollections() {
  const groups = await Channel.aggregate([
    { $match: publicChannelFilter() },
    { $group: { _id: '$channelGroup', count: { $sum: 1 } } },
  ]).allowDiskUse(true);
  const groupNames: string[] = groups.map((g: any) => g._id || '');
  return COLLECTION_RULES.map((rule) => {
    const matched = groupNames.filter((g) => rule.match.test(g));
    const count = groups
      .filter((g: any) => rule.match.test(g._id || ''))
      .reduce((sum: number, g: any) => sum + g.count, 0);
    return {
      key: rule.key,
      titleAr: rule.titleAr,
      titleEn: rule.titleEn,
      groups: matched.slice(0, 40),
      channelCount: count,
    };
  }).filter((c) => c.channelCount > 0);
}

export async function buildDiscoverHome() {
  const { byName: viewersByName, total: totalViewers } = await getLiveViewerCountsByName();
  const [trending, liveNow, latestMovies, latestSeries, collections, totalChannels] = await Promise.all([
    getTrendingChannels(viewersByName),
    getLiveNowChannels(viewersByName),
    Movie.find({ isActive: true }).sort({ createdAt: -1 }).limit(14).select('title poster category createdAt').lean(),
    Series.find({ isActive: true }).sort({ createdAt: -1 }).limit(14).select('title poster category createdAt').lean(),
    getSmartCollections(),
    Channel.countDocuments(publicChannelFilter()),
  ]);

  await attachNowPlaying(trending);
  await attachNowPlaying(liveNow);

  return {
    generatedAt: new Date().toISOString(),
    stats: { totalChannels, liveViewers: totalViewers },
    trending,
    liveNow,
    latestMovies: latestMovies.map((m: any) => ({
      _id: m._id,
      type: 'MOVIE',
      name: m.title,
      poster: m.poster,
      category: m.category,
    })),
    latestSeries: latestSeries.map((s: any) => ({
      _id: s._id,
      type: 'SERIES',
      name: s.title,
      poster: s.poster,
      category: s.category,
    })),
    collections,
  };
}

/** Cached home payload. Serves from Redis when hot; rebuilds otherwise. */
export async function getDiscoverHome(forceRefresh = false) {
  const redis = getRedisClient();
  if (redis && !forceRefresh) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch {
      /* fall through to rebuild */
    }
  }
  const payload = await buildDiscoverHome();
  if (redis) {
    redis.set(CACHE_KEY, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS).catch(() => {});
  }
  return payload;
}
