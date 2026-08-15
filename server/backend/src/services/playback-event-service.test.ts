import mongoose from 'mongoose';
import PlaybackEvent from '../models/PlaybackEvent';
import { getPlaybackQualityStats } from './playback-event-service';

describe('playback event service', () => {
  beforeEach(async () => {
    await PlaybackEvent.deleteMany({});
  });

  it('aggregates startup, rebuffer, fallback, and top error metrics by day', async () => {
    const channelId = new mongoose.Types.ObjectId();
    await PlaybackEvent.create([
      {
        channelId,
        eventType: 'startup_success',
        startupMs: 1000,
        rebufferCount: 1,
        fallbackUsed: true,
        fallbackSucceeded: true,
        platform: 'android_tv',
        createdAt: new Date(),
      },
      {
        channelId,
        eventType: 'startup_failure',
        startupMs: 3000,
        rebufferCount: 3,
        fallbackUsed: true,
        fallbackSucceeded: false,
        errorCode: 'timeout',
        platform: 'android_tv',
        createdAt: new Date(),
      },
      {
        channelId,
        eventType: 'startup_failure',
        startupMs: 2500,
        rebufferCount: 0,
        fallbackUsed: false,
        errorCode: 'timeout',
        platform: 'android_tv',
        createdAt: new Date(),
      },
    ]);

    const result = await getPlaybackQualityStats(7);
    expect(result.summary.totalEvents).toBe(3);
    expect(result.summary.startupSuccessRate).toBe(33);
    expect(result.summary.avgStartupMs).toBe(2167);
    expect(result.summary.avgRebufferCount).toBe(1.33);
    expect(result.summary.fallbackAttempts).toBe(2);
    expect(result.summary.fallbackSuccesses).toBe(1);
    expect(result.summary.fallbackSuccessRate).toBe(50);
    expect(result.topErrors).toEqual([{ errorCode: 'timeout', count: 2 }]);
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0]).toEqual(expect.objectContaining({
      startupSuccesses: 1,
      startupFailures: 2,
      fallbackAttempts: 2,
    }));
  });
});
