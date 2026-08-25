import mongoose from 'mongoose';
import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';
import ChannelFailoverMap from '../models/ChannelFailoverMap';

jest.mock('../utils/crypto', () => ({
  decryptSecret: jest.fn().mockReturnValue('plain-user-pass'),
}));

jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({
    data: [
      { name: 'ENTV1', stream_id: 101, container_extension: 'm3u8' },
      { name: 'beIN SPORTS 1', stream_id: 202 },
      { name: 'قناة لا وجود لها في الكتالوج', stream_id: 303 },
    ],
  }),
}));

jest.mock('../services/xtream-service', () => ({
  testXtreamConnection: jest.fn(),
  buildXtreamApiUrl: jest.fn().mockReturnValue('http://backup.test/player_api.php'),
}));

jest.mock('../services/stream-prober', () => ({
  probeStream: jest.fn(),
}));

jest.mock('../services/alert-notifier', () => ({
  sendOperationalAlert: jest.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const svc = require('../services/source-failover-service');

const { buildFailoverStreamUrl, getSourceHealth, isSourceDown, getFailoverTarget, runSourceWatchdog, autoMatchFailoverMaps } = svc;
const { testXtreamConnection } = require('../services/xtream-service');
const { probeStream } = require('../services/stream-prober');

describe('Round 18 — failover service (backup source auto-failover)', () => {
  beforeEach(async () => {
    await ChannelFailoverMap.deleteMany({});
    await XtreamSource.deleteMany({});
    await Channel.deleteMany({});
    jest.clearAllMocks();
  });

  it('buildFailoverStreamUrl builds a standard Xtream HLS live URL', () => {
    expect(buildFailoverStreamUrl({ serverUrl: 'http://ottstreambox.xyz:80/', username: 'u', password: 'p' }, 12345)).toBe(
      'http://ottstreambox.xyz:80/live/u/p/12345.m3u8',
    );
  });

  it('isSourceDown reads persisted verificationStatus', async () => {
    const verified = await XtreamSource.create({ name: 'A', serverUrl: 'http://a', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'verified' });
    const degraded = await XtreamSource.create({ name: 'B', serverUrl: 'http://b', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'degraded' });
    const blocked = await XtreamSource.create({ name: 'C', serverUrl: 'http://c', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'blocked' });
    const pending = await XtreamSource.create({ name: 'D', serverUrl: 'http://d', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'pending' });

    expect(await isSourceDown(String(verified._id))).toBe(false);
    expect(await isSourceDown(String(degraded._id))).toBe(true);
    expect(await isSourceDown(String(blocked._id))).toBe(true);
    expect(await isSourceDown(String(pending._id))).toBe(false);
    expect(await getSourceHealth(String(verified._id))).toBe('verified');
  });

  it('getFailoverTarget resolves a verified backup mapping to an HLS URL', async () => {
    const primary = await XtreamSource.create({ name: 'NEO', serverUrl: 'http://neo', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'verified', directPlayback: true });
    const backup = await XtreamSource.create({ name: 'Backup', serverUrl: 'http://ottstreambox.xyz:80', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'verified', directPlayback: true });
    const channel = await Channel.create({ channelId: 'CH-1', channelName: 'ENTV1', channelUrl: 'http://neo/live/u/p/1.m3u8', isActive: true });
    await ChannelFailoverMap.create({
      channelId: channel._id,
      channelRef: 'CH-1',
      backupSourceId: backup._id,
      backupChannelName: 'ENTV1',
      backupStreamId: '999',
      matchedBy: 'manual',
      enabled: true,
    });

    const target = await getFailoverTarget(channel, primary._id);
    expect(target).not.toBeNull();
    expect(target!.streamUrl).toContain('/live/plain-user-pass/plain-user-pass/999.m3u8');
    expect(String(target!.source._id)).toBe(String(backup._id));
  });

  it('getFailoverTarget accepts a backup added as Inactive + directPlayback (the planned setup)', async () => {
    const backup = await XtreamSource.create({
      name: 'Backup Maghreb (ottstreambox)',
      serverUrl: 'http://ottstreambox.xyz:80',
      usernameEncrypted: 'x',
      passwordEncrypted: 'y',
      status: 'Inactive', // per the plan: setup must not disturb current streams
      verificationStatus: 'verified',
      directPlayback: true,
    });
    const channel = await Channel.create({ channelId: 'CH-5', channelName: 'ENTV1', channelUrl: 'http://neo/x', isActive: true });
    await ChannelFailoverMap.create({ channelId: channel._id, channelRef: 'CH-5', backupSourceId: backup._id, backupChannelName: 'ENTV1', backupStreamId: '31337' });

    const target = await getFailoverTarget(channel);
    expect(target).not.toBeNull();
    expect(target!.streamUrl).toContain('/31337.m3u8');
  });

  it('getFailoverTarget refuses an Inactive or unhealthy backup', async () => {
    const channel = await Channel.create({ channelId: 'CH-2', channelName: 'X', channelUrl: 'http://neo/x', isActive: true });
    const inactive = await XtreamSource.create({ name: 'B1', serverUrl: 'http://b', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Inactive', verificationStatus: 'verified' });
    const degraded = await XtreamSource.create({ name: 'B2', serverUrl: 'http://b', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'degraded' });

    await ChannelFailoverMap.create({ channelId: channel._id, channelRef: 'CH-2', backupSourceId: inactive._id, backupChannelName: 'X', backupStreamId: '1' });
    expect(await getFailoverTarget(channel)).toBeNull();

    await ChannelFailoverMap.deleteMany({});
    await ChannelFailoverMap.create({ channelId: channel._id, channelRef: 'CH-2', backupSourceId: degraded._id, backupChannelName: 'X', backupStreamId: '1' });
    expect(await getFailoverTarget(channel)).toBeNull();
  });

  it('getFailoverTarget ignores a mapping back to the primary source itself', async () => {
    const primary = await XtreamSource.create({ name: 'NEO', serverUrl: 'http://neo', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'verified' });
    const channel = await Channel.create({ channelId: 'CH-3', channelName: 'Y', channelUrl: 'http://neo/y', isActive: true });
    await ChannelFailoverMap.create({ channelId: channel._id, channelRef: 'CH-3', backupSourceId: primary._id, backupChannelName: 'Y', backupStreamId: '5' });

    expect(await getFailoverTarget(channel, primary._id)).toBeNull();
  });

  it('watchdog marks a source blocked when the API probe fails', async () => {
    (testXtreamConnection as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
    const src = await XtreamSource.create({ name: 'NEO', serverUrl: 'http://neo', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'verified' });

    const res = await runSourceWatchdog();
    expect(res.states[0].health).toBe('blocked');
    const fresh = await XtreamSource.findById(src._id).lean().exec();
    expect(fresh!.verificationStatus).toBe('blocked');
    expect(fresh!.lastError).toBeTruthy();
  });

  it('watchdog keeps a healthy source verified', async () => {
    (testXtreamConnection as jest.Mock).mockResolvedValue({ ok: true, userInfo: { auth: 1 } });
    const src = await XtreamSource.create({ name: 'NEO', serverUrl: 'http://neo', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'verified' });

    const res = await runSourceWatchdog();
    expect(res.states[0].health).toBe('verified');
    const fresh = await XtreamSource.findById(src._id).lean().exec();
    expect(fresh!.verificationStatus).toBe('verified');
  });

  it('watchdog marks a source degraded when the mapped live stream fails', async () => {
    (testXtreamConnection as jest.Mock).mockResolvedValue({ ok: true, userInfo: { auth: 1 } });
    (probeStream as jest.Mock).mockResolvedValue({ status: 'dead', statusCode: 404, error: 'Not found', responseTimeMs: 100 });
    const backup = await XtreamSource.create({ name: 'Backup', serverUrl: 'http://b', usernameEncrypted: 'x', passwordEncrypted: 'y', status: 'Active', verificationStatus: 'verified', directPlayback: true });
    const channel = await Channel.create({ channelId: 'CH-4', channelName: 'Z', channelUrl: 'http://neo/z', isActive: true });
    await ChannelFailoverMap.create({ channelId: channel._id, channelRef: 'CH-4', backupSourceId: backup._id, backupChannelName: 'Z', backupStreamId: '77' });

    const res = await runSourceWatchdog();
    expect(res.states[0].health).toBe('degraded');
  });

  it('watchdog verifies a direct-playback primary by its real stream even when its API is unreachable', async () => {
    // The NEO case: the server cannot reach the source API (TLS block) but the
    // CDN streams the customers use are alive — the source must stay verified.
    (testXtreamConnection as jest.Mock).mockRejectedValue(new Error('Client network socket disconnected before secure TLS connection was established'));
    (probeStream as jest.Mock).mockResolvedValue({ status: 'alive', statusCode: 200, error: null, responseTimeMs: 200 });
    const neo = await XtreamSource.create({
      name: 'Business Cloud NEO', serverUrl: 'https://cf.business-cloud-neo.ru', usernameEncrypted: 'x', passwordEncrypted: 'y',
      status: 'Inactive', verificationStatus: 'blocked', directPlayback: true,
    });
    await Channel.create({
      channelId: 'CH-NEO', channelName: 'قناة NEO', channelUrl: 'https://cf.business-cloud-neo.ru/live/u/p/262849.m3u8', isActive: true,
      metadata: { source: 'xtream', xtreamSourceId: String(neo._id) },
    });

    const res = await runSourceWatchdog();
    expect(res.states[0].health).toBe('verified');
    const fresh = await XtreamSource.findById(neo._id).lean().exec();
    expect(fresh!.verificationStatus).toBe('verified');
    expect(probeStream).toHaveBeenCalledWith('https://cf.business-cloud-neo.ru/live/u/p/262849.m3u8', expect.anything());
  });

  it('auto-match creates maps by normalized name and skips unknowns', async () => {
    const backup = await XtreamSource.create({
      name: 'Backup Maghreb',
      serverUrl: 'http://ottstreambox.xyz:80',
      usernameEncrypted: 'x',
      passwordEncrypted: 'y',
      status: 'Inactive',
      verificationStatus: 'pending',
    });
    await Channel.create({ channelId: 'CH-A', channelName: 'ENTV1', channelUrl: 'http://neo/a', isActive: true });
    await Channel.create({ channelId: 'CH-B', channelName: 'beIN SPORTS 1', channelUrl: 'http://neo/b', isActive: true });

    const result = await autoMatchFailoverMaps(String(backup._id), {});
    expect(result.created).toBe(2); // ENTV1 + beIN SPORTS 1; the third has no match
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const maps = await ChannelFailoverMap.find({ backupSourceId: backup._id }).lean().exec();
    expect(maps).toHaveLength(2);
    expect(maps.some((m) => m.backupStreamId === '101')).toBe(true);
    expect(maps.some((m) => m.backupStreamId === '202')).toBe(true);
  });
});
