/**
 * The two forms of the eligibility rule must agree.
 *
 * `customerTitleEligibilityClauses()` is the Mongo form (used as a `$or` filter)
 * and `isSourceEligibleForCustomerTitles()` is the in-memory form (used after a
 * document is loaded). They describe one policy — a source may serve a title the
 * customer can see — and the production incident of 2026-09-25 happened because
 * two route files each carried their own copy and one drifted strict. This suite
 * fails if they ever disagree again.
 */

import XtreamSource from '../models/XtreamSource';
import {
  customerTitleEligibilityClauses,
  isSourceEligibleForCustomerTitles,
  isSourceEligibleForVod,
  syncCandidateClauses,
  syncFamilyPlan,
} from './source-eligibility';

const combos: Array<{
  status: 'Active' | 'Inactive';
  verificationStatus: 'verified' | 'degraded';
  customerVisible: boolean;
  directPlayback: boolean;
}> = [];
for (const status of ['Active', 'Inactive'] as const) {
  for (const verificationStatus of ['verified', 'degraded'] as const) {
    for (const customerVisible of [true, false]) {
      for (const directPlayback of [true, false]) {
        combos.push({ status, verificationStatus, customerVisible, directPlayback });
      }
    }
  }
}

describe('source eligibility for customer-visible titles', () => {
  it('agrees with the Mongo clause set for every combination', async () => {
    await XtreamSource.deleteMany({});
    const created = [];
    for (const [i, combo] of combos.entries()) {
      created.push(
        await XtreamSource.create({
          name: `s${i}`,
          serverUrl: 'http://panel.test',
          usernameEncrypted: 'u',
          passwordEncrypted: 'p',
          ...combo,
        }),
      );
    }

    const matched = await XtreamSource.find({
      _id: { $in: created.map((d) => d._id) },
      $or: customerTitleEligibilityClauses(),
    })
      .select('_id')
      .lean();
    const viaQuery = new Set(matched.map((d) => String(d._id)));
    const viaPredicate = new Set(
      created
        .filter((d) => isSourceEligibleForCustomerTitles(d as unknown as never))
        .map((d) => String(d._id)),
    );

    expect([...viaQuery].sort()).toEqual([...viaPredicate].sort());
    // Sanity: the suite is worthless if nothing is eligible.
    expect(viaQuery.size).toBeGreaterThan(0);
  });

  it('treats a live-degraded source that is customer-visible or direct-ready as eligible', () => {
    // Exactly the production shape: the live watchdog failed the source, but the
    // catalog still lists its titles.
    expect(
      isSourceEligibleForCustomerTitles({
        status: 'Inactive',
        verificationStatus: 'degraded',
        customerVisible: true,
        directPlayback: false,
      }),
    ).toBe(true);
    expect(
      isSourceEligibleForCustomerTitles({
        status: 'Inactive',
        verificationStatus: 'degraded',
        customerVisible: false,
        directPlayback: true,
      }),
    ).toBe(true);
  });

  it('keeps the guard for a source with no visibility signal and no live verdict', () => {
    expect(
      isSourceEligibleForCustomerTitles({
        status: 'Inactive',
        verificationStatus: 'degraded',
        customerVisible: false,
        directPlayback: false,
      }),
    ).toBe(false);
    expect(isSourceEligibleForCustomerTitles(null)).toBe(false);
    expect(isSourceEligibleForCustomerTitles(undefined)).toBe(false);
  });

  it('is a boolean for every shape, including partially loaded documents', () => {
    expect(isSourceEligibleForCustomerTitles({})).toBe(false);
    expect(isSourceEligibleForCustomerTitles({ status: 'Active' })).toBe(false);
  });

  it('accepts a VOD-verified source for on-demand titles only', () => {
    const vodOnly = {
      status: 'Inactive',
      verificationStatus: 'degraded',
      customerVisible: false,
      directPlayback: false,
      vodVerificationStatus: 'verified',
    };
    // On-demand may proceed on the VOD probe alone...
    expect(isSourceEligibleForVod(vodOnly)).toBe(true);
    // ...while the customer-title rule is unchanged, so a VOD verdict cannot be
    // mistaken for evidence about live channels.
    expect(isSourceEligibleForCustomerTitles(vodOnly)).toBe(false);
  });

  it('does not treat an untested or failed VOD family as eligible', () => {
    const base = { status: 'Inactive', verificationStatus: 'degraded' };
    expect(isSourceEligibleForVod({ ...base, vodVerificationStatus: 'pending' })).toBe(false);
    expect(isSourceEligibleForVod({ ...base, vodVerificationStatus: 'blocked' })).toBe(false);
    expect(isSourceEligibleForVod({ ...base })).toBe(false);
    expect(isSourceEligibleForVod(null)).toBe(false);
  });

  it('keeps importing the on-demand catalog of a customer-visible source whose live is down', () => {
    // The production shape measured 2026-09-25: «neo 4k» held 25,960 customer-visible channels,
    // 67,597 movies and 17,195 series while its live verdict read `Inactive`. Refusing to sync it
    // froze movies, series AND channels for three days.
    expect(
      syncFamilyPlan({
        status: 'Inactive',
        verificationStatus: 'verified',
        customerVisible: true,
        directPlayback: true,
      }),
    ).toEqual({ live: true, onDemand: true });
  });

  it('stops importing live channels from a source whose live playback was probed dead', () => {
    // «MIBOX» measured 2026-09-25: panel answered auth=1 and its movies streamed (HTTP 206), but
    // every live sample was empty. Its VOD must keep syncing; its dead channels must not come back.
    expect(
      syncFamilyPlan({
        status: 'Inactive',
        verificationStatus: 'degraded',
        customerVisible: false,
        directPlayback: true,
      }),
    ).toEqual({ live: false, onDemand: true });
  });

  it('refuses every family when the panel is blocked or gives no evidence at all', () => {
    expect(syncFamilyPlan({ status: 'Inactive', verificationStatus: 'blocked', directPlayback: true })).toEqual({
      live: false,
      onDemand: false,
    });
    expect(syncFamilyPlan({ status: 'Inactive', verificationStatus: 'pending' })).toEqual({
      live: false,
      onDemand: false,
    });
    expect(syncFamilyPlan(null)).toEqual({ live: false, onDemand: false });
  });

  it('selects precisely the sources the sync plan would accept, and never an empty list', async () => {
    // The scheduler used to filter on `status: 'Active'`; when every source went Inactive it
    // produced an EMPTY list and the task reported success while syncing nothing. This asserts the
    // selection query and the plan agree, so that divergence cannot come back.
    await XtreamSource.deleteMany({});
    const cases = [
      { name: 'live-ok', status: 'Active' as const, verificationStatus: 'verified' as const },
      { name: 'vod-only', status: 'Inactive' as const, verificationStatus: 'degraded' as const, vodVerificationStatus: 'verified' as const },
      { name: 'curated', status: 'Inactive' as const, verificationStatus: 'degraded' as const, customerVisible: true },
      { name: 'direct', status: 'Inactive' as const, verificationStatus: 'degraded' as const, directPlayback: true },
      { name: 'blocked', status: 'Inactive' as const, verificationStatus: 'blocked' as const, directPlayback: true },
      { name: 'brand-new', status: 'Inactive' as const, verificationStatus: 'pending' as const },
    ];
    const created = [];
    for (const c of cases) {
      created.push(
        await XtreamSource.create({
          serverUrl: 'http://panel.test',
          usernameEncrypted: 'u',
          passwordEncrypted: 'p',
          ...c,
        }),
      );
    }

    const selected = await XtreamSource.find({ $or: syncCandidateClauses() })
      .select('name status verificationStatus vodVerificationStatus customerVisible directPlayback')
      .lean();
    const viaQuery = new Set(selected.map((d) => String(d.name)));
    const viaPlan = new Set(
      created
        .filter((d) => {
          const plan = syncFamilyPlan(d as unknown as never);
          return plan.live || plan.onDemand;
        })
        .map((d) => String(d.name)),
    );

    // The invariant that matters: the selection query must never omit a source the plan accepts.
    // (It may select MORE — a `blocked` source is deliberately selected so the scheduler can
    // record it as skipped with a reason instead of silently not mentioning it.)
    for (const name of viaPlan) expect(viaQuery.has(name)).toBe(true);
    expect([...viaPlan].sort()).toEqual(['curated', 'direct', 'live-ok', 'vod-only']);
    // A source with no evidence yet is not even considered: it needs a verification first.
    expect(viaQuery.has('brand-new')).toBe(false);
    expect(viaQuery.size).toBeGreaterThan(0);
  });
});
