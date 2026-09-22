jest.mock('./stream-prober', () => ({
  probeStream: jest.fn(),
}));

import Channel from '../models/Channel';
import { probeStream } from './stream-prober';
import { StreamHealthService, siblingStreamUrl } from './stream-health-service';

/**
 * Issue #360: a provider serves one stream id in several containers and frequently fails in
 * exactly one of them. Measured on production 2026-09-21 — 6/10 sampled channels played through
 * the app path; the failures returned `200` with an empty body on `.ts` while the same id served
 * a valid HLS manifest on `.m3u8`. The alternate scan cannot help there (every alternate URL is
 * broken in the same container), so the channel must be re-pointed at its sibling format.
 */
describe('sibling stream format failover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockProbeByUrl(byUrl: Record<string, { status: 'alive' | 'dead'; responseTimeMs: number }>) {
    (probeStream as jest.Mock).mockImplementation((url: string) => {
      const hit = byUrl[url];
      if (!hit) return Promise.reject(new Error(`unexpected probe: ${url}`));
      return Promise.resolve({ ...hit, statusCode: hit.status === 'alive' ? 200 : 200, error: null });
    });
  }

  it('switches the channel to .m3u8 when .ts is dead and no alternate works', async () => {
    const channel: any = await Channel.create({
      channelId: `sibling-${Date.now()}`,
      channelName: 'Sibling News',
      channelUrl: 'https://feed.example/live/dz-user/secret/1.ts',
      metadata: { isWorking: true, lastTested: new Date(Date.now() - 86400000) },
      alternateStreams: [
        {
          streamUrl: 'https://backup.example/live/dz-user/secret/1.ts',
          flaggedBad: { isFlagged: false },
        },
      ],
    });

    mockProbeByUrl({
      'https://feed.example/live/dz-user/secret/1.ts': { status: 'dead', responseTimeMs: 200 },
      'https://backup.example/live/dz-user/secret/1.ts': { status: 'dead', responseTimeMs: 900 },
      'https://feed.example/live/dz-user/secret/1.m3u8': { status: 'alive', responseTimeMs: 160 },
    });

    const service = new StreamHealthService();
    const result = await (service as any).checkAndPromote(channel);
    const saved: any = await Channel.findById(channel._id).lean();

    expect(result).toBe('promoted');
    expect(saved.channelUrl).toBe('https://feed.example/live/dz-user/secret/1.m3u8');
    expect(saved.metadata.isWorking).toBe(true);
    expect(saved.metadata.responseTime).toBe(160);
    // The replaced primary is kept so the operator can see what was swapped out.
    const demoted = saved.alternateStreams.find(
      (a: any) => a.streamUrl === 'https://feed.example/live/dz-user/secret/1.ts',
    );
    expect(demoted).toBeTruthy();
    expect(demoted.demotedAt).toBeInstanceOf(Date);
  });

  it('leaves the channel hidden when the sibling format is dead too', async () => {
    const channel: any = await Channel.create({
      channelId: `sibling-dead-${Date.now()}`,
      channelName: 'Sibling Dead',
      channelUrl: 'https://feed.example/live/dz-user/secret/2.ts',
      metadata: { isWorking: true, lastTested: new Date(Date.now() - 86400000) },
      alternateStreams: [],
    });

    mockProbeByUrl({
      'https://feed.example/live/dz-user/secret/2.ts': { status: 'dead', responseTimeMs: 200 },
      'https://feed.example/live/dz-user/secret/2.m3u8': { status: 'dead', responseTimeMs: 210 },
    });

    const service = new StreamHealthService();
    const result = await (service as any).checkAndPromote(channel);
    const saved: any = await Channel.findById(channel._id).lean();

    expect(result).toBe('all-dead');
    expect(saved.channelUrl).toBe('https://feed.example/live/dz-user/secret/2.ts');
    // isWorking=false is what the visibility gate hides the channel on.
    expect(saved.metadata.isWorking).toBe(false);
  });

  it('prefers a live alternate over the sibling format (existing behaviour preserved)', async () => {
    const channel: any = await Channel.create({
      channelId: `sibling-alt-${Date.now()}`,
      channelName: 'Alternate Wins',
      channelUrl: 'https://feed.example/live/dz-user/secret/3.ts',
      metadata: { isWorking: true, lastTested: new Date(Date.now() - 86400000) },
      alternateStreams: [
        {
          streamUrl: 'https://backup.example/live/dz-user/secret/3.ts',
          flaggedBad: { isFlagged: false },
        },
      ],
    });

    mockProbeByUrl({
      'https://feed.example/live/dz-user/secret/3.ts': { status: 'dead', responseTimeMs: 200 },
      'https://backup.example/live/dz-user/secret/3.ts': { status: 'alive', responseTimeMs: 150 },
    });

    const service = new StreamHealthService();
    const result = await (service as any).checkAndPromote(channel);
    const saved: any = await Channel.findById(channel._id).lean();

    expect(result).toBe('promoted');
    expect(saved.channelUrl).toBe('https://backup.example/live/dz-user/secret/3.ts');
    // The sibling was never a candidate while an alternate still worked.
    expect(probeStream).not.toHaveBeenCalledWith(
      'https://feed.example/live/dz-user/secret/3.m3u8',
      expect.anything(),
    );
  });

  it('does not spend a probe on a channel the dead-recheck cooldown skipped', async () => {
    const channel: any = await Channel.create({
      channelId: `sibling-cooldown-${Date.now()}`,
      channelName: 'Cooling Down',
      channelUrl: 'https://feed.example/live/dz-user/secret/4.ts',
      metadata: { isWorking: false, lastTested: new Date() },
      alternateStreams: [],
    });

    const service = new StreamHealthService();
    const result = await (service as any).checkAndPromote(channel);

    expect(result).toBe('all-dead');
    expect(probeStream).not.toHaveBeenCalledWith(
      'https://feed.example/live/dz-user/secret/4.m3u8',
      expect.anything(),
    );
  });

  describe('siblingStreamUrl', () => {
    it('maps .ts to .m3u8 and back', () => {
      expect(siblingStreamUrl('http://h:8080/live/u/p/297641.ts')).toBe(
        'http://h:8080/live/u/p/297641.m3u8',
      );
      expect(siblingStreamUrl('http://h:8080/live/u/p/297641.m3u8')).toBe(
        'http://h:8080/live/u/p/297641.ts',
      );
    });

    it('keeps provider credentials and query tokens intact', () => {
      expect(siblingStreamUrl('http://h/live/dz-user/secret/9.ts?token=abc&type=m3u_plus')).toBe(
        'http://h/live/dz-user/secret/9.m3u8?token=abc&type=m3u_plus',
      );
    });

    it('is case-insensitive and refuses URLs with no swappable format', () => {
      expect(siblingStreamUrl('http://h/live/u/p/1.TS')).toBe('http://h/live/u/p/1.m3u8');
      expect(siblingStreamUrl('http://h/vod/u/p/1.mp4')).toBeNull();
      expect(siblingStreamUrl('http://h/live/u/p/1')).toBeNull();
      expect(siblingStreamUrl('')).toBeNull();
    });
  });
});

describe('stream health failover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('promotes a healthy alternate and preserves its source headers', async () => {
    const channel: any = await Channel.create({
      channelId: `failover-${Date.now()}`,
      channelName: 'Protected News',
      channelUrl: 'https://primary.example/live.m3u8',
      metadata: { isWorking: false, lastTested: new Date(), quality: '480p' },
      alternateStreams: [
        {
          streamUrl: 'https://backup.example/live.m3u8',
          userAgent: 'BackupPlayer/2.0',
          referrer: 'https://backup.example/guide',
          quality: '1080p',
          flaggedBad: { isFlagged: false },
        },
      ],
    });

    (probeStream as jest.Mock).mockResolvedValue({
      status: 'alive',
      responseTimeMs: 180,
      error: null,
    });

    const service = new StreamHealthService();
    const result = await (service as any).checkAndPromote(channel);
    const saved: any = await Channel.findById(channel._id).lean();

    expect(result).toBe('promoted');
    expect(saved.channelUrl).toBe('https://backup.example/live.m3u8');
    expect(saved.activeUserAgent).toBe('BackupPlayer/2.0');
    expect(saved.activeReferrer).toBe('https://backup.example/guide');
    expect(saved.alternateStreams[0].streamUrl).toBe('https://primary.example/live.m3u8');
    expect(saved.alternateStreams[0].userAgent).toBeNull();
  });

  it('normalizes stale dead flags on direct-playback channels to working', async () => {
    const channel: any = await Channel.create({
      channelId: `direct2-${Date.now()}`,
      channelName: 'Direct Stream 2',
      channelUrl: 'https://direct.example/live.m3u8',
      metadata: { isWorking: false, lastTested: new Date(Date.now() - 86400000), xtreamSourceId: 'src-direct' },
    });

    const service = new StreamHealthService();
    const result = await (service as any).checkAndPromote(channel, new Set(['src-direct']));
    const saved: any = await Channel.findById(channel._id).lean();

    expect(result).toBe('ok');
    expect(saved.metadata.isWorking).toBe(true);
    expect(saved.metadata.lastTested).toBeInstanceOf(Date);
    // No probes attempted for exempt channels
    expect(probeStream).not.toHaveBeenCalledWith(
      expect.stringContaining('direct.example'),
      expect.anything(),
    );
  });

  it('re-probes a stale dead primary and recovers it when the upstream is back', async () => {
    const channel: any = await Channel.create({
      channelId: `recover-${Date.now()}`,
      channelName: 'Recovered News',
      channelUrl: 'https://primary.example/live.m3u8',
      metadata: { isWorking: false, lastTested: new Date(Date.now() - 7 * 86400000) },
      alternateStreams: [],
    });

    (probeStream as jest.Mock).mockResolvedValue({
      status: 'alive',
      responseTimeMs: 300,
      error: null,
    });

    const service = new StreamHealthService();
    const result = await (service as any).checkAndPromote(channel);
    const saved: any = await Channel.findById(channel._id).lean();

    expect(result).toBe('ok');
    expect(saved.metadata.isWorking).toBe(true);
    expect(saved.metadata.lastTested).toBeInstanceOf(Date);
  });

  it('keeps a recently-checked dead primary dead (cooldown not elapsed)', async () => {
    const channel: any = await Channel.create({
      channelId: `cooldown-${Date.now()}`,
      channelName: 'Still Dead',
      channelUrl: 'https://primary.example/live.m3u8',
      metadata: { isWorking: false, lastTested: new Date() },
      alternateStreams: [],
    });

    const service = new StreamHealthService();
    const result = await (service as any).checkAndPromote(channel);

    expect(result).toBe('all-dead');
    expect(probeStream).not.toHaveBeenCalledWith(
      'https://primary.example/live.m3u8',
      expect.anything(),
    );
  });
});
