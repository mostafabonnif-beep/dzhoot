/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import XtreamSource from '../models/XtreamSource';
import Channel from '../models/Channel';
import ChannelFailoverMap from '../models/ChannelFailoverMap';

/**
 * Deleting an upstream source must not silently orphan its channels.
 *
 * On 2026-09-20 an admin deleted a source at 13:02 and 16,706 channels kept pointing at the
 * removed document: hidden by the verified-source gate, with nothing anywhere saying why the
 * catalog had shrunk from 31,868 channels to 2,235. These tests pin the replacement
 * behaviour: the count comes back before anything is destroyed, and the channels are either
 * re-linked or deactivated — never left active and dangling.
 */

jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-1', role: 'Admin' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../services/audit-log', () => ({
  audit: () => undefined,
  reqCtx: () => ({}),
  redactSensitiveText: (e: unknown) => String(e),
}));
jest.mock('../services/source-failover-service', () => ({
  autoMatchFailoverMaps: async () => ({ matched: 0 }),
  getSourceHealth: async () => ({}),
  runSourceWatchdog: async () => ({ checked: 0 }),
}));
jest.mock('../services/sync-snapshot-service', () => ({
  rollbackSyncSnapshot: async () => undefined,
  listSyncSnapshots: async () => [],
}));
jest.mock('../services/xtream-service', () => ({
  testXtreamConnection: async () => ({ ok: true }),
  verifyXtreamSource: async () => undefined,
  syncXtreamSource: async () => ({ imported: 0 }),
  previewXtreamSource: async () => ({ channels: [] }),
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => String(v).replace(/^enc:/, ''),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const router = require('../routes/admin-xtream-sources');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/xtream-sources', router);
  return app;
}

async function makeSource(overrides: Record<string, unknown> = {}) {
  return XtreamSource.create({
    name: `src-${Math.random().toString(36).slice(2, 8)}`,
    serverUrl: 'http://provider.test:8080',
    usernameEncrypted: 'u',
    passwordEncrypted: 'p',
    status: 'Active',
    verificationStatus: 'verified',
    customerVisible: true,
    ...overrides,
  });
}

async function makeChannel(sourceId: unknown, overrides: Record<string, unknown> = {}) {
  return Channel.create({
    channelId: `del-${Math.random().toString(36).slice(2, 10)}`,
    channelName: `Del ${Math.random().toString(36).slice(2, 6)}`,
    channelUrl: 'https://example.com/x.m3u8',
    channelGroup: 'DEL',
    ownerId: null,
    isActive: true,
    metadata: { source: 'xtream', xtreamSourceId: String(sourceId) },
    ...overrides,
  });
}

const app = () => request(buildApp());

describe('DELETE /api/v1/admin/xtream-sources/:id', () => {
  it('404s for a source that does not exist', async () => {
    const res = await app().delete(`/api/v1/admin/xtream-sources/${new mongoose.Types.ObjectId()}`);
    expect(res.status).toBe(404);
  });

  it('deletes a source with no channels without asking', async () => {
    const src = await makeSource();
    const res = await app().delete(`/api/v1/admin/xtream-sources/${src._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.channelsDeactivated).toBe(0);
    expect(await XtreamSource.findById(src._id)).toBeNull();
  });

  it('refuses to destroy a source that still feeds channels, and reports the count', async () => {
    const src = await makeSource();
    await makeChannel(src._id);
    await makeChannel(src._id);

    const res = await app().delete(`/api/v1/admin/xtream-sources/${src._id}`);

    expect(res.status).toBe(409);
    expect(res.body.requiresConfirmation).toBe(true);
    expect(res.body.channelCount).toBe(2);
    expect(res.body.sharedChannelCount).toBe(2);
    // Nothing is destroyed before the operator has answered.
    expect(await XtreamSource.findById(src._id)).not.toBeNull();
    const channels = await Channel.find({ 'metadata.xtreamSourceId': String(src._id) });
    expect(channels).toHaveLength(2);
    expect(channels.every((c: any) => c.isActive !== false)).toBe(true);
  });

  it('deactivates and stamps the shared channels once acknowledged', async () => {
    const src = await makeSource({ name: 'provider-x' });
    await makeChannel(src._id);
    await makeChannel(src._id);
    // A user's private copy must be left to the visibility gate, not flipped by the admin.
    await makeChannel(src._id, { ownerId: new mongoose.Types.ObjectId() });

    const res = await app().delete(`/api/v1/admin/xtream-sources/${src._id}?acknowledgeChannels=1`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ channelCount: 3, sharedChannelCount: 2, channelsDeactivated: 2, channelsReassigned: 0 });
    expect(await XtreamSource.findById(src._id)).toBeNull();

    const shared = await Channel.find({ ownerId: null, 'metadata.xtreamSourceId': String(src._id) });
    expect(shared).toHaveLength(2);
    for (const channel of shared as any[]) {
      expect(channel.isActive).toBe(false);
      expect(channel.metadata.orphanedSourceName).toBe('provider-x');
      expect(channel.metadata.orphanedAt).toBeInstanceOf(Date);
    }
    const priv = await Channel.findOne({ ownerId: { $ne: null } });
    expect(priv?.isActive).toBe(true);
  });

  it('re-links the channels instead when a reassign target is given', async () => {
    const dying = await makeSource({ name: 'dying' });
    const survivor = await makeSource({ name: 'survivor' });
    await makeChannel(dying._id);
    await makeChannel(dying._id, { isActive: false });

    const res = await app().delete(`/api/v1/admin/xtream-sources/${dying._id}?reassignTo=${survivor._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.channelsReassigned).toBe(2);
    expect(res.body.data.channelsDeactivated).toBe(0);
    expect(await Channel.countDocuments({ 'metadata.xtreamSourceId': String(dying._id) })).toBe(0);
    expect(await Channel.countDocuments({ 'metadata.xtreamSourceId': String(survivor._id) })).toBe(2);
    // Re-linking must not change a channel's own activity state.
    expect(await Channel.countDocuments({ 'metadata.xtreamSourceId': String(survivor._id), isActive: false })).toBe(1);
  });

  it('rejects a reassign target that does not exist, or the source being deleted', async () => {
    const src = await makeSource();
    await makeChannel(src._id);

    const missing = await app().delete(`/api/v1/admin/xtream-sources/${src._id}?reassignTo=${new mongoose.Types.ObjectId()}`);
    expect(missing.status).toBe(400);
    const self = await app().delete(`/api/v1/admin/xtream-sources/${src._id}?reassignTo=${src._id}`);
    expect(self.status).toBe(400);

    expect(await XtreamSource.findById(src._id)).not.toBeNull();
    expect((await Channel.findOne({ 'metadata.xtreamSourceId': String(src._id) }))?.isActive).toBe(true);
  });

  it('clears the failover maps that name the deleted source as their backup', async () => {
    const src = await makeSource();
    const channel = await makeChannel(src._id);
    await ChannelFailoverMap.create({ channelRef: channel._id, channelId: new mongoose.Types.ObjectId(), backupSourceId: src._id, backupStreamId: '1', backupChannelName: 'backup-1' });

    const res = await app().delete(`/api/v1/admin/xtream-sources/${src._id}?acknowledgeChannels=1`);

    expect(res.body.data.failoverMapsRemoved).toBe(1);
    expect(await ChannelFailoverMap.countDocuments({ backupSourceId: src._id })).toBe(0);
  });
});
