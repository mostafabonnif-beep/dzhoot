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
  beforeEach(() => jest.clearAllMocks());

  it('parses XMLTV, respects channel scope, and preserves timezone/title metadata', async () => {
    const xml = `<?xml version="1.0"?><tv>
      <programme start="20260812080000 +0100" stop="20260812090000 +0100" channel="news.dz">
        <title lang="ar">أخبار الصباح</title>
        <desc lang="ar">ملخص الأخبار</desc>
        <category>News</category>
      </programme>
      <programme start="20260812080000 +0100" stop="20260812090000 +0100" channel="ignored.dz">
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
    expect(programs[0].startTime.toISOString()).toBe('2026-08-12T07:00:00.000Z');
  });

  it('rejects unsafe XMLTV URLs before making a network request', async () => {
    await expect(
      new EpgService().fetchAndParseXmltv('http://127.0.0.1/guide.xml', ['news.dz']),
    ).rejects.toThrow('EPG URL rejected');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
