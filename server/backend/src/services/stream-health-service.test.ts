jest.mock('./stream-prober', () => ({
  probeStream: jest.fn(),
}));

import Channel from '../models/Channel';
import { probeStream } from './stream-prober';
import { StreamHealthService } from './stream-health-service';

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
