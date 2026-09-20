/**
 * Segment reachability and provider placeholders.
 *
 * Two defects measured on production on 2026-09-20, both of them hiding content from
 * customers or mislabelling why it is missing:
 *
 * 1. The deep probe asked for the first segment with `HEAD`. A CDN that answers HEAD with
 *    405/403 — while serving the same URL to a ranged GET — made a healthy channel look
 *    dead, and the health pipeline hides a dead channel from customer endpoints.
 * 2. When a provider's account expires it keeps answering with a *valid* manifest whose
 *    only segment is a short black clip (`black.ts`). That was reported as a generic
 *    "all sources dead", which sends an operator debugging probes instead of renewing the
 *    subscription (16,707 channels were in that state).
 */

jest.mock('axios');
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn().mockResolvedValue({ safe: true, resolvedAddresses: ['93.184.216.34'] }),
  isPrivateIP: jest.fn().mockReturnValue(false),
  createPinnedLookup: jest.fn().mockReturnValue(() => undefined),
}));

import axios from 'axios';
import { probeStream } from '../services/stream-prober';

const LIVE_MANIFEST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:6',
  '#EXTINF:6.00,',
  'segment-1.ts',
  '#EXTINF:6.00,',
  'segment-2.ts',
].join('\n');

const PLACEHOLDER_MANIFEST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXT-X-ALLOW-CACHE:YES',
  '#EXT-X-TARGETDURATION:11',
  '#EXTINF:15.0,',
  'http://video2.c2.wdcdn8s.com/video/black.ts',
  '#EXT-X-ENDLIST',
].join('\n');

const mockedGet = axios.get as unknown as jest.Mock;
const mockedHead = axios.head as unknown as jest.Mock;

/** The manifest fetch is a text GET; the ranged segment check is a stream GET. */
function routeGet(manifest: string, segmentStatus: number) {
  mockedGet.mockImplementation((url: string) => {
    if (String(url).includes('.m3u8')) {
      return Promise.resolve({ status: 200, data: manifest, request: { socket: { destroy: jest.fn() } } });
    }
    return Promise.resolve({
      status: segmentStatus,
      data: { destroy: jest.fn() },
      request: { socket: { destroy: jest.fn() } },
    });
  });
}

describe('probeStream — first segment check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps a channel alive when the CDN refuses HEAD but serves a ranged GET', async () => {
    routeGet(LIVE_MANIFEST, 206);
    // The CDN answers HEAD with 405 — the exact shape that used to mark the channel dead.
    mockedHead.mockRejectedValue(new Error('Request failed with status code 405'));

    const result = await probeStream('http://cdn.example.com/live/channel.m3u8', { timeout: 8000 });

    expect(result.segmentReachable).toBe(true);
    expect(result.status).toBe('alive');
  });

  it('still treats a genuinely unreachable segment as dead', async () => {
    routeGet(LIVE_MANIFEST, 404);
    mockedHead.mockRejectedValue(new Error('Request failed with status code 404'));

    const result = await probeStream('http://cdn.example.com/live/channel.m3u8', { timeout: 8000 });

    expect(result.segmentReachable).toBe(false);
    expect(result.status).toBe('dead');
  });

  it('names the provider placeholder instead of reporting a generic dead channel', async () => {
    routeGet(PLACEHOLDER_MANIFEST, 200);
    mockedHead.mockResolvedValue({ status: 200 });

    const result = await probeStream('http://tv.provider.example/live/751681.m3u8', { timeout: 8000 });

    expect(result.status).toBe('dead');
    expect(result.error).toContain('Placeholder segment (black.ts)');
    // The manifest itself is syntactically fine — that is what made this so misleading.
    expect(result.manifestValid).toBe(true);
  });

  it('does not flag a real live manifest as a placeholder', async () => {
    routeGet(LIVE_MANIFEST, 206);
    mockedHead.mockResolvedValue({ status: 200 });

    const result = await probeStream('http://cdn.example.com/live/channel.m3u8', { timeout: 8000 });

    expect(result.status).toBe('alive');
    expect(result.error).toBeNull();
  });
});
