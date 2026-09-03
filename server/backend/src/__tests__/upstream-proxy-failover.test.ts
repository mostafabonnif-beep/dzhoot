/**
 * Mid-stream failover: when the proxied upstream connection dies mid-playback,
 * proxyUpstreamStream must resolve a failover target (priority cascade) and
 * keep pumping into the SAME client response — the stream never hard-stops.
 */
import { PassThrough, Writable } from 'stream';
import { EventEmitter } from 'events';
import axios from 'axios';
import { proxyUpstreamStream } from '../services/upstream-proxy';
import { getFailoverTarget } from '../services/source-failover-service';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn().mockResolvedValue({ safe: true, resolvedAddresses: ['93.184.216.34'] }),
  createPinnedLookup: jest.fn(() => () => {}),
  isPrivateIP: jest.fn(() => false),
}));
jest.mock('../services/source-failover-service', () => ({
  getFailoverTarget: jest.fn(),
}));
jest.mock('../models/Channel', () => ({
  __esModule: true,
  default: {
    findById: jest.fn(() => ({
      select: () => ({ lean: async () => ({ _id: 'ch-1', channelId: 'CH-1' }) }),
    })),
    findOne: jest.fn(() => ({
      select: () => ({ lean: async () => ({ _id: 'ch-1', channelId: 'CH-1' }) }),
    })),
  },
}));

const axiosGet = axios.get as jest.Mock;
const mockGetFailoverTarget = getFailoverTarget as jest.Mock;

function makeRes() {
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk: Buffer | string, _enc: any, cb: () => void) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  }) as any;
  res.headersSent = false;
  res.setHeader = () => undefined;
  res.set = () => res;
  res.status = () => res;
  res.send = (body: any) => {
    if (Buffer.isBuffer(body)) chunks.push(body);
    else if (body) chunks.push(Buffer.from(String(body)));
  };
  res.getChunks = () => Buffer.concat(chunks);
  return res;
}

function tsResponse(stream: PassThrough, url: string) {
  return {
    status: 200,
    headers: { 'content-type': 'video/mp2t' },
    request: { res: { responseUrl: url } },
    data: stream,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFailoverTarget.mockResolvedValue({
    streamUrl: 'http://backup.example/live/u/p/999.ts',
    source: { _id: 'bk-1', directPlayback: true },
  });
});

it('keeps pumping into the SAME client response when the primary dies mid-stream', async () => {
  const primary = new PassThrough();
  const backup = new PassThrough();
  axiosGet
    .mockResolvedValueOnce(tsResponse(primary, 'http://primary.example/live/u/p/1.ts'))
    .mockResolvedValueOnce(tsResponse(backup, 'http://backup.example/live/u/p/999.ts'));

  const req = new EventEmitter() as any;
  req.headers = {};
  const res = makeRes();

  const done = proxyUpstreamStream(
    req, res,
    'http://primary.example/live/u/p/1.ts',
    undefined, undefined, undefined,
    { channelId: 'ch-1', primarySourceId: 'src-1' },
  );

  await new Promise((r) => setImmediate(r));
  primary.write(Buffer.from('PRIMARY-BYTES'));
  primary.emit('error', Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })); // upstream dies mid-play

  await new Promise((r) => setTimeout(r, 50));
  backup.write(Buffer.from('BACKUP-BYTES'));
  backup.end();
  await done;

  const out = res.getChunks().toString();
  expect(out).toContain('PRIMARY-BYTES');
  expect(out).toContain('BACKUP-BYTES');
  expect(mockGetFailoverTarget).toHaveBeenCalledWith(
    expect.objectContaining({ channelId: 'CH-1' }),
    'src-1',
  );
});

it('does NOT fail over when no failover context is provided', async () => {
  const primary = new PassThrough();
  axiosGet.mockResolvedValueOnce(tsResponse(primary, 'http://primary.example/live/u/p/1.ts'));

  const req = new EventEmitter() as any;
  req.headers = {};
  const res = makeRes();

  const done = proxyUpstreamStream(req, res, 'http://primary.example/live/u/p/1.ts');
  await new Promise((r) => setImmediate(r));
  primary.write(Buffer.from('ONLY-PRIMARY'));
  primary.emit('error', Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }));
  await done;

  const out = res.getChunks().toString();
  expect(out).toContain('ONLY-PRIMARY');
  expect(mockGetFailoverTarget).not.toHaveBeenCalled();
  expect(axiosGet).toHaveBeenCalledTimes(1);
});

it('fails over at OPEN time when the primary fetch errors before bytes flow', async () => {
  const backup = new PassThrough();
  // Non-transient upstream error (403) → no retry, straight to failover.
  axiosGet
    .mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { response: { status: 403 } }))
    .mockResolvedValueOnce(tsResponse(backup, 'http://backup.example/live/u/p/999.ts'));

  const req = new EventEmitter() as any;
  req.headers = {};
  const res = makeRes();

  const done = proxyUpstreamStream(
    req, res,
    'http://primary.example/live/u/p/1.ts',
    undefined, undefined, undefined,
    { channelId: 'ch-1', primarySourceId: 'src-1' },
  );
  await new Promise((r) => setImmediate(r));
  backup.write(Buffer.from('BACKUP-AT-OPEN'));
  backup.end();
  await done;

  const out = res.getChunks().toString();
  expect(out).toContain('BACKUP-AT-OPEN');
  expect(axiosGet).toHaveBeenCalledTimes(2);
});
