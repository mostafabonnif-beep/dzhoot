import mongoose from 'mongoose';
import Plan from '../models/Plan';
import ActivationCode from '../models/ActivationCode';
import ActivationRedemption from '../models/ActivationRedemption';
import Subscription from '../models/Subscription';
import Device from '../models/Device';
import User from '../models/User';
import {
  redeemCode,
  registerDevice,
  generateCodes,
  revokeCode,
  getUserSubscription,
} from '../services/subscription-service';
import {
  generateActivationCode,
  hashActivationCode,
  normalizeActivationCode,
  codeLast4,
} from '../utils/code-generator';

async function makeUser(username = 'subscriber') {
  const code = await (User as any).generateChannelListCode();
  const user = await User.create({
    username,
    password: 'password123',
    email: `${username}@example.com`,
    channelListCode: code,
  });
  return user;
}

async function makePlan(overrides: Record<string, unknown> = {}) {
  return Plan.create({
    name: '3 Months',
    durationDays: 90,
    maxDevices: 1,
    price: 1500,
    currency: 'DZD',
    status: 'Active',
    ...overrides,
  });
}

async function makeCodes(planId: string, quantity = 1): Promise<string[]> {
  const gen = await generateCodes({ planId, quantity });
  if (!gen.ok) throw new Error(`setup failed: ${gen.error}`);
  return gen.codes;
}

describe('code-generator utils', () => {
  it('normalizes codes (uppercase, strips separators)', () => {
    expect(normalizeActivationCode(' dz hf-ab12-cd34-ef56 ')).toBe('DZHFAB12CD34EF56');
  });

  it('generates a well-formed code and consistent hash/last4', () => {
    const code = generateActivationCode('DZHF');
    expect(code).toMatch(/^DZHF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(hashActivationCode(code)).toBe(hashActivationCode(code.toLowerCase()));
    expect(codeLast4(code)).toBe(code.slice(-4));
  });
});

describe('generateCodes', () => {
  it('creates the requested quantity with hashes only', async () => {
    const plan = await makePlan();
    const codes = await makeCodes(String(plan._id), 5);

    expect(codes).toHaveLength(5);

    const stored = await ActivationCode.find({ planId: plan._id }).lean();
    expect(stored).toHaveLength(5);
    // Stored docs must NOT contain plaintext codes
    for (const doc of stored) {
      expect(codes.some((c) => c === doc.codeHash)).toBe(false);
      expect(doc.codeHash).toHaveLength(64); // sha256 hex
      expect(doc.status).toBe('UNUSED');
    }
  });

  it('rejects unknown plans', async () => {
    const result = await generateCodes({ planId: new mongoose.Types.ObjectId().toString(), quantity: 1 });
    expect(result.ok).toBe(false);
  });
});

describe('redeemCode', () => {
  it('activates a code and creates an ACTIVE subscription', async () => {
    const user = await makeUser();
    const plan = await makePlan({ durationDays: 30 });
    const codes = await makeCodes(String(plan._id));

    const result = await redeemCode(String(user._id), codes[0]);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.subscription.status).toBe('ACTIVE');
    const expiresAt = new Date(result.subscription.expiresAt);
    const startsAt = new Date(result.subscription.startsAt);
    expect(Math.round((expiresAt.getTime() - startsAt.getTime()) / 86400000)).toBe(30);

    const stored = await ActivationCode.findOne({ planId: plan._id }).lean();
    expect(stored!.status).toBe('ACTIVATED');
    expect(String(stored!.activatedBy)).toBe(String(user._id));

    const redemption = await ActivationRedemption.findOne({ userId: user._id }).lean();
    expect(redemption!.result).toBe('SUCCESS');
  });

  it('rejects an invalid code', async () => {
    const user = await makeUser();
    const result = await redeemCode(String(user._id), 'NOT-A-CODE');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('INVALID_CODE');
  });

  it('rejects an already-used code', async () => {
    const user = await makeUser();
    const plan = await makePlan();
    const codes = await makeCodes(String(plan._id));
    await redeemCode(String(user._id), codes[0]);

    const second = await redeemCode(String(user._id), codes[0]);
    expect(second.success).toBe(false);
    if (!second.success) expect(second.code).toBe('CODE_ALREADY_USED');
  });

  it('rejects a revoked code', async () => {
    const user = await makeUser();
    const plan = await makePlan();
    const codes = await makeCodes(String(plan._id));
    const stored = await ActivationCode.findOne({ planId: plan._id }).lean();
    await revokeCode(String(stored!._id));

    const result = await redeemCode(String(user._id), codes[0]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('CODE_REVOKED');
  });

  it('rejects an expired code', async () => {
    const user = await makeUser();
    const plan = await makePlan();
    const codes = await makeCodes(String(plan._id));
    const stored = await ActivationCode.findOne({ planId: plan._id }).lean();
    await (ActivationCode as any).findByIdAndUpdate(stored!._id, {
      codeExpiresAt: new Date(Date.now() - 1000),
    });

    const result = await redeemCode(String(user._id), codes[0]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('CODE_EXPIRED');
  });

  it('rejects codes whose plan is inactive', async () => {
    const user = await makeUser();
    const plan = await makePlan({ status: 'Inactive' });
    const codes = await makeCodes(String(plan._id));

    const result = await redeemCode(String(user._id), codes[0]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('PLAN_UNAVAILABLE');
  });

  it('extends an existing active subscription instead of stacking rows', async () => {
    const user = await makeUser();
    const plan = await makePlan({ durationDays: 30 });
    const codes = await makeCodes(String(plan._id), 2);

    const first = await redeemCode(String(user._id), codes[0]);
    expect(first.success).toBe(true);

    // Redeem a second code before expiry → expiresAt extends by another 30 days
    const second = await redeemCode(String(user._id), codes[1]);
    expect(second.success).toBe(true);
    if (!second.success) return;

    const subs = await Subscription.find({ userId: user._id });
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe('ACTIVE');
    expect(Math.round((subs[0].expiresAt.getTime() - subs[0].startsAt.getTime()) / 86400000)).toBe(60);
  });

  it('registers a device during redemption and enforces the cap', async () => {
    const user = await makeUser();
    const plan = await makePlan({ durationDays: 30, maxDevices: 1 });
    const codes = await makeCodes(String(plan._id));

    const result = await redeemCode(String(user._id), codes[0], {
      deviceId: 'tv-living-room-1',
      name: 'Android TV',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.devicesUsed).toBe(1);
    expect(result.maxDevices).toBe(1);

    // Second device must be rejected
    const second = await registerDevice(String(user._id), { deviceId: 'phone-1', name: 'Phone' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('DEVICE_LIMIT_REACHED');
  });

  it('records failed redemptions for forensics', async () => {
    const user = await makeUser();
    await redeemCode(String(user._id), 'BOGUS-CODE-123');
    const failure = await ActivationRedemption.findOne({ userId: user._id }).lean();
    expect(failure!.result).toBe('FAILURE');
    expect(failure!.failureReason).toBe('INVALID_CODE');
  });
});

describe('getUserSubscription', () => {
  it('returns null subscription for a fresh user', async () => {
    const user = await makeUser();
    const data = await getUserSubscription(String(user._id));
    expect(data.subscription).toBeNull();
    expect(data.maxDevices).toBe(0);
  });

  it('returns subscription, plan and devices for an active user', async () => {
    const user = await makeUser();
    const plan = await makePlan({ durationDays: 30, maxDevices: 2 });
    const codes = await makeCodes(String(plan._id));
    await redeemCode(String(user._id), codes[0], { deviceId: 'tv-1' });

    const data = await getUserSubscription(String(user._id));
    expect(data.subscription!.status).toBe('ACTIVE');
    expect(data.plan!.name).toBe('3 Months');
    expect(data.devicesUsed).toBe(1);
    expect(data.maxDevices).toBe(2);
  });

  it('reports an expired active row as EXPIRED instead of granting access in the UI', async () => {
    const user = await makeUser('expired-subscription');
    const plan = await makePlan({ durationDays: 30 });
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 3 * 86400000),
      expiresAt: new Date(Date.now() - 1000),
    });

    const data = await getUserSubscription(String(user._id));
    expect(data.subscription!.status).toBe('EXPIRED');
    expect(data.plan!.name).toBe('3 Months');
  });
});

describe('revokeCode', () => {
  it('cannot revoke an activated code', async () => {
    const user = await makeUser();
    const plan = await makePlan();
    const codes = await makeCodes(String(plan._id));
    await redeemCode(String(user._id), codes[0]);

    const stored = await ActivationCode.findOne({ planId: plan._id }).lean();
    const result = await revokeCode(String(stored!._id));
    expect(result.ok).toBe(false);
  });
});

describe('Device model', () => {
  it('enforces unique (userId, deviceId)', async () => {
    const user = await makeUser();
    await Device.create({ userId: user._id, deviceId: 'same-device' });
    await expect(
      Device.create({ userId: user._id, deviceId: 'same-device' }),
    ).rejects.toThrow();
  });
});
