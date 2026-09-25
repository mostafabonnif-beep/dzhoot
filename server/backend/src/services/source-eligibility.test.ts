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
});
