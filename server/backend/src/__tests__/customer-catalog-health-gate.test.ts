/**
 * Every customer-facing catalog read must apply the SAME visibility gate.
 *
 * Measured on production 2026-09-20: the primary provider account had expired and ~52% of
 * the catalog (16,707 of 31,868 channels) answered with a `black.ts` placeholder. GET
 * /channels hid those channels, but `/channels/search`, `/categories` and `/catalog/search`
 * applied only the presentation/hide filters — so the customer's own search (the app goes
 * straight from a result tap into playback) offered channels that could only render a black
 * screen, and the category rail advertised groups the list endpoint refused to serve.
 *
 * These tests pin the invariant for the two endpoints the Android client actually calls
 * (`/catalog/search` and `/categories`, see DzhoofApiService.kt) plus `/channels/search`,
 * and they pin the exemption that must survive the fix: a customer-visible or
 * direct-playback source stays visible even when the server's datacenter probe says the
 * channel is dead, because that probe is blocked upstream (HTTP 456/458).
 */
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';

// A TV client: `allCatalog` sends it down the shared-catalog branch, exactly like the app
// paired with a channel list code.
jest.mock('../middleware/requireTvOrSessionAuth', () => ({
  requireTvOrSessionAuth: (req: any, _res: any, next: any) => {
    req.user = {
      id: '66c000000000000000000009',
      username: 'tvuser',
      role: 'User',
      channels: [],
      channelListCode: 'TVGATE',
      isActive: true,
      allCatalog: true,
    };
    next();
  },
}));
jest.mock('../routes/auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../services/audit-log', () => ({ audit: jest.fn() }));
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn(),
  isPrivateIP: jest.fn(() => false),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const channelsRouter = require('../routes/channels');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalogRouter = require('../routes/catalog');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const categoriesRouter = require('../routes/categories');

const app = express();
app.use(express.json());
app.use('/api/v1/channels', channelsRouter);
app.use('/api/v1/catalog', catalogRouter);
app.use('/api/v1/categories', categoriesRouter);

// One group for every channel: the category assertion then compares counts directly.
const GROUP = 'Z GATE TEST';

const verifiedSourceId = new mongoose.Types.ObjectId();
const exemptSourceId = new mongoose.Types.ObjectId();
const unverifiedSourceId = new mongoose.Types.ObjectId();

async function seedSource(id: mongoose.Types.ObjectId, extra: Record<string, unknown>) {
  return XtreamSource.create({
    _id: id,
    name: `src-${id.toHexString().slice(-4)}`,
    serverUrl: 'http://source.invalid',
    usernameEncrypted: 'x',
    passwordEncrypted: 'y',
    status: 'Active',
    ...extra,
  });
}

async function seedChannel(
  channelName: string,
  xtreamSourceId: mongoose.Types.ObjectId,
  isWorking: boolean
): Promise<void> {
  await Channel.collection.insertOne({
    channelId: `gate-${channelName}`,
    channelName,
    channelUrl: 'http://stream.invalid/live.m3u8',
    channelGroup: GROUP,
    ownerId: null,
    isActive: true,
    metadata: { source: 'xtream', xtreamSourceId: String(xtreamSourceId), isWorking },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('customer catalog visibility gate', () => {
  beforeEach(async () => {
    await Channel.collection.deleteMany({});
    await XtreamSource.deleteMany({});
    await seedSource(verifiedSourceId, { verificationStatus: 'verified' });
    await seedSource(exemptSourceId, { verificationStatus: 'pending', customerVisible: true });
    await seedSource(unverifiedSourceId, { verificationStatus: 'pending' });

    await seedChannel('Z DEAD CHANNEL', verifiedSourceId, false);
    await seedChannel('Z ALIVE CHANNEL', verifiedSourceId, true);
    await seedChannel('Z EXEMPT CHANNEL', exemptSourceId, false);
    await seedChannel('Z UNVERIFIED CHANNEL', unverifiedSourceId, true);
  });

  // The only channel names a customer may ever be offered from this seed.
  const VISIBLE = ['Z ALIVE CHANNEL', 'Z EXEMPT CHANNEL'];

  it('/catalog/search (used by the app) hides dead and unverified channels', async () => {
    const res = await request(app).get('/api/v1/catalog/search').query({ q: 'Z ' });
    expect(res.status).toBe(200);
    const names = (res.body.data.channels || []).map((c: any) => c.name).sort();
    expect(names).toEqual([...VISIBLE].sort());
  });

  it('/channels/search hides dead and unverified channels', async () => {
    const res = await request(app).get('/api/v1/channels/search').query({ q: 'Z ' });
    expect(res.status).toBe(200);
    const names = (res.body.data || []).map((c: any) => c.channelName).sort();
    expect(names).toEqual([...VISIBLE].sort());
  });

  it('/categories counts only channels the customer can actually watch', async () => {
    const res = await request(app).get('/api/v1/categories');
    expect(res.status).toBe(200);
    const group = (res.body.categories || []).find((c: any) => c.name === GROUP);
    // Two of the four seeded channels pass the gate; the count must match the list endpoint,
    // which is what this endpoint promises ("Mirrors GET /channels so counts line up").
    expect(group).toBeDefined();
    expect(group.channel_count).toBe(VISIBLE.length);

    const list = await request(app).get('/api/v1/channels').query({ group: GROUP });
    expect(list.status).toBe(200);
    const listed = (list.body.data || []).filter(
      (c: any) => c.channelGroup === GROUP || c.channelGroup === undefined
    );
    expect(listed.length).toBe(VISIBLE.length);
  });
});
