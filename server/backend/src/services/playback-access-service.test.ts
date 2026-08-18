import Plan from '../models/Plan';
import Subscription from '../models/Subscription';
import User from '../models/User';
import { checkPlaybackSubscription } from './playback-access-service';

describe('playback entitlement policy', () => {
  async function makeUser(username: string) {
    const code = await (User as any).generateChannelListCode();
    return User.create({
      username,
      password: 'password123',
      email: `${username}@example.com`,
      channelListCode: code,
    });
  }

  it('returns plan entitlements and concurrent stream limit', async () => {
    const user = await makeUser(`ent-${Date.now()}`);
    const plan = await Plan.create({
      name: 'Live Only',
      durationDays: 30,
      maxDevices: 2,
      status: 'Active',
      features: { allowLive: true, allowVod: false, maxConcurrentStreams: 3 },
    });
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'ACTIVE',
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const access = await checkPlaybackSubscription(String(user._id), 'User');
    expect(access.allowed).toBe(true);
    expect(access.entitlement.allowLive).toBe(true);
    expect(access.entitlement.allowVod).toBe(false);
    expect(access.entitlement.maxConcurrentStreams).toBe(3);
    expect(String(access.plan._id)).toBe(String(plan._id));
  });

  it('defaults legacy plans to allow live and VOD', async () => {
    const user = await makeUser(`legacy-${Date.now()}`);
    const plan = await Plan.create({ name: 'Legacy', durationDays: 30, maxDevices: 1, status: 'Active' });
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'ACTIVE',
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const access = await checkPlaybackSubscription(String(user._id), 'User');
    expect(access.entitlement.allowLive).toBe(true);
    expect(access.entitlement.allowVod).toBe(true);
    expect(access.entitlement.maxConcurrentStreams).toBeNull();
  });
});
