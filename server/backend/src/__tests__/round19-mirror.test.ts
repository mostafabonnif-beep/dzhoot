/**
 * Round 19 — Xtream source MIRROR domains (same panel, same account).
 *
 * Covers the server-side mirror helpers: endpoint candidates, stream-URL
 * rewriting, and the automatic API fallback (primary domain down → mirror).
 */
import { endpointCandidates, rewriteStreamUrlBase, testXtreamConnection } from '../services/xtream-service';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const axios = require('axios');

describe('Round 19 — Xtream mirror domains', () => {
  beforeEach(() => {
    (axios.get as jest.Mock).mockReset();
  });

  it('endpointCandidates returns [primary, ...mirrors] normalized and de-duplicated', () => {
    expect(endpointCandidates({
      serverUrl: 'https://cf.business-cloud-neo.ru/',
      mirrorServerUrls: ['http://tv.business-cloud-neo.com', 'https://cf.business-cloud-neo.ru'],
      username: 'u', password: 'p',
    })).toEqual(['https://cf.business-cloud-neo.ru', 'http://tv.business-cloud-neo.com']);
    expect(endpointCandidates({ serverUrl: 'http://a.test', username: 'u', password: 'p' })).toEqual(['http://a.test']);
  });

  it('rewriteStreamUrlBase swaps only the origin and keeps path + format', () => {
    expect(rewriteStreamUrlBase(
      'https://cf.business-cloud-neo.ru/live/u/p/262849.ts',
      'http://tv.business-cloud-neo.com',
    )).toBe('http://tv.business-cloud-neo.com/live/u/p/262849.ts');
    expect(rewriteStreamUrlBase(
      'https://cf.business-cloud-neo.ru/live/u/p/262849.m3u8?token=abc',
      'http://tv.business-cloud-neo.com/',
    )).toBe('http://tv.business-cloud-neo.com/live/u/p/262849.m3u8?token=abc');
    expect(rewriteStreamUrlBase('not a url', 'http://tv.test')).toBeNull();
  });

  it('testXtreamConnection falls back to the mirror when the primary API is unreachable', async () => {
    (axios.get as jest.Mock)
      .mockRejectedValueOnce(new Error('ECONNREFUSED')) // primary cf
      .mockResolvedValueOnce({ data: { user_info: { auth: 1, username: 'u' }, server_info: { url: 'tv.business-cloud-neo.com' } } }); // mirror tv

    const result = await testXtreamConnection({
      serverUrl: 'https://cf.business-cloud-neo.ru',
      mirrorServerUrls: ['http://tv.business-cloud-neo.com'],
      username: 'u', password: 'p',
    });
    expect(result.ok).toBe(true);
    expect(result.serverInfo?.url).toBe('tv.business-cloud-neo.com');
    const urls = (axios.get as jest.Mock).mock.calls.map((c: any) => String(c[0]));
    expect(urls[0]).toContain('cf.business-cloud-neo.ru');
    expect(urls[1]).toContain('tv.business-cloud-neo.com');
  });

  it('testXtreamConnection rejects only after primary AND mirrors are dead', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(testXtreamConnection({
      serverUrl: 'https://cf.business-cloud-neo.ru',
      mirrorServerUrls: ['http://tv.business-cloud-neo.com'],
      username: 'u', password: 'p',
    })).rejects.toThrow('ECONNREFUSED');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
