import { EventEmitter } from 'events';

// Force a tiny concurrency cap so the "busy" path is testable.
process.env.MAX_HLS_REMUX = '1';
process.env.HLS_IDLE_MS = '60000';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require('child_process');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const remux = require('./hls-remux-service');

class FakeProc extends EventEmitter {
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stderr = { on: jest.fn() };
  kill = jest.fn((signal?: string) => {
    this.killed = true;
    this.exitCode = signal ? -1 : 0;
    // Mirror real behavior: killing emits 'exit'.
    setImmediate(() => this.emit('exit', this.exitCode, signal ?? null));
  });
}

function mockSpawn(): jest.Mock {
  const mock = spawn as jest.Mock;
  mock.mockReset();
  const procs: FakeProc[] = [];
  mock.mockImplementation(() => {
    const p = new FakeProc();
    procs.push(p);
    return p;
  });
  return mock;
}

beforeEach(() => {
  remux.shutdownHlsSessions();
});

const A = 'token-aaaaaaaa';
const B = 'token-bbbbbbbb';
const C = 'token-cccccccc';
const URL1 = 'http://panel.example/live/u/p/101.m3u8';
const URL2 = 'http://panel.example/live/u/p/202.m3u8';
const RELAY_PROXY = 'http://172.18.0.1:9001';

describe('upstream egress proxy args (regression: no -https_proxy)', () => {
  const ORIG_PROXY = process.env.UPSTREAM_HTTP_PROXY;
  const ORIG_HOSTS = process.env.UPSTREAM_PROXY_HOSTS;

  afterEach(() => {
    if (ORIG_PROXY === undefined) delete process.env.UPSTREAM_HTTP_PROXY;
    else process.env.UPSTREAM_HTTP_PROXY = ORIG_PROXY;
    if (ORIG_HOSTS === undefined) delete process.env.UPSTREAM_PROXY_HOSTS;
    else process.env.UPSTREAM_PROXY_HOSTS = ORIG_HOSTS;
  });

  it('never passes -https_proxy to ffmpeg (it is not a real ffmpeg option)', () => {
    process.env.UPSTREAM_HTTP_PROXY = RELAY_PROXY;
    const spawnMock = mockSpawn();
    remux.startHlsSession('tok-ua-regress', {
      streamUrl: 'http://tv.business-cloud-neo.com/live/u/p/101.m3u8',
    });
    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).not.toContain('-https_proxy');
    expect(args).not.toContain('https_proxy');
  });

  it('routes the WAF-blocked panel host through the residential proxy', () => {
    process.env.UPSTREAM_HTTP_PROXY = RELAY_PROXY;
    const spawnMock = mockSpawn();
    remux.startHlsSession('tok-proxy-a', {
      streamUrl: 'http://tv.business-cloud-neo.com/live/u/p/101.m3u8',
    });
    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).toContain('-http_proxy');
    expect(args[args.indexOf('-http_proxy') + 1]).toBe(RELAY_PROXY);
  });

  it('keeps direct fetch (no proxy args) for hosts that allow datacenter IPs', () => {
    process.env.UPSTREAM_HTTP_PROXY = RELAY_PROXY;
    const spawnMock = mockSpawn();
    remux.startHlsSession('tok-proxy-b', {
      streamUrl: 'https://cf.business-cloud-neo.ru/live/u/p/202.m3u8',
    });
    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).not.toContain('-http_proxy');
    expect(args).not.toContain('-https_proxy');
  });

  it('honors a custom UPSTREAM_PROXY_HOSTS allowlist', () => {
    process.env.UPSTREAM_HTTP_PROXY = RELAY_PROXY;
    process.env.UPSTREAM_PROXY_HOSTS = 'proxy.example.com';
    const spawnMock = mockSpawn();
    remux.startHlsSession('tok-proxy-c', {
      streamUrl: 'http://tv.business-cloud-neo.com/live/u/p/303.m3u8',
    });
    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).not.toContain('-http_proxy');
    remux.stopHlsSession('tok-proxy-c');
    remux.startHlsSession('tok-proxy-d', {
      streamUrl: 'http://proxy.example.com/live/u/p/404.m3u8',
    });
    const args2: string[] = spawnMock.mock.calls[1][1];
    expect(args2).toContain('-http_proxy');
  });
});


describe('hls-remux shared sessions (D1)', () => {
  it('spawns ONE ffmpeg for many viewers of the same stream', () => {
    const spawnMock = mockSpawn();
    expect(remux.startHlsSession(A, { streamUrl: URL1 }).ok).toBe(true);
    expect(remux.startHlsSession(B, { streamUrl: URL1 }).ok).toBe(true);
    expect(remux.startHlsSession(C, { streamUrl: URL1 }).ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    // All viewers resolve to the same shared session dir.
    const dirA = remux.getHlsSession(A)?.dir;
    expect(remux.getHlsSession(B)?.dir).toBe(dirA);
    expect(remux.getHlsSession(C)?.dir).toBe(dirA);
  });

  it('spawns a separate ffmpeg for a different stream (sequentially)', async () => {
    const spawnMock = mockSpawn();
    remux.startHlsSession(A, { streamUrl: URL1 });
    remux.stopHlsSession(A); // close stream 1
    await new Promise((r) => setImmediate(r)); // let the exit cleanup run
    remux.startHlsSession(B, { streamUrl: URL2 });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('respects MAX_HLS_REMUX per distinct stream (busy for a 2nd stream)', () => {
    mockSpawn();
    expect(remux.startHlsSession(A, { streamUrl: URL1 }).ok).toBe(true);
    // Same stream joins fine (capacity is per PROCESS, not per viewer).
    expect(remux.startHlsSession(C, { streamUrl: URL1 }).ok).toBe(true);
    // A second distinct stream hits the cap (MAX_HLS_REMUX=1).
    const second = remux.startHlsSession(B, { streamUrl: URL2 });
    expect(second.ok).toBe(false);
    expect((second as { busy?: boolean }).busy).toBe(true);
  });

  it('kills the shared ffmpeg only when the LAST viewer leaves', async () => {
    mockSpawn();
    remux.startHlsSession(A, { streamUrl: URL1 });
    remux.startHlsSession(B, { streamUrl: URL1 });
    const proc = remux.getHlsSession(A)!.proc as unknown as FakeProc;
    expect(proc.kill).not.toHaveBeenCalled();

    remux.stopHlsSession(A);
    expect(proc.kill).not.toHaveBeenCalled(); // B still watching
    expect(remux.getHlsSession(B)).not.toBeNull();

    remux.stopHlsSession(B);
    expect(proc.kill).toHaveBeenCalledTimes(1); // last viewer gone
    expect(remux.getHlsSession(A)).toBeNull();
    expect(remux.getHlsSession(B)).toBeNull();
  });

  it('a viewer that idles out does not kill the stream for the others', () => {
    mockSpawn();
    remux.startHlsSession(A, { streamUrl: URL1 });
    remux.startHlsSession(B, { streamUrl: URL1 });
    const proc = remux.getHlsSession(A)!.proc as unknown as FakeProc;
    // Simulate the idle sweep dropping viewer A only.
    remux.stopHlsSession(A);
    expect(proc.kill).not.toHaveBeenCalled();
    expect(remux.getHlsSession(B)?.dir).toBeTruthy();
  });

  it('restarts after the shared process exits (upstream died)', async () => {
    const spawnMock = mockSpawn();
    remux.startHlsSession(A, { streamUrl: URL1 });
    remux.startHlsSession(B, { streamUrl: URL1 });
    const proc = remux.getHlsSession(A)!.proc as unknown as FakeProc;
    proc.emit('exit', 1, null); // upstream failure kills the whole stream session
    expect(remux.getHlsSession(A)).toBeNull();
    expect(remux.getHlsSession(B)).toBeNull();

    // Next viewer request restarts a fresh process for the stream.
    expect(remux.startHlsSession(B, { streamUrl: URL1 }).ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('sends a desktop-browser UA when the channel has none (no Lavf fingerprint)', () => {
    const spawnMock = mockSpawn();
    remux.startHlsSession(A, { streamUrl: URL1 });
    const args: string[] = spawnMock.mock.calls[0][1];
    const uaIndex = args.indexOf('-user_agent');
    expect(uaIndex).toBeGreaterThan(-1);
    expect(args[uaIndex + 1]).toMatch(/^Mozilla\/5\.0 .*Chrome\//);
    expect(args[uaIndex + 1]).not.toMatch(/^Lavf/);
  });

  it('passes through the channel UA when configured', () => {
    const spawnMock = mockSpawn();
    remux.startHlsSession(A, {
      streamUrl: URL1,
      upstreamHeaders: { userAgent: 'ExoPlayerLib/2.19.1 (Linux; Android 13)' },
    });
    const args: string[] = spawnMock.mock.calls[0][1];
    const uaIndex = args.indexOf('-user_agent');
    expect(args[uaIndex + 1]).toBe('ExoPlayerLib/2.19.1 (Linux; Android 13)');
  });
});
