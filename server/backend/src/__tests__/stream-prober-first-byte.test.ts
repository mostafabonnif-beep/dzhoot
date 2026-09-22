/**
 * Raw (non-HLS) probes must require a byte, not just a status line.
 *
 * Measured 2026-09-21 on a live provider: `.../live/USER/PASS/<id>.ts` answered `200` and then
 * sent nothing, repeatedly, while the same stream id served a valid manifest as `.m3u8`. The
 * probe used to call that channel alive on the status line alone, so the visibility gate kept
 * publishing it and the customer sat on a black screen forever.
 *
 * The customer-facing relay already refuses to publish a silent upstream
 * (`upstream-proxy.ts`); these tests pin the same rule on the probe that feeds the health
 * pipeline, which is what decides whether a channel is shown at all.
 */

jest.mock('axios');
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn().mockResolvedValue({ safe: true, resolvedAddresses: ['93.184.216.34'] }),
  isPrivateIP: jest.fn().mockReturnValue(false),
  createPinnedLookup: jest.fn().mockReturnValue(() => undefined),
}));

import { PassThrough } from 'stream';
import axios from 'axios';
import { probeStream } from '../services/stream-prober';

const RAW_TS_URL = 'http://provider.example/live/dz-user/secret/297641.ts';
const mockedGet = axios.get as unknown as jest.Mock;

/** A raw stream that produces `payload` (nothing when omitted) and then ends. */
function rawResponse(payload?: Buffer) {
  const body = new PassThrough();
  setImmediate(() => {
    if (payload) body.write(payload);
    body.end();
  });
  return { status: 200, data: body, request: { socket: { destroy: jest.fn() } } };
}

describe('probeStream — raw streams require the first byte', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STREAM_PROBE_REQUIRE_BYTES;
  });

  it('reports a 200 with an empty body as dead, not alive', async () => {
    mockedGet.mockResolvedValue(rawResponse());

    const result = await probeStream(RAW_TS_URL);

    expect(result.status).toBe('dead');
    expect(result.statusCode).toBe(200);
    expect(result.error).toMatch(/0 bytes/i);
  });

  it('keeps a raw stream alive as soon as one byte arrives', async () => {
    // 0x47 is the MPEG-TS sync byte.
    mockedGet.mockResolvedValue(rawResponse(Buffer.from([0x47, 0x40, 0x11, 0x10])));

    const result = await probeStream(RAW_TS_URL);

    expect(result.status).toBe('alive');
    expect(result.error).toBeNull();
  });

  it('honours requireBody:false for callers that only need reachability', async () => {
    mockedGet.mockResolvedValue(rawResponse());

    const result = await probeStream(RAW_TS_URL, { requireBody: false });

    expect(result.status).toBe('alive');
  });

  it('honours the STREAM_PROBE_REQUIRE_BYTES=false escape hatch process-wide', async () => {
    process.env.STREAM_PROBE_REQUIRE_BYTES = 'false';
    mockedGet.mockResolvedValue(rawResponse());

    const result = await probeStream(RAW_TS_URL);

    expect(result.status).toBe('alive');
  });
});
