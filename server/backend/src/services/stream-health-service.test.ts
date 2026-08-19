jest.mock('./stream-prober', () => ({
  probeStream: jest.fn(),
}));

import Channel from '../models/Channel';
import { probeStream } from './stream-prober';
import { StreamHealthService } from './stream-health-service';

describe('stream health failover', () => {
  it('promotes a healthy alternate and preserves its source headers', async () => {
    const channel: any = await Channel.create({
      channelId: `failover-${Date.now()}`,
      channelName: 'Protected News',
      channelUrl: 'https://primary.example/live.m3u8',
      metadata: { isWorking: false, quality: '480p' },
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
});
