/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import express from 'express';
import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';

/**
 * GET /api/v1/admin/diagnostics must answer "why do customers see fewer channels than the
 * database holds?" — the question that, on 2026-09-20, needed an SSH session to answer:
 * 31,868 shared channels, 2,235 visible to customers, mostly because an admin had deleted
 * an upstream source whose 16,706 channels still pointed at the removed document.
 */

jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-1', role: 'Admin' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../services/redis', () => ({
  isRedisReady: () => false,
  getRedisClient: () => null,
}));
jest.mock('../services/scheduler-service', () => ({
  schedulerService: { getTasksWithStatus: async () => [] },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const diagnostics = require('../routes/admin-diagnostics');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/diagnostics', diagnostics);
  return app;
}

const catalogCheck = (body: any) => (body.checks || []).find((c: any) => c.id === 'catalog_visibility');

async function makeSource(overrides: Record<string, unknown> = {}) {
  return XtreamSource.create({
    name: `src-${Math.random().toString(36).slice(2, 8)}`,
    // The model requires these three; they are opaque to the diagnostics check (it reads
    // flags and ids only) and are never asserted on.
    serverUrl: 'http://provider.test:8080',
    usernameEncrypted: 'test-user-enc',
    passwordEncrypted: 'test-pass-enc',
    status: 'Active',
    verificationStatus: 'verified',
    customerVisible: true,
    directPlayback: true,
    ...overrides,
  });
}

async function makeChannel(sourceId: unknown, overrides: Record<string, unknown> = {}) {
  return Channel.create({
    channelId: `diag-${Math.random().toString(36).slice(2, 10)}`,
    channelName: `Diag ${Math.random().toString(36).slice(2, 6)}`,
    channelUrl: 'https://example.com/x.m3u8',
    channelGroup: 'DIAG',
    ownerId: null,
    isActive: true,
    metadata: { source: 'xtream', xtreamSourceId: sourceId },
    ...overrides,
  });
}

describe('GET /api/v1/admin/diagnostics — catalog visibility', () => {
  it('passes and reports the arithmetic when every channel has a live verified source', async () => {
    const src = await makeSource();
    await makeChannel(src._id);
    await makeChannel(src._id, { metadata: { source: 'xtream', xtreamSourceId: src._id } });

    const res = await request(buildApp()).get('/api/v1/admin/diagnostics');
    expect(res.status).toBe(200);
    const entry = catalogCheck(res.body);
    expect(entry).toBeDefined();
    expect(entry.status).toBe('pass');
    expect(entry.detail).toContain('يراها العميل 2');
  });

  it('warns, and names the deleted source, when channels still point at a removed one', async () => {
    const live = await makeSource();
    await makeChannel(live._id);
    // Channels of a source that no longer exists in the collection.
    await makeChannel('6a84dce7f6a082630f39a9c3');
    await makeChannel('6a84dce7f6a082630f39a9c3');

    const res = await request(buildApp()).get('/api/v1/admin/diagnostics');
    const entry = catalogCheck(res.body);
    expect(entry.status).toBe('warn');
    expect(entry.detail).toContain('2 قناة فعّالة تشير إلى مصدر محذوف');
  });

  it('stays quiet once the orphaned channels were deactivated (a deliberate cleanup)', async () => {
    const live = await makeSource();
    await makeChannel(live._id);
    // What deleting a source now leaves behind: deactivated, provenance stamped. It must not
    // keep this warning alive forever, or operators learn to ignore it.
    await makeChannel('6a84dce7f6a082630f39a9c3', {
      isActive: false,
      metadata: {
        source: 'xtream',
        xtreamSourceId: '6a84dce7f6a082630f39a9c3',
        orphanedAt: new Date(),
        orphanedSourceName: 'deleted provider',
      },
    });

    const res = await request(buildApp()).get('/api/v1/admin/diagnostics');
    const entry = catalogCheck(res.body);
    expect(entry.status).toBe('pass');
    expect(entry.detail).toContain('1 معطّلة بفحص الصحة');
  });

  it('counts channels deactivated by health verdicts separately from source problems', async () => {
    const live = await makeSource();
    await makeChannel(live._id);
    await makeChannel(live._id, { isActive: false });

    const res = await request(buildApp()).get('/api/v1/admin/diagnostics');
    const entry = catalogCheck(res.body);
    expect(entry.detail).toContain('1 معطّلة بفحص الصحة');
    expect(entry.status).toBe('pass');
  });

  it('warns (never fails) when the catalog holds nothing to show', async () => {
    // A fresh install has an empty catalog by definition, and this check must not flip the
    // endpoint's overall verdict for it — FAIL here would mask unrelated infrastructure
    // judgements the page exists to make.
    const res = await request(buildApp()).get('/api/v1/admin/diagnostics');
    const entry = catalogCheck(res.body);
    expect(entry.status).toBe('warn');
    expect(entry.detail).toContain('لا توجد قنوات مشتركة');
  });
});
