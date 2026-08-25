import mongoose from 'mongoose';
import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';
import ChannelFailoverMap from '../models/ChannelFailoverMap';

jest.mock('../utils/crypto', () => ({
  decryptSecret: jest.fn().mockReturnValue('plain-user-pass'),
}));

jest.mock('axios', () => ({
  get: jest.fn().mockImplementation((url: string) => {
    if (String(url).includes('get_live_categories')) {
      return Promise.resolve({
        data: [
          { category_id: '10', category_name: '~ ALGERIE ~' },
          { category_id: '20', category_name: '~ MAROC ~' },
          { category_id: '30', category_name: 'SPORTS' },
        ],
      });
    }
    if (String(url).includes('category_id=10')) {
      return Promise.resolve({ data: [{ name: 'ENTV1', stream_id: 101 }] });
    }
    if (String(url).includes('category_id=30')) {
      return Promise.resolve({ data: [{ name: 'beIN SPORTS 1', stream_id: 202 }] });
    }
    return Promise.resolve({
      data: [
        { name: 'ENTV1', stream_id: 101, container_extension: 'm3u8' },
        { name: 'Dz| Algerie SD [ ENTV 1 ] ✦', stream_id: 104 },
        { name: 'ALG: Echorouk TV ᴴᴱⱽᶜ 720p', stream_id: 105 },
        { name: 'beIN SPORTS 1', stream_id: 202 },
        { name: 'قناة لا وجود لها في الكتالوج', stream_id: 303 },
      ],
    });
  }),
}));

jest.mock('../services/xtream-service', () => ({
  testXtreamConnection: jest.fn(),
  buildXtreamApiUrl: jest.fn().mockImplementation((_creds: any, action?: string, extra: any = {}) => {
    let url = 'http://backup.test/player_api.php';
    if (action) url += `?action=${action}`;
    if (extra?.category_id) url += `&category_id=${extra.category_id}`;
    return url;
  }),
}));

jest.mock('../services/stream-prober', () => ({
  probeStream: jest.fn(),
}));

jest.mock('../services/alert-notifier', () => ({
  sendOperationalAlert: jest.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const svc = require('../services/source-failover-service');

const { buildFailoverStreamUrl, getSourceHealth, isSourceDown, getFailoverTarget, runSourceWatchdog, autoMatchFailoverMaps, channelCanonicalKey, nameMatchScore, channelVariantRank, isForeignCatalogChannel } = svc;
const fuzzyAccepted = svc.fuzzyAccepted;
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

  it('channelCanonicalKey maps the messy Maghreb naming to shared keys', () => {
    expect(channelCanonicalKey('Dz|ENTV 1 FULL HD')).toBe('entv1');
    expect(channelCanonicalKey('AR: Algerie EN TV 1')).toBe('entv1');
    expect(channelCanonicalKey('ALG: Programe National ᴴᴱⱽᶜ 720p')).toBe('entv1');
    expect(channelCanonicalKey('Dz| Echorouk TV ✦')).toBe('echourouk');
    expect(channelCanonicalKey('AR: Echourouk TV ᴿᴬᵂ')).toBe('echourouk');
    expect(channelCanonicalKey('ALG: Ennahar TV ᴴᴱⱽᶜ 720p')).toBe('ennahar');
    expect(channelCanonicalKey('AR: Ennahar TV')).toBe('ennahar');
    expect(channelCanonicalKey('ALG: Al24 News ᴴᴱⱽᶜ 720p')).toBe('al24');
    expect(channelCanonicalKey('AL24 News')).toBe('al24');
    expect(channelCanonicalKey('Dz| Algerie Tamazight TV4 ✦')).toBe('tamazight');
    expect(channelCanonicalKey('AR: Algerie Tamazight TV 4')).toBe('tamazight');
    expect(channelCanonicalKey('Dz| El Bilad TV ✦')).toBe('el-bilad');
    expect(channelCanonicalKey('AR: El Bilad')).toBe('el-bilad');
    expect(channelCanonicalKey('BEIN SPORT AR')).toBe('beinsports');
  });

  it('nameMatchScore tolerates typos and ignores junk tokens', () => {
    // Single-significant-token identity after typo tolerance: accepted.
    expect(fuzzyAccepted('dz echorouk tv', 'ar echourouk tv raw')).toBe(true);
    // No shared identity tokens: rejected.
    expect(nameMatchScore('some unrelated channel', 'ennahar tv')).toBe(0);
    expect(fuzzyAccepted('some unrelated channel', 'ennahar tv')).toBe(false);
  });

  it('isForeignCatalogChannel guards against European channels matching Maghreb backups', () => {
    expect(isForeignCatalogChannel('FI: Yle TV1 ᴴᴰ')).toBe(true);
    expect(isForeignCatalogChannel('UK: ITV 4 ᴴᴰ')).toBe(true);
    expect(isForeignCatalogChannel('SE: TV6 ᴴᴰ')).toBe(true);
    expect(isForeignCatalogChannel('BR: GLOBO TV BAHIA')).toBe(true);
    expect(isForeignCatalogChannel('AR: Ennahar TV')).toBe(false);
    expect(isForeignCatalogChannel('AR: Echourouk TV ᴴᴰ')).toBe(false);
    expect(isForeignCatalogChannel('AL24 News')).toBe(false);
  });

  it('auto-match never maps a foreign-prefixed catalog channel', async () => {
    const backup = await XtreamSource.create({
      name: 'Backup Maghreb',
      serverUrl: 'http://ottstreambox.xyz:80',
      usernameEncrypted: 'x',
      passwordEncrypted: 'y',
      status: 'Inactive',
      verificationStatus: 'pending',
    });
    await Channel.create({ channelId: 'CH-YLE', channelName: 'FI: Yle TV1 ᴴᴰ', channelUrl: 'http://neo/yle', isActive: true });
    await Channel.create({ channelId: 'CH-E1', channelName: 'AR: Algerie EN TV 1', channelUrl: 'http://neo/e1', isActive: true });

    const result = await autoMatchFailoverMaps(String(backup._id), {});
    const maps = await ChannelFailoverMap.find({ backupSourceId: backup._id }).lean().exec();
    const refs = maps.map((m) => m.channelRef);
    expect(refs).not.toContain('CH-YLE');
    expect(refs).toContain('CH-E1');
  });

  it('channelVariantRank prefers base/HD over +6H/LQ clones', () => {
    expect(channelVariantRank('ENNAHAR TV +6H')).toBeGreaterThan(channelVariantRank('Ennahar TV HD'));
    expect(channelVariantRank('ENNAHAR TV LQ')).toBeGreaterThan(channelVariantRank('Ennahar TV'));
  });

  it('auto-match resolves the messy Maghreb naming via the canonical dictionary', async () => {
    const backup = await XtreamSource.create({
      name: 'Backup Maghreb',
      serverUrl: 'http://ottstreambox.xyz:80',
      usernameEncrypted: 'x',
      passwordEncrypted: 'y',
      status: 'Inactive',
      verificationStatus: 'pending',
    });
    await Channel.create({ channelId: 'CH-E1', channelName: 'AR: Algerie EN TV 1', channelUrl: 'http://neo/e1', isActive: true });
    await Channel.create({ channelId: 'CH-ECH', channelName: 'AR: Echourouk TV ᴿᴬᵂ', channelUrl: 'http://neo/ech', isActive: true });

    const result = await autoMatchFailoverMaps(String(backup._id), {});
    // ENTV1 (via dictionary) + Echorouk (via dictionary) — the unknown and the
    // duplicate ENTV variant collapse into the same maps.
    expect(result.created).toBeGreaterThanOrEqual(2);
    const maps = await ChannelFailoverMap.find({ backupSourceId: backup._id }).lean().exec();
    const refs = maps.map((m) => m.channelRef).sort();
    expect(refs).toContain('CH-E1');
    expect(refs).toContain('CH-ECH');
    // The duplicate ENTV variant is deduped (first matching backup stream wins).
    const entv = maps.find((m) => m.channelRef === 'CH-E1');
    expect(entv!.backupStreamId).toBe('101');
  });

  it('auto-match respects the categories filter (fetches only those categories)', async () => {
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

    const result = await autoMatchFailoverMaps(String(backup._id), { categories: ['ALGERIE'] });
    expect(result.created).toBe(1); // only ENTV1 (ALGERIE category); beIN is in SPORTS
    const maps = await ChannelFailoverMap.find({ backupSourceId: backup._id }).lean().exec();
    expect(maps).toHaveLength(1);
    expect(maps[0].backupStreamId).toBe('101');
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
