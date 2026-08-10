import mongoose from 'mongoose';
import Plan from '../models/Plan';
import Subscription from '../models/Subscription';
import AppSetting from '../models/AppSetting';
import User from '../models/User';
import {
  isSubscriptionRequired,
  getActiveSubscription,
  redeemCode,
  generateCodes,
} from '../services/subscription-service';

async function makeUser(username = 'gateuser') {
  const code = await (User as any).generateChannelListCode();
  return User.create({
    username,
    password: 'password123',
    email: `${username}@example.com`,
    channelListCode: code,
  });
}

async function makePlan() {
  return Plan.create({ name: 'Gate Plan', durationDays: 30, maxDevices: 2, status: 'Active' });
}

describe('subscription gate', () => {
  it('subscription_required defaults to false', async () => {
    expect(await isSubscriptionRequired()).toBe(false);
  });

  it('reflects the AppSetting flag', async () => {
    await AppSetting.create({ key: 'subscription_required', value: true });
    expect(await isSubscriptionRequired()).toBe(true);
    await AppSetting.updateOne({ key: 'subscription_required' }, { $set: { value: false } });
    expect(await isSubscriptionRequired()).toBe(false);
  });

  it('getActiveSubscription returns only unexpired ACTIVE subscriptions', async () => {
    const user = await makeUser();
    const plan = await makePlan();

    // Expired subscription must not be returned
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 60 * 86400000),
      expiresAt: new Date(Date.now() - 30 * 86400000),
    });
    expect(await getActiveSubscription(String(user._id))).toBeNull();

    // Active one must be returned
    const gen = await generateCodes({ planId: String(plan._id), quantity: 1 });
    if (!gen.ok) throw new Error('setup failed');
    await redeemCode(String(user._id), gen.codes[0]);
    const active = await getActiveSubscription(String(user._id));
    expect(active).not.toBeNull();
    expect(active!.status).toBe('ACTIVE');
  });
});
