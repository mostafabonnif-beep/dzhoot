import mongoose from 'mongoose';
import PlaybackEvent from '../models/PlaybackEvent';

const Channel = require('../models/Channel');
const { buildDiscoverHome } = require('./discover-service');

describe('discover service', () => {
  beforeEach(async () => {
    await PlaybackEvent.deleteMany({});
    await Channel.deleteMany({});
  });

  it('ranks trending channels by recent successful plays and respects visibility', async () => {
    const [visible, hidden] = await Channel.create([
      {
        channelId: 'ch-visible',
        channelName: 'Visible Sports HD',
        channelUrl: 'https://example.com/a.m3u8',
        channelGroup: 'Sports',
        ownerId: null,
        isActive: true,
      },
      {
        channelId: 'ch-hidden',
        channelName: 'Hidden Channel',
        channelUrl: 'https://example.com/b.m3u8',
        channelGroup: 'Sports',
        ownerId: null,
        isActive: false, // inactive -> excluded from public catalog
      },
    ]);

    // hidden gets MORE plays than visible — it still must not appear.
    await PlaybackEvent.create([
      { channelId: hidden._id, eventType: 'startup_success' },
      { channelId: hidden._id, eventType: 'startup_success' },
      { channelId: hidden._id, eventType: 'startup_success' },
      { channelId: visible._id, eventType: 'startup_success' },
    ]);

    const home = await buildDiscoverHome();
    expect(home.stats.totalChannels).toBe(1);
    const names = home.trending.map((c: { name: string }) => c.name);
    expect(names).toContain('Visible Sports HD');
    expect(names).not.toContain('Hidden Channel');
  });

  it('builds smart collections from channel groups', async () => {
    await Channel.create([
      {
        channelId: 's1',
        channelName: 'beIN Sports 1',
        channelUrl: 'https://example.com/s1.m3u8',
        channelGroup: 'beIN Sports',
        ownerId: null,
        isActive: true,
      },
      {
        channelId: 'n1',
        channelName: 'Al Jazeera',
        channelUrl: 'https://example.com/n1.m3u8',
        channelGroup: 'News',
        ownerId: null,
        isActive: true,
      },
    ]);

    const home = await buildDiscoverHome();
    const keys = home.collections.map((c: { key: string }) => c.key);
    expect(keys).toContain('sports');
    expect(keys).toContain('news');
  });

  it('returns an empty (but valid) home when the catalog is empty', async () => {
    const home = await buildDiscoverHome();
    expect(home.trending).toEqual([]);
    expect(home.liveNow).toEqual([]);
    expect(home.stats.totalChannels).toBe(0);
    expect(Array.isArray(home.collections)).toBe(true);
  });
});
