import { Readable } from 'stream';
import axios from 'axios';
import Channel from '../models/Channel';
import EpgProgram from '../models/EpgProgram';
import { EpgService } from './epg-service';
import EpgSourceOverride from '../models/EpgSourceOverride';

jest.mock('axios');
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn(async (url: string) => ({
    safe: url.startsWith('https://'),
    reason: url.startsWith('https://') ? undefined : 'unsafe URL',
    resolvedAddresses: url.startsWith('https://') ? ['198.51.100.20'] : [],
  })),
  createPinnedLookup: jest.fn(() => undefined),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;



describe('EpgService XMLTV ingestion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-12T06:00:00.000Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('parses XMLTV, respects channel scope, and preserves timezone/title metadata', async () => {
    const startTime = new Date(Date.now() + 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
    const toXmltvDate = (date: Date) => {
      const local = new Date(date.getTime() + 60 * 60 * 1000);
      const pad = (value: number) => String(value).padStart(2, '0');
      return `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(local.getUTCSeconds())} +0100`;
    };
    const xml = `<?xml version="1.0"?><tv>
      <programme start="${toXmltvDate(startTime)}" stop="${toXmltvDate(endTime)}" channel="news.dz">
        <title lang="ar">أخبار الصباح</title>
        <desc lang="ar">ملخص الأخبار</desc>
        <category>News</category>
      </programme>
      <programme start="${toXmltvDate(startTime)}" stop="${toXmltvDate(endTime)}" channel="ignored.dz">
        <title>Ignored</title>
      </programme>
    </tv>`;
    mockedAxios.get.mockResolvedValue({ data: Readable.from([Buffer.from(xml)]) } as any);

    const programs = await new EpgService().fetchAndParseXmltv(
      'https://epg.example/guide.xml',
      ['news.dz'],
    );

    expect(programs).toHaveLength(1);
    expect(programs[0]).toMatchObject({
      channelEpgId: 'news.dz',
      title: 'أخبار الصباح',
      description: 'ملخص الأخبار',
      category: ['News'],
      language: 'ar',
    });
    expect(programs[0].startTime.getTime()).toBe(Math.floor(startTime.getTime() / 1000) * 1000);
  });

  it('reports EPG coverage and unmatched channels per source', async () => {
    const channelQuery = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { channelId: 'news.dz', channelName: 'News DZ', tvgId: 'news.dz', metadata: {} },
        { channelId: 'sports.dz', channelName: 'Sports DZ', tvgId: 'sports.dz', metadata: {} },
      ]),
    };
    jest.spyOn(Channel, 'find').mockReturnValue(channelQuery as any);
    jest.spyOn(EpgProgram, 'distinct').mockResolvedValue(['news.dz'] as any);
    const service = new EpgService();
    jest.spyOn(service, 'discoverEpgSources').mockResolvedValue([
      { url: 'https://epg.example/dz.xml', coveredChannelIds: ['news.dz', 'sports.dz'], source: 'custom' },
    ]);

    const coverage = await service.getCoverage();

    expect(coverage).toMatchObject({
      totalSystemChannels: 2,
      matchedSystemChannels: 1,
      overallCoveragePercent: 50,
      unmatchedChannelCount: 1,
    });
    expect(coverage.sources[0]).toMatchObject({
      source: 'custom',
      coveredChannelCount: 2,
      matchedChannelCount: 1,
      coveragePercent: 50,
    });
    expect(coverage.sources[0].unmatchedChannels[0]).toMatchObject({ channelId: 'sports.dz', name: 'Sports DZ' });
  });

  it('rejects unsafe XMLTV URLs before making a network request', async () => {
    await expect(
      new EpgService().fetchAndParseXmltv('http://127.0.0.1/guide.xml', ['news.dz']),
    ).rejects.toThrow('EPG URL rejected');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

describe('EpgService auto-disable of oversized sources', () => {
  const URL_US = 'https://iptv-epg.org/files/epg-us.xml.gz';

  it('increments consecutiveFailures on failure and resets on success', async () => {
    const service = new EpgService();
    await service.recordSourceResult(URL_US, false, 'EPG XML exceeds maximum decompressed size (100MB)');
    let doc = await EpgSourceOverride.findOne({ url: URL_US });
    expect(doc?.consecutiveFailures).toBe(1);
    expect(doc?.disabled).toBe(false);

    await service.recordSourceResult(URL_US, true);
    doc = await EpgSourceOverride.findOne({ url: URL_US });
    expect(doc?.consecutiveFailures).toBe(0);
    expect(doc?.lastOkAt).toBeTruthy();
  });

  it('auto-disables a source after repeated oversized-guide failures', async () => {
    const service = new EpgService();
    await EpgSourceOverride.create({ url: URL_US, consecutiveFailures: 2, disabled: false });

    await service.recordSourceResult(URL_US, false, 'EPG XML exceeds maximum decompressed size (100MB)');

    const doc = await EpgSourceOverride.findOne({ url: URL_US });
    expect(doc?.consecutiveFailures).toBe(3);
    expect(doc?.disabled).toBe(true);
    expect(doc?.note).toContain('Auto-disabled');
  });

  it('does NOT auto-disable for unrelated (transient) errors', async () => {
    const service = new EpgService();
    await EpgSourceOverride.create({ url: URL_US, consecutiveFailures: 5, disabled: false });

    await service.recordSourceResult(URL_US, false, 'Request failed with status code 503');

    const doc = await EpgSourceOverride.findOne({ url: URL_US });
    expect(doc?.consecutiveFailures).toBe(6);
    expect(doc?.disabled).toBe(false);
  });
});
