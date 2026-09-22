import { PassThrough } from 'stream';
import mongoose from 'mongoose';
import User from '../models/User';
import Plan from '../models/Plan';
import Subscription from '../models/Subscription';
import {
  recordEgressBytes,
  flushUsage,
  getUsageSnapshot,
  persistPeaks,
  resetUsageState,
  createEgressMeter,
  toGb,
  toMbps,
  minuteKey,
  hourKey,
  dayKey,
} from '../services/usage-metrics';
import {
  resolveEgressTier,
  buildUsageConcurrency,
  clearTierCache,
} from '../services/stream-usage-service';

// The numbers behind the resource dashboard: egress accounting (batched, never
// on the streaming hot path) and the tier split that tells the operator how much
// of the load is free-tier.

const EMPTY_CONCURRENCY = { total: 0, byTier: {}, bySource: {}, topChannels: [] };

function drainMeter(meter: NodeJS.ReadWriteStream, chunks: Buffer[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const sink = new PassThrough();
    const received: Buffer[] = [];
    sink.on('data', (chunk: Buffer) => received.push(chunk));
    sink.on('end', () => resolve(Buffer.concat(received)));
    sink.on('error', reject);
    meter.pipe(sink);
    for (const chunk of chunks) meter.write(chunk);
    meter.end();
  });
}

describe('usage metric helpers', () => {
  it('converts bytes to GB and Mbps', () => {
    expect(toGb(1024 ** 3)).toBe(1);
    expect(toGb(512 * 1024 ** 2)).toBe(0.5);
    expect(toGb(0)).toBe(0);
    // 1 MiB in one minute ≈ 0.14 Mbps
    expect(toMbps(1024 ** 2, 60_000)).toBe(0.14);
    expect(toMbps(1_000_000 / 8, 1000)).toBe(1);
    expect(toMbps(1000, 0)).toBe(0);
  });

  it('buckets time consistently', () => {
    const ms = Date.UTC(2026, 8, 13, 10, 30, 15);
    expect(minuteKey(ms)).toBe(Math.floor(ms / 60_000));
    expect(hourKey(ms)).toBe(Math.floor(ms / 3_600_000));
    expect(dayKey(ms)).toBe('2026-09-13');
  });
});

describe('egress accounting', () => {
  beforeEach(() => {
    resetUsageState();
  });

  // A pending flush timer must never outlive the file: it would log after the
  // run ended (Jest then exits non-zero even with every test green).
  afterAll(() => {
    resetUsageState();
  });

  it('counts bytes batched and exposes today+peak without Redis', async () => {
    recordEgressBytes(1024 * 1024, { tier: 'free', path: 'proxy' });
    recordEgressBytes(1024 * 1024, { tier: 'paid', path: 'remux' });

    const snapshot = await getUsageSnapshot({
      ...EMPTY_CONCURRENCY,
      total: 5,
      byTier: { free: 3, paid: 2 },
    });

    // 2 MiB today
    expect(snapshot.now.egressTodayGb).toBe(0.002);
    expect(snapshot.now.concurrentTotal).toBe(5);
    expect(snapshot.now.concurrentFree).toBe(3);
    expect(snapshot.now.concurrentPaid).toBe(2);
    expect(snapshot.byTier.free.egressTodayGb).toBe(0.001);
    expect(snapshot.byTier.paid.egressTodayGb).toBe(0.001);
    expect(snapshot.peak.concurrencyToday).toBe(5);
  });

  it('ignores empty and non-numeric byte counts', async () => {
    recordEgressBytes(0, { tier: 'free' });
    recordEgressBytes(-5, { tier: 'free' });
    recordEgressBytes(Number.NaN, { tier: 'free' });
    const snapshot = await getUsageSnapshot(EMPTY_CONCURRENCY);
    expect(snapshot.now.egressTodayGb).toBe(0);
  });

  it('flushUsage is a no-op (never throws) when Redis is absent', async () => {
    recordEgressBytes(4096, { tier: 'free' });
    await expect(flushUsage()).resolves.toBeUndefined();
  });

  it('persistPeaks is safe without Redis', async () => {
    await expect(persistPeaks(10, 1.5)).resolves.toBeUndefined();
  });

  it('the meter forwards every byte unchanged and counts it', async () => {
    const chunkA = Buffer.alloc(1024 * 1024, 1); // 1 MiB
    const chunkB = Buffer.alloc(1024 * 512, 2); // 0.5 MiB
    const meter = createEgressMeter(() => 'free', 'proxy');

    const received = await drainMeter(meter, [chunkA, chunkB]);

    // Pass-through must not alter the payload (backpressure intact, no buffering).
    expect(received.length).toBe(chunkA.length + chunkB.length);
    expect(received.subarray(0, 4).equals(chunkA.subarray(0, 4))).toBe(true);

    const snapshot = await getUsageSnapshot(EMPTY_CONCURRENCY);
    expect(snapshot.now.egressTodayGb).toBe(0.001); // 1.5 MiB
  });
});

describe('tier resolution', () => {
  const ORIGINAL_DEMO = process.env.DEMO_TV_CODE;

  beforeEach(() => {
    clearTierCache();
    process.env.DEMO_TV_CODE = 'FREEDEMO12345678'; // secret-guard-allow: test fixture
  });

  afterEach(() => {
    if (ORIGINAL_DEMO === undefined) delete process.env.DEMO_TV_CODE;
    else process.env.DEMO_TV_CODE = ORIGINAL_DEMO;
    clearTierCache();
  });

  async function makeUser(overrides: Record<string, unknown> = {}) {
    const code = await (User as any).generateChannelListCode();
    return User.create({
      username: `usage_${new mongoose.Types.ObjectId().toHexString()}`,
      password: 'password123',
      email: `usage_${new mongoose.Types.ObjectId().toHexString()}@example.com`,
      channelListCode: code,
      ...overrides,
    });
  }

  it('the shared free/demo code is free tier', async () => {
    expect(await resolveEgressTier(undefined, 'FREEDEMO12345678')).toBe('free');
    expect(await resolveEgressTier('demo')).toBe('free');
  });

  it('an admin is admin tier', async () => {
    const admin = await makeUser({ role: 'Admin' });
    expect(await resolveEgressTier(String(admin._id))).toBe('admin');
  });

  it('an account flagged freeAccess is free tier', async () => {
    const user = await makeUser({ freeAccess: true });
    expect(await resolveEgressTier(String(user._id))).toBe('free');
  });

  it('an account with no active subscription is free tier', async () => {
    const user = await makeUser();
    expect(await resolveEgressTier(String(user._id))).toBe('free');
  });

  it('an active subscription is paid tier', async () => {
    const user = await makeUser();
    const plan = await Plan.create({ name: 'Paid', durationDays: 30, maxDevices: 1, status: 'Active' });
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
    expect(await resolveEgressTier(String(user._id))).toBe('paid');
  });

  it('an expired subscription falls back to free tier', async () => {
    const user = await makeUser();
    const plan = await Plan.create({ name: 'Old', durationDays: 30, maxDevices: 1, status: 'Active' });
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'EXPIRED',
      startsAt: new Date(Date.now() - 60 * 24 * 3600 * 1000),
      expiresAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    });
    expect(await resolveEgressTier(String(user._id))).toBe('free');
  });

  it('unknown or malformed ids never throw', async () => {
    expect(await resolveEgressTier(undefined)).toBe('unknown');
    expect(await resolveEgressTier('not-an-object-id')).toBe('unknown');
    expect(await resolveEgressTier(new mongoose.Types.ObjectId().toHexString())).toBe('unknown');
  });

  it('memoizes a resolved tier for the same code', async () => {
    expect(await resolveEgressTier(undefined, 'FREEDEMO12345678')).toBe('free');
    // Even after the env changes, the cached answer holds until the TTL expires
    // (a stream must not flip tier mid-watch).
    process.env.DEMO_TV_CODE = 'OTHER';
    expect(await resolveEgressTier(undefined, 'FREEDEMO12345678')).toBe('free');
  });
});

describe('buildUsageConcurrency', () => {
  const ORIGINAL_DEMO = process.env.DEMO_TV_CODE;

  beforeEach(() => {
    clearTierCache();
    process.env.DEMO_TV_CODE = 'FREEDEMO12345678'; // secret-guard-allow: test fixture
  });

  afterEach(() => {
    if (ORIGINAL_DEMO === undefined) delete process.env.DEMO_TV_CODE;
    else process.env.DEMO_TV_CODE = ORIGINAL_DEMO;
  });

  it('splits live sessions by tier and ranks the busiest channels', async () => {
    const concurrency = await buildUsageConcurrency([
      { userId: '', sessionId: 's1', channelListCode: 'FREEDEMO12345678', contentName: 'beIN 1' },
      { userId: '', sessionId: 's2', channelListCode: 'FREEDEMO12345678', contentName: 'beIN 1' },
      { userId: '', sessionId: 's3', channelListCode: 'FREEDEMO12345678', contentName: 'MBC' },
      { userId: '', sessionId: 's4', contentName: '' },
    ] as any);

    expect(concurrency.total).toBe(4);
    expect(concurrency.byTier.free).toBe(3);
    expect(concurrency.byTier.unknown).toBe(1);
    expect(concurrency.topChannels[0]).toEqual({ name: 'beIN 1', count: 2 });
    expect(concurrency.topChannels.map((c) => c.name)).toContain('غير معروف');
  });

  it('returns an empty picture when nothing is streaming', async () => {
    const concurrency = await buildUsageConcurrency([]);
    expect(concurrency).toEqual({ total: 0, byTier: {}, bySource: {}, topChannels: [] });
  });
});
