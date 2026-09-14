import AppSetting from '../models/AppSetting';
import { recordEgressBytes, resetUsageState } from '../services/usage-metrics';
import {
  normalizeGuard,
  getFreeTierGuardConfig,
  clearFreeTierGuardCache,
  checkFreeTierAdmission,
  registerFreeTierStream,
  getFreeTierBlockedCounts,
  type FreeTierGuardStore,
} from '../services/free-tier-guard';

// Free-tier guards: the shared free code is designed to be handed to many people,
// so its consumption is capped — capacity and daily egress — while shadow mode
// lets the operator size the cap from real data before it ever refuses anyone.

class FakeStore implements FreeTierGuardStore {
  readonly zsets = new Map<string, Map<string, number>>();
  readonly counters = new Map<string, number>();

  async zadd(key: string, score: number, member: string) {
    const set = this.zsets.get(key) || new Map<string, number>();
    set.set(member, score);
    this.zsets.set(key, set);
    return 1;
  }

  async zcard(key: string) {
    return this.zsets.get(key)?.size || 0;
  }

  async zremrangebyscore(key: string, _min: string | number, max: string | number) {
    const set = this.zsets.get(key);
    if (!set) return 0;
    for (const [member, score] of [...set.entries()]) {
      if (score <= Number(max)) set.delete(member);
    }
    return 0;
  }

  async expire() {
    return 1;
  }

  async incr(key: string) {
    const next = (this.counters.get(key) || 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async get() {
    return null;
  }

  async mget(...keys: string[]) {
    return keys.map((key) => {
      const value = this.counters.get(key);
      return value === undefined ? null : String(value);
    });
  }

  async del(key: string) {
    this.zsets.delete(key);
    return 1;
  }

  multi() {
    const operations: Array<() => Promise<unknown>> = [];
    const chain = {
      incr: (key: string) => {
        operations.push(() => this.incr(key));
        return chain;
      },
      expire: () => chain,
      zadd: (key: string, score: number, member: string) => {
        operations.push(() => this.zadd(key, score, member));
        return chain;
      },
      exec: async () => {
        for (const operation of operations) await operation();
        return [];
      },
    };
    return chain;
  }
}

async function setFreeAccess(value: Record<string, unknown>) {
  await AppSetting.updateOne({ key: 'free_access' }, { $set: { value } }, { upsert: true });
  clearFreeTierGuardCache();
}

describe('normalizeGuard', () => {
  it('is permissive by default: shadow mode, no limits', () => {
    expect(normalizeGuard(undefined)).toEqual({
      enforce: false,
      maxConcurrentStreams: 0,
      dailyEgressGb: 0,
    });
  });

  it('only accepts an explicit true for enforcement', () => {
    expect(normalizeGuard({ enforce: 'yes' }).enforce).toBe(false);
    expect(normalizeGuard({ enforce: true }).enforce).toBe(true);
  });

  it('clamps nonsense numbers to something sane', () => {
    expect(normalizeGuard({ maxConcurrentStreams: -5 }).maxConcurrentStreams).toBe(0);
    expect(normalizeGuard({ maxConcurrentStreams: 'abc' }).maxConcurrentStreams).toBe(0);
    expect(normalizeGuard({ dailyEgressGb: 3.9 }).dailyEgressGb).toBe(3);
    expect(normalizeGuard({ maxConcurrentStreams: 10 ** 9 }).maxConcurrentStreams).toBe(100000);
  });
});

describe('getFreeTierGuardConfig', () => {
  beforeEach(() => clearFreeTierGuardCache());

  it('defaults when the operator has not set a guard', async () => {
    expect(await getFreeTierGuardConfig({ fresh: true })).toEqual({
      enforce: false,
      maxConcurrentStreams: 0,
      dailyEgressGb: 0,
    });
  });

  it('reads the guard nested in free_access', async () => {
    await setFreeAccess({ enabled: true, channelGroups: [], showAds: true, guard: { enforce: true, maxConcurrentStreams: 40, dailyEgressGb: 25 } });
    expect(await getFreeTierGuardConfig({ fresh: true })).toEqual({
      enforce: true,
      maxConcurrentStreams: 40,
      dailyEgressGb: 25,
    });
  });
});

describe('checkFreeTierAdmission', () => {
  beforeEach(() => {
    clearFreeTierGuardCache();
    resetUsageState();
  });

  it('fails open when there is no store at all', async () => {
    const admission = await checkFreeTierAdmission('code:FREE', 300, null);
    expect(admission.allowed).toBe(true);
    expect(admission.reason).toBe('NO_REDIS');
  });

  it('allows and registers a viewer when unlimited', async () => {
    const store = new FakeStore();
    const admission = await checkFreeTierAdmission('code:FREE', 300, store);
    expect(admission).toMatchObject({ allowed: true, reason: 'OK', activeStreams: 0 });
    expect(await store.zcard('dz:free:active')).toBe(1);
  });

  it('refuses a new viewer once the concurrency cap is reached (enforce)', async () => {
    await setFreeAccess({ enabled: true, guard: { enforce: true, maxConcurrentStreams: 2 } });
    const store = new FakeStore();
    await registerFreeTierStream('code:A', 300, store);
    await registerFreeTierStream('code:B', 300, store);

    const admission = await checkFreeTierAdmission('code:C', 300, store);
    expect(admission.allowed).toBe(false);
    expect(admission.reason).toBe('CAPACITY_REACHED');
    expect(admission.activeStreams).toBe(2);
    // The refusal is counted for the dashboard.
    const blocked = await getFreeTierBlockedCounts(store);
    expect(blocked.CAPACITY_REACHED).toBe(1);
  });

  it('only counts the overage in shadow mode — never refuses', async () => {
    await setFreeAccess({ enabled: true, guard: { enforce: false, maxConcurrentStreams: 1 } });
    const store = new FakeStore();
    await registerFreeTierStream('code:A', 300, store);

    const admission = await checkFreeTierAdmission('code:B', 300, store);
    expect(admission.allowed).toBe(true);
    expect(admission.reason).toBe('SHADOW_BLOCK');
    // Shadow mode still registers, so the live count matches reality.
    expect(await store.zcard('dz:free:active')).toBe(2);
    const blocked = await getFreeTierBlockedCounts(store);
    expect(blocked.SHADOW_BLOCK).toBe(1);
  });

  it('refuses when the daily egress budget is exhausted (enforce)', async () => {
    await setFreeAccess({ enabled: true, guard: { enforce: true, dailyEgressGb: 1 } });
    const store = new FakeStore();
    // 2 GB of free-tier egress already recorded today.
    recordEgressBytes(2 * 1024 ** 3, { tier: 'free', path: 'proxy' });

    const admission = await checkFreeTierAdmission('code:A', 300, store);
    expect(admission.allowed).toBe(false);
    expect(admission.reason).toBe('BUDGET_EXHAUSTED');
    expect(admission.egressTodayGb).toBeGreaterThanOrEqual(2);
  });

  it('ignores the budget while the spend is under it', async () => {
    await setFreeAccess({ enabled: true, guard: { enforce: true, dailyEgressGb: 50 } });
    const store = new FakeStore();
    recordEgressBytes(1024 ** 3, { tier: 'free', path: 'proxy' });
    const admission = await checkFreeTierAdmission('code:A', 300, store);
    expect(admission.allowed).toBe(true);
    expect(admission.reason).toBe('OK');
  });

  it('does not count a viewer whose stream already ended (expired entries)', async () => {
    await setFreeAccess({ enabled: true, guard: { enforce: true, maxConcurrentStreams: 1 } });
    const store = new FakeStore();
    // An entry that expired a minute ago must not hold a slot.
    await store.zadd('dz:free:active', Date.now() - 60_000, 'code:OLD');

    const admission = await checkFreeTierAdmission('code:NEW', 300, store);
    expect(admission.allowed).toBe(true);
    expect(admission.activeStreams).toBe(0);
  });
});
