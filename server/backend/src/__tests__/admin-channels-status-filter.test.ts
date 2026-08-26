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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminRouter = require('../routes/admin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
}

describe('GET /admin/channels — status quick filter', () => {
  const stamp = Date.now();

  beforeEach(async () => {
    await Channel.create([
      {
        channelId: `qf-live-${stamp}`,
        channelName: 'QF Live',
        channelUrl: 'https://example.com/live.m3u8',
        channelGroup: 'QF',
        ownerId: null,
        metadata: { isWorking: true },
      },
      {
        channelId: `qf-dead-${stamp}`,
        channelName: 'QF Dead',
        channelUrl: 'https://example.com/dead.m3u8',
        channelGroup: 'QF',
        ownerId: null,
        metadata: { isWorking: false },
      },
      {
        channelId: `qf-untested-${stamp}`,
        channelName: 'QF Untested',
        channelUrl: 'https://example.com/untested.m3u8',
        channelGroup: 'QF',
        ownerId: null,
        metadata: {},
      },
    ]);
  });

  const names = (body: any) => (body.data || []).map((c: any) => c.channelName);

  it('filters Dead channels only', async () => {
    const res = await request(buildApp()).get('/admin/channels?group=QF&status=Dead');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['QF Dead']);
    // Health breakdown ignores the status filter itself, so counts stay useful.
    expect(res.body.health).toEqual({ working: 1, notWorking: 1, untested: 1 });
  });

  it('filters Live channels (working or untested kept out of Dead)', async () => {
    const res = await request(buildApp()).get('/admin/channels?group=QF&status=Live');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(expect.arrayContaining(['QF Live', 'QF Untested']));
    expect(names(res.body)).not.toContain('QF Dead');
  });

  it('filters Untested channels (isWorking never set)', async () => {
    const res = await request(buildApp()).get('/admin/channels?group=QF&status=Untested');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['QF Untested']);
  });

  it('supports multi-select Dead+Untested', async () => {
    const res = await request(buildApp()).get('/admin/channels?group=QF&status=Dead,Untested');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(expect.arrayContaining(['QF Dead', 'QF Untested']));
    expect(names(res.body)).not.toContain('QF Live');
  });

  it('still applies text search together with the status filter', async () => {
    const res = await request(buildApp()).get('/admin/channels?status=Dead&search=QF%20Dead');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['QF Dead']);
  });

  it('filter-options advertises the Untested status', async () => {
    const res = await request(buildApp()).get('/admin/channels/filter-options');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toEqual(['Live', 'Dead', 'Untested']);
  });
});
