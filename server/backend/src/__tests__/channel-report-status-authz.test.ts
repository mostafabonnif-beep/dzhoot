import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Channel from '../models/Channel';

/**
 * POST /api/v1/channels/:id/report-status — authorization.
 *
 * The invariant: `metrics.*` is operator-facing health data, so a caller may only
 * report liveness for a channel it is actually allowed to watch, and the 5-minute
 * throttle must be bound to the authenticated principal rather than to a
 * client-supplied `deviceId`.
 *
 * Regression: the handler resolved the channel with no authorization check at all,
 * so any authenticated account could increment `metrics.deadCount`/`aliveCount` on
 * ANY channel — including another user's private import — and rotating `deviceId`
 * bypassed the throttle entirely.
 */

let currentUser: Record<string, unknown> = {};

jest.mock('../middleware/requireTvOrSessionAuth', () => ({
  requireTvOrSessionAuth: (req: any, _res: any, next: any) => {
    req.user = currentUser;
    next();
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const channelsRouter = require('../routes/channels');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/channels', channelsRouter);
  return app;
}

describe('POST /api/v1/channels/:id/report-status — authorization', () => {
  const stamp = Date.now();
  const otherOwner = new mongoose.Types.ObjectId();
  const me = new mongoose.Types.ObjectId();
  let sharedId: string;
  let foreignPrivateId: string;
  let myPrivateId: string;

  beforeEach(async () => {
    const shared = await Channel.create({
      channelId: `rs-shared-${stamp}`,
      channelName: 'Shared Channel',
      channelUrl: 'https://example.com/shared.m3u8',
      channelGroup: `RS SHARED ${stamp}`,
      ownerId: null,
    });
    const foreign = await Channel.create({
      channelId: `rs-foreign-${stamp}`,
      channelName: 'Foreign Import',
      channelUrl: 'https://example.com/foreign.m3u8',
      channelGroup: `RS FOREIGN ${stamp}`,
      ownerId: otherOwner,
    });
    const mine = await Channel.create({
      channelId: `rs-mine-${stamp}`,
      channelName: 'My Import',
      channelUrl: 'https://example.com/mine.m3u8',
      channelGroup: `RS MINE ${stamp}`,
      ownerId: me,
    });
    sharedId = String(shared._id);
    foreignPrivateId = String(foreign._id);
    myPrivateId = String(mine._id);
  });

  const report = (id: string, deviceId = 'device-1') =>
    request(buildApp())
      .post(`/api/v1/channels/${id}/report-status`)
      .send({ status: 'dead', deviceId });

  it('rejects reports for another user private import (and hides its existence)', async () => {
    currentUser = { id: String(me), role: 'User', channels: [], channelListCode: 'XYZ123' };
    const res = await report(foreignPrivateId);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Channel not found');
  });

  it('allows a report for a channel in the caller own selection', async () => {
    currentUser = {
      id: String(me),
      role: 'User',
      channels: [new mongoose.Types.ObjectId(myPrivateId)],
      channelListCode: 'XYZ123',
    };
    const res = await report(myPrivateId);
    expect(res.status).toBe(200);
    expect(res.body.data.metrics.deadCount).toBeGreaterThanOrEqual(1);
  });

  it('allows a broadcast client to report a shared catalog channel', async () => {
    // TV clients are authenticated by a channel list code: their personal selection
    // is empty while the shared catalog is legitimately theirs to watch.
    currentUser = { id: String(me), role: 'User', channels: [], channelListCode: 'XYZ123' };
    const res = await report(sharedId);
    expect(res.status).toBe(200);
  });

  it('throttles by principal, so rotating deviceId does not bypass the limit', async () => {
    currentUser = { id: String(me), role: 'User', channels: [], channelListCode: 'XYZ123' };
    const first = await report(sharedId, 'device-a');
    expect(first.status).toBe(200);
    const second = await report(sharedId, 'device-b');
    expect(second.status).toBe(429);
  });

  it('still reports 404 for an unknown channel', async () => {
    currentUser = { id: String(me), role: 'User', channels: [], channelListCode: 'XYZ123' };
    const res = await report('000000000000000000000009');
    expect(res.status).toBe(404);
  });
});
