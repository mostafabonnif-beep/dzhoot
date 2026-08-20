jest.mock('./subscription-service', () => ({
  isSubscriptionRequired: jest.fn(),
  getActiveSubscription: jest.fn(),
}));

jest.mock('../models/Plan', () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

import {
  getActiveSubscription,
  isSubscriptionRequired,
} from './subscription-service';
import Plan from '../models/Plan';
import { checkPlaybackSubscription } from './playback-access-service';

const mockedRequired = isSubscriptionRequired as jest.MockedFunction<typeof isSubscriptionRequired>;
const mockedActive = getActiveSubscription as jest.MockedFunction<typeof getActiveSubscription>;
const mockedPlanFindById = Plan.findById as jest.MockedFunction<typeof Plan.findById>;

function mockPlanLookup(plan: unknown) {
  mockedPlanFindById.mockReturnValue({
    lean: () => ({ exec: jest.fn().mockResolvedValue(plan) }),
  } as any);
}

describe('checkPlaybackSubscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows playback when the subscription gate is disabled', async () => {
    mockedRequired.mockResolvedValue(false);
    await expect(checkPlaybackSubscription('u1', 'User')).resolves.toEqual({
      allowed: true,
      required: false,
      subscription: null,
      plan: null,
    });
    expect(mockedActive).not.toHaveBeenCalled();
  });

  it('always allows administrators when the gate is enabled', async () => {
    mockedRequired.mockResolvedValue(true);
    await expect(checkPlaybackSubscription('admin', 'Admin')).resolves.toEqual({
      allowed: true,
      required: true,
      subscription: null,
      plan: null,
    });
    expect(mockedActive).not.toHaveBeenCalled();
  });

  it('allows a user with an active subscription and an active plan', async () => {
    const plan = { _id: 'plan-1', status: 'Active', maxConcurrentStreams: 2 };
    const subscription = {
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      planId: plan._id,
    };
    mockedRequired.mockResolvedValue(true);
    mockedActive.mockResolvedValue(subscription as any);
    mockPlanLookup(plan);

    await expect(checkPlaybackSubscription('u1', 'User')).resolves.toEqual({
      allowed: true,
      required: true,
      subscription,
      plan,
    });
  });

  it('rejects a user without an active subscription', async () => {
    mockedRequired.mockResolvedValue(true);
    mockedActive.mockResolvedValue(null);
    await expect(checkPlaybackSubscription('u1', 'User')).resolves.toEqual({
      allowed: false,
      required: true,
      subscription: null,
      plan: null,
    });
  });

  it('rejects a subscription whose plan no longer exists', async () => {
    const subscription = { status: 'ACTIVE', planId: 'missing-plan' };
    mockedRequired.mockResolvedValue(true);
    mockedActive.mockResolvedValue(subscription as any);
    mockPlanLookup(null);

    await expect(checkPlaybackSubscription('u1', 'User')).resolves.toEqual({
      allowed: false,
      required: true,
      subscription,
      plan: null,
    });
  });

  it('rejects a gated request without a user id', async () => {
    mockedRequired.mockResolvedValue(true);
    await expect(checkPlaybackSubscription(undefined, 'User')).resolves.toEqual({
      allowed: false,
      required: true,
      subscription: null,
      plan: null,
    });
    expect(mockedActive).not.toHaveBeenCalled();
  });
});
