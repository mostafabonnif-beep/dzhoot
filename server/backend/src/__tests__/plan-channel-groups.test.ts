import mongoose from 'mongoose';
import Plan from '../models/Plan';
import User from '../models/User';
import { redeemCode, generateCodes } from '../services/subscription-service';

// Redeeming a code copies the plan's channel-group scope onto the user so the
// playlist, playback token, channel list and category list all agree.

async function makeUser(username: string) {
  const code = await (User as any).generateChannelListCode();
  return User.create({
    username,
    password: 'password123',
    email: `${username}@example.com`,
    channelListCode: code,
  });
}

async function makePlan(overrides: Record<string, unknown> = {}) {
  return Plan.create({
    name: 'Plan',
    durationDays: 30,
    maxDevices: 1,
    status: 'Active',
    ...overrides,
  });
}

async function firstCode(planId: mongoose.Types.ObjectId): Promise<string> {
  const gen = await generateCodes({ planId: String(planId), quantity: 1 });
  if (!gen.ok || !gen.codes?.length) throw new Error(`setup failed: ${gen.error}`);
  return gen.codes[0];
}

describe('plan channel groups', () => {
  it('defaults to an empty (unrestricted) list', async () => {
    const plan = await makePlan();
    expect((plan as any).channelGroups).toEqual([]);
  });

  it('redeeming a grouped code scopes the user to those groups', async () => {
    const plan = await makePlan({ name: 'Sport only', channelGroups: ['SPORT'] });
    const user = await makeUser('grouped_user');
    const code = await firstCode(plan._id);

    const result = await redeemCode(String(user._id), code);
    expect(result.success).toBe(true);

    const updated = await User.findById(user._id).lean();
    expect((updated as any).accessGroups).toEqual(['SPORT']);
  });

  it('an empty plan scope clears a previous restriction', async () => {
    const restricted = await makePlan({ name: 'Restricted', channelGroups: ['SPORT'] });
    const full = await makePlan({ name: 'Everything', channelGroups: [] });
    const user = await makeUser('upgrade_user');

    await redeemCode(String(user._id), await firstCode(restricted._id));
    expect(((await User.findById(user._id).lean()) as any).accessGroups).toEqual(['SPORT']);

    await redeemCode(String(user._id), await firstCode(full._id));
    expect(((await User.findById(user._id).lean()) as any).accessGroups).toEqual([]);
  });

  it('a legacy plan without the field leaves the user scope untouched', async () => {
    const legacy = await makePlan({ name: 'Legacy' });
    // Simulate a plan saved before the field existed.
    await Plan.collection.updateOne({ _id: legacy._id }, { $unset: { channelGroups: '' } as any });
    const user = await makeUser('legacy_user');
    await User.updateOne({ _id: user._id }, { $set: { accessGroups: ['KEEP'] } });

    const result = await redeemCode(String(user._id), await firstCode(legacy._id));
    expect(result.success).toBe(true);
    expect(((await User.findById(user._id).lean()) as any).accessGroups).toEqual(['KEEP']);
  });

  it('persists multiple groups in order', async () => {
    const plan = await makePlan({ name: 'Multi', channelGroups: ['A', 'B'] });
    const stored = await Plan.findById(plan._id).lean();
    expect((stored as any).channelGroups).toEqual(['A', 'B']);
  });
});
