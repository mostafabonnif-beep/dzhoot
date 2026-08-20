import mongoose from 'mongoose';
import EpgProgram from '../models/EpgProgram';
import { epgService } from '../services/epg-service';

/**
 * Audit-remediation-v1 regression test: a failing EPG source must never stop
 * the whole refresh task. The refresh completes, good sources are persisted,
 * and the failing sources are recorded as errors.
 */
describe('epg-service refresh resilience (audit-remediation-v1)', () => {
  const goodSource = (name: string, suffix: string) => ({
    url: `https://epg.example.com/${suffix}.xml.gz`,
    coveredChannelIds: [`channel-${suffix}`],
    source: name,
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    // The RSS guard is a production safety mechanism. Keep this regression test
    // deterministic even when the Jest worker itself is memory-heavy in CI.
    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 256 * 1024 * 1024,
      heapTotal: 128 * 1024 * 1024,
      heapUsed: 64 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    });
  });

  afterEach(async () => {
    epgService.stopBackgroundUpdates();
  });

  it('one failing source does not abort the refresh; others are persisted', async () => {
    const sources = [
      goodSource('ok:first', 'first'),
      { ...goodSource('fail:broken', 'broken'), url: 'https://epg.example.com/broken.xml.gz' },
      goodSource('ok:second', 'second'),
      { ...goodSource('fail:missing', 'missing'), url: 'https://epg.example.com/missing.xml.gz' },
      goodSource('ok:third', 'third'),
    ];

    jest.spyOn(epgService, 'discoverEpgSources').mockResolvedValue(sources as any);
    jest.spyOn(epgService, 'fetchAndParseXmltv').mockImplementation(async (url: string) => {
      if (url.includes('broken') || url.includes('missing')) {
        throw new Error('HTTP 404');
      }
      const channelId = url.match(/(first|second|third)/)?.[1] || 'x';
      const base = Date.now();
      return [
        {
          channelEpgId: `channel-${channelId}`,
          title: `Program ${channelId}`,
          description: null,
          category: [],
          startTime: new Date(base - 3600000),
          endTime: new Date(base + 3600000),
          icon: null,
          language: null,
        },
      ];
    });

    await expect(epgService.refreshEpg()).resolves.toBeUndefined();

    // Good sources persisted their programmes.
    const persisted = await EpgProgram.find().lean();
    const titles = persisted.map((p) => p.title).sort();
    expect(titles).toEqual(['Program first', 'Program second', 'Program third']);

    // Failing sources were recorded as errors — the task still completed.
    const stats = await epgService.getStats();
    expect(stats.lastRefreshErrorCount).toBe(2);
    expect(stats.lastRefreshErrorSources.sort()).toEqual(['fail:broken', 'fail:missing']);
    expect(stats.lastRefreshProgramCount).toBe(3);
  });

  it('a refresh with zero sources completes cleanly without touching the DB', async () => {
    jest.spyOn(epgService, 'discoverEpgSources').mockResolvedValue([]);

    await expect(epgService.refreshEpg()).resolves.toBeUndefined();
    const stats = await epgService.getStats();
    expect(stats.sourcesDiscovered).toBe(0);
    expect(stats.lastRefreshErrorCount).toBe(0);
  });

  it('a fully failing refresh still completes and reports every failure', async () => {
    const sources = [goodSource('fail:a', 'a'), goodSource('fail:b', 'b')];
    jest.spyOn(epgService, 'discoverEpgSources').mockResolvedValue(sources as any);
    jest.spyOn(epgService, 'fetchAndParseXmltv').mockRejectedValue(new Error('network down'));

    await expect(epgService.refreshEpg()).resolves.toBeUndefined();
    const stats = await epgService.getStats();
    expect(stats.lastRefreshErrorCount).toBe(2);
    expect(stats.lastRefreshProgramCount).toBe(0);
    expect(await EpgProgram.countDocuments()).toBe(0);
  });
});
