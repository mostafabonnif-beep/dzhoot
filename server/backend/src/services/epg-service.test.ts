import { Readable } from 'stream';
import axios from 'axios';
import { EpgService } from './epg-service';

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

  it('rejects unsafe XMLTV URLs before making a network request', async () => {
    await expect(
      new EpgService().fetchAndParseXmltv('http://127.0.0.1/guide.xml', ['news.dz']),
    ).rejects.toThrow('EPG URL rejected');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
