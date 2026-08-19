jest.mock('./subscription-service', () => ({
  isSubscriptionRequired: jest.fn(),
  getActiveSubscription: jest.fn(),
}));

import {
  getActiveSubscription,
  isSubscriptionRequired,
} from './subscription-service';
import { checkPlaybackSubscription } from './playback-access-service';

const mockedRequired = isSubscriptionRequired as jest.MockedFunction<typeof isSubscriptionRequired>;
const mockedActive = getActiveSubscription as jest.MockedFunction<typeof getActiveSubscription>;

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
    });
    expect(mockedActive).not.toHaveBeenCalled();
  });

  it('always allows administrators when the gate is enabled', async () => {
    mockedRequired.mockResolvedValue(true);
    await expect(checkPlaybackSubscription('admin', 'Admin')).resolves.toEqual({
      allowed: true,
      required: true,
      subscription: null,
    });
    expect(mockedActive).not.toHaveBeenCalled();
  });

  it('allows a user with an active subscription', async () => {
    const subscription = { status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) };
    mockedRequired.mockResolvedValue(true);
    mockedActive.mockResolvedValue(subscription as any);
    await expect(checkPlaybackSubscription('u1', 'User')).resolves.toEqual({
      allowed: true,
      required: true,
      subscription,
    });
  });

  it('rejects a user without an active subscription', async () => {
    mockedRequired.mockResolvedValue(true);
    mockedActive.mockResolvedValue(null);
    await expect(checkPlaybackSubscription('u1', 'User')).resolves.toEqual({
      allowed: false,
      required: true,
      subscription: null,
    });
  });

  it('rejects a gated request without a user id', async () => {
    mockedRequired.mockResolvedValue(true);
    await expect(checkPlaybackSubscription(undefined, 'User')).resolves.toEqual({
      allowed: false,
      required: true,
      subscription: null,
    });
    expect(mockedActive).not.toHaveBeenCalled();
  });
});
