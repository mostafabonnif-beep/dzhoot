import request from 'supertest';
import express from 'express';
import Channel from '../models/Channel';

jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-id', role: 'Admin' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../middleware/requireAdmin', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/epg-service', () => ({
  epgService: {
    getStats: jest.fn().mockResolvedValue({
      totalPrograms: 12,
      channelsWithEpg: 2,
      totalSystemChannels: 3,
      lastRefreshedAt: null,
      nextRefreshAt: null,
      sourcesDiscovered: 1,
      refreshInProgress: false,
      lastRefreshDurationMs: 150,
      lastRefreshProgramCount: 12,
      lastRefreshErrorCount: 0,
      lastRefreshErrorSources: [],
    }),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminRouter = require('../routes/admin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
}

describe('GET /admin/stats/channel-operations', () => {
  it('returns channel, source-safe and EPG operations data', async () => {
    await Channel.create([
      {
        channelId: `ops-healthy-${Date.now()}`,
        channelName: 'Healthy News',
        channelUrl: 'https://example.com/healthy.m3u8',
        ownerId: null,
        metadata: { isWorking: true, responseTime: 120 },
        alternateStreams: [{ streamUrl: 'https://example.com/backup.m3u8' }],
      },
      {
        channelId: `ops-failing-${Date.now()}`,
        channelName: 'Failing News',
        channelUrl: 'https://example.com/failing.m3u8',
        ownerId: null,
        metadata: { isWorking: false },
      },
    ]);

    const response = await request(buildApp()).get('/admin/stats/channel-operations');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.channels.total).toBeGreaterThanOrEqual(2);
    expect(response.body.data.channels.healthy).toBeGreaterThanOrEqual(1);
    expect(response.body.data.channels.failing).toBeGreaterThanOrEqual(1);
    expect(response.body.data.channels.withFallback).toBeGreaterThanOrEqual(1);
    expect(response.body.data.epg.totalPrograms).toBe(12);
    expect(response.body.data.identities).toEqual(
      expect.objectContaining({ total: expect.any(Number), multiSource: expect.any(Number) }),
    );
    expect(response.body.data.sources).toEqual({ m3u: [], xtream: [] });
    expect(JSON.stringify(response.body)).not.toContain('healthy.m3u8');
  });
});
