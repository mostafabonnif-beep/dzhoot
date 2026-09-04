import mongoose from 'mongoose';
import Plan from '../models/Plan';
import Subscription from '../models/Subscription';
import AppSetting from '../models/AppSetting';
import User from '../models/User';
import {
  checkPlaybackSubscription,
  planAllowsContentType,
} from '../services/playback-access-service';

async function makeUser(username = 'ctgateuser') {
  const code = await (User as any).generateChannelListCode();
  return User.create({
    username,
    password: 'password123',
    email: `${username}@example.com`,
    channelListCode: code,
  });
}

async function setRequired(value: boolean) {
  await AppSetting.updateOne({ key: 'subscription_required' }, { $set: { value } }, { upsert: true });
}

async function subscribe(userId: mongoose.Types.ObjectId, planId: mongoose.Types.ObjectId) {
  await Subscription.create({
    userId,
    planId,
    status: 'ACTIVE',
    startsAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
  });
}

describe('plan content types (work-plan part 5)', () => {
  it('planAllowsContentType: empty/missing contentTypes grants everything', () => {
    expect(planAllowsContentType(null, 'Live')).toBe(false);
    expect(planAllowsContentType({}, 'Live')).toBe(true);
    expect(planAllowsContentType({ contentTypes: [] }, 'VOD')).toBe(true);
    expect(planAllowsContentType({ contentTypes: ['Live'] }, 'Live')).toBe(true);
    expect(planAllowsContentType({ contentTypes: ['Live'] }, 'VOD')).toBe(false);
    expect(planAllowsContentType({ contentTypes: ['Live', 'VOD'] }, 'VOD')).toBe(true);
  });

  it('a Live-only plan blocks VOD playback but allows Live', async () => {
    await setRequired(true);
    const user = await makeUser();
    const plan = await Plan.create({
      name: 'Live only',
      durationDays: 30,
      maxDevices: 1,
      status: 'Active',
      contentTypes: ['Live'],
    });
    await subscribe(user._id, plan._id);

    const live = await checkPlaybackSubscription(String(user._id), 'User', 'Live');
    expect(live.allowed).toBe(true);

    const vod = await checkPlaybackSubscription(String(user._id), 'User', 'VOD');
    expect(vod.allowed).toBe(false);
  });

  it('a VOD-only plan blocks Live playback', async () => {
    await setRequired(true);
    const user = await makeUser('ctvoduser');
    const plan = await Plan.create({
      name: 'VOD only',
      durationDays: 30,
      maxDevices: 1,
      status: 'Active',
      contentTypes: ['VOD'],
    });
    await subscribe(user._id, plan._id);

    const vod = await checkPlaybackSubscription(String(user._id), 'User', 'VOD');
    expect(vod.allowed).toBe(true);

    const live = await checkPlaybackSubscription(String(user._id), 'User', 'Live');
    expect(live.allowed).toBe(false);
  });

  it('legacy plans without contentTypes keep granting everything', async () => {
    await setRequired(true);
    const user = await makeUser('ctlegacyuser');
    const plan = await Plan.create({
      name: 'Legacy',
      durationDays: 30,
      maxDevices: 1,
      status: 'Active',
    });
    await subscribe(user._id, plan._id);

    for (const ct of ['Live', 'VOD'] as const) {
      const res = await checkPlaybackSubscription(String(user._id), 'User', ct);
      expect(res.allowed).toBe(true);
    }
  });

  it('admins bypass the content-type restriction', async () => {
    await setRequired(true);
    const res = await checkPlaybackSubscription(undefined, 'Admin', 'VOD');
    expect(res.allowed).toBe(true);
  });
});
