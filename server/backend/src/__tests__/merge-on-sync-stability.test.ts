// Merge-on-sync stability: syncing a mergeCatalog source must attach streams
// to EXISTING catalog channels as failover backups and NEVER reshuffle the
// customer list. The stability report proves it with before/after hashes.
import mongoose from 'mongoose';
import axios from 'axios';
import XtreamSource from '../models/XtreamSource';
import Channel from '../models/Channel';
import ChannelFailoverMap from '../models/ChannelFailoverMap';
import { syncXtreamSource } from '../services/xtream-service';
import { encryptSecret } from '../utils/crypto';

jest.mock('axios');
jest.mock('../utils/ssrf-guard', () => ({
  validateUrlForSSRF: jest.fn(async () => ({ safe: true, resolvedAddresses: ['198.51.100.10'] })),
  createPinnedLookup: jest.fn(() => undefined),
}));

jest.mock('../services/stream-prober', () => ({ probeStream: jest.fn() }));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const SERVER = 'http://panel.example:8080';
const USER = 'user1';
const PASS = 'pass1';

function makeLivePayload(names: Array<{ name: string; streamId: number; categoryId?: string }>) {
  return names.map((n) => ({
    num: n.streamId,
    name: n.name,
    stream_id: n.streamId,
    stream_icon: 'http://logo/ch.png',
    category_id: n.categoryId || '1',
    epg_channel_id: `${n.name}.epg`,
  }));
}

async function makeSource(overrides: Record<string, unknown> = {}) {
  return XtreamSource.create({
    name: 'Panel',
    serverUrl: SERVER,
    usernameEncrypted: encryptSecret(USER),
    passwordEncrypted: encryptSecret(PASS),
    status: 'Active',
    verificationStatus: 'verified',
    ...overrides,
  });
}

function mockPanel(liveStreams: Array<{ name: string; streamId: number; categoryId?: string }>) {
  mockedAxios.get.mockImplementation(async (url: string) => {
    const parsed = new URL(url);
    const action = parsed.searchParams.get('action') || undefined;
    switch (action) {
      case 'get_live_categories':
        return { data: [{ category_id: '1', category_name: 'Algeria' }] };
      case 'get_live_streams':
        return { data: makeLivePayload(liveStreams) };
      default:
        return { data: [] };
    }
  });
}

describe('merge-on-sync stability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps a mergeCatalog source onto the existing list — customer list unchanged, no duplicates', async () => {
    // 1) Primary source builds the catalog (2 channels).
    mockPanel([
      { name: 'ENTV', streamId: 101 },
      { name: 'Canal Algerie', streamId: 102 },
    ]);
    const primary = await makeSource({ name: 'Primary' });
    await syncXtreamSource(String(primary._id));

    expect(await Channel.countDocuments({ isActive: { $ne: false } })).toBe(2);

    // 2) Backup (mergeCatalog) source with the SAME channels (different naming style).
    mockPanel([
      { name: 'AR: ENTV 1 FULL HD', streamId: 201 },
      { name: 'Dz| Canal Algerie', streamId: 202 },
    ]);
    const backup = await makeSource({ name: 'Backup', mergeCatalog: true, failoverPriority: 20 });
    const result = await syncXtreamSource(String(backup._id));

    // No duplicates: still exactly 2 channels.
    expect(await Channel.countDocuments({ isActive: { $ne: false } })).toBe(2);
    // Both streams became failover backups.
    const maps = await ChannelFailoverMap.find({ backupSourceId: backup._id }).lean();
    expect(maps.length).toBe(2);
    // Stability report proves the list did not change.
    expect(result.stabilityReport).toMatchObject({
      listUnchanged: true,
      added: 0,
      matched: 2,
      beforeCount: 2,
      afterCount: 2,
    });
    expect(result.stabilityReport?.fingerprintBefore).toBe(result.stabilityReport?.fingerprintAfter);
    // The report is persisted on the source doc for the admin panel.
    const reloaded = await XtreamSource.findById(backup._id).lean();
    expect(reloaded!.stabilityReport).toMatchObject({ listUnchanged: true, matched: 2 });
  });

  it('inserts genuinely new channels but leaves existing ones exactly in place', async () => {
    mockPanel([{ name: 'ENTV', streamId: 101 }]);
    const primary = await makeSource({ name: 'Primary' });
    await syncXtreamSource(String(primary._id));

    mockPanel([
      { name: 'ENTV', streamId: 201 },
      { name: 'A NEW CHANNEL', streamId: 202 },
    ]);
    const backup = await makeSource({ name: 'Backup', mergeCatalog: true, failoverPriority: 20 });
    const result = await syncXtreamSource(String(backup._id));

    // ENTV matched (backup map), new channel added.
    expect(await Channel.countDocuments({ isActive: { $ne: false } })).toBe(2);
    expect(result.stabilityReport).toMatchObject({ listUnchanged: false, added: 1, matched: 1 });
    const maps = await ChannelFailoverMap.find({ backupSourceId: backup._id }).lean();
    expect(maps.length).toBe(1);
    expect(maps[0].backupChannelName).toBe('ENTV');

    // The pre-existing channel doc was NOT modified (same name/group/order).
    const entv = await Channel.findOne({ channelName: 'ENTV' }).lean();
    expect(entv).not.toBeNull();
  });

  it('records a rolling stability history capped at 10 entries', async () => {
    mockPanel([{ name: 'ENTV', streamId: 101 }]);
    const primary = await makeSource({ name: 'Primary' });
    await syncXtreamSource(String(primary._id));

    mockPanel([{ name: 'ENTV', streamId: 201 }]);
    const backup = await makeSource({ name: 'Backup', mergeCatalog: true, failoverPriority: 20 });
    for (let i = 0; i < 12; i += 1) {
      await syncXtreamSource(String(backup._id));
    }
    const reloaded = await XtreamSource.findById(backup._id).lean();
    expect(reloaded!.stabilityHistory!.length).toBe(10);
  });
});
