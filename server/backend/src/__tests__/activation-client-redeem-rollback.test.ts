import request from 'supertest';
import express from 'express';
import Plan from '../models/Plan';
import ActivationCode from '../models/ActivationCode';
import ActivationRedemption from '../models/ActivationRedemption';
import Subscription from '../models/Subscription';
import Device from '../models/Device';
import User from '../models/User';
import { generateActivationCode, hashActivationCode, normalizeActivationCode } from '../utils/code-generator';

/**
 * Regression: POST /client-redeem mints a throwaway User and then calls
 * redeemCode(), which can write a Device, a Subscription, an ACTIVATED
 * ActivationCode (activatedBy = throwaway user) and ActivationRedemption rows
 * before it reports a failure — or throws outright.
 *
 * The old compensation only did `User.deleteOne()`, which left the code
 * ACTIVATED with activatedBy pointing at the deleted account. The replay branch
 * of the route then finds no user and answers 401 ACCOUNT_INACTIVE forever: the
 * customer's paid code is burned and the Subscription row is orphaned.
 *
 * redeemCode is mocked here (delegating writes to the real models, in the same
 * order the service performs them) so the failure can be injected at a chosen
 * point — including after the code has been flipped to ACTIVATED.
 */

jest.mock('../services/subscription-service', () => ({
  ...jest.requireActual('../services/subscription-service'),
  redeemCode: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const subscriptionService = require('../services/subscription-service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const activationRouter = require('../routes/activation');

const mockedRedeemCode = subscriptionService.redeemCode as jest.Mock;
const realRedeemCode: (
  userId: string,
  rawCode: string,
  deviceInfo?: any,
  ip?: string,
) => Promise<{ success: boolean; [key: string]: any }> =
  jest.requireActual('../services/subscription-service').redeemCode;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/activation', activationRouter);
  return app;
}

let plan: any;
let code: string;
let codeHash: string;
let errorSpy: jest.SpyInstance;

async function makePlanAndUnusedCode() {
  plan = await Plan.create({
    name: 'Rollback Plan',
    durationDays: 30,
    maxDevices: 1,
    price: 1500,
    currency: 'DZD',
    status: 'Active',
  });
  code = generateActivationCode('DZHF');
  codeHash = hashActivationCode(normalizeActivationCode(code));
  await ActivationCode.create({
    codeHash,
    codeLast4: code.slice(-4),
    prefix: 'DZHF',
    planId: plan._id,
    status: 'UNUSED',
  });
}

async function makeCustomer(username: string) {
  return User.create({
    username,
    password: 'password123',
    email: `${username}@example.com`,
    channelListCode: await (User as any).generateChannelListCode(),
  });
}

/**
 * Replay, against a real database, every write the real redeemCode() performs
 * before its last failure point: atomic claim -> device -> subscription ->
 * code ACTIVATED (activatedBy = user) -> SUCCESS redemption row. A failure
 * reported after this has mutated everything the caller owns.
 */
async function simulateRedeemWritesAfterActivation(userId: string, deviceId: string) {
  const now = new Date();
  const stored = await ActivationCode.findOne({ codeHash }).exec();
  await ActivationCode.updateOne({ _id: stored!._id }, { $set: { status: 'ACTIVATING' } }).exec();
  const subscription = await Subscription.create({
    userId,
    planId: stored!.planId,
    activationCodeId: stored!._id,
    status: 'ACTIVE',
    startsAt: now,
    expiresAt: new Date(now.getTime() + 30 * 86400000),
  });
  await Device.create({ userId, deviceId });
  await ActivationCode.updateOne(
    { _id: stored!._id },
    { $set: { status: 'ACTIVATED', activatedAt: now, activatedBy: userId } },
  ).exec();
  await ActivationRedemption.create({
    activationCodeId: stored!._id,
    userId,
    deviceId,
    subscriptionId: subscription._id,
    result: 'SUCCESS',
  });
  return subscription;
}

async function expectNoTraceOf(transientUserId: string) {
  expect(await Subscription.countDocuments({ userId: transientUserId })).toBe(0);
  expect(await Device.countDocuments({ userId: transientUserId })).toBe(0);
  expect(await ActivationRedemption.countDocuments({ userId: transientUserId })).toBe(0);
  expect(await User.findById(transientUserId).lean().exec()).toBeNull();
}

async function postClientRedeem(deviceId: string) {
  return request(buildApp())
    .post('/api/v1/activation/client-redeem')
    .send({ code, deviceId, deviceName: 'Android TV', platform: 'android', appVersion: '1.0.1' });
}

describe('POST /client-redeem compensation', () => {
  let transientUserId: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    transientUserId = '';
    await makePlanAndUnusedCode();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('reverts code, rows and account when redeemCode fails after ACTIVATED was written', async () => {
    mockedRedeemCode.mockImplementation(async (userId: string, _rawCode: string, deviceInfo: any) => {
      transientUserId = userId;
      await simulateRedeemWritesAfterActivation(userId, deviceInfo.deviceId);
      return { success: false, error: 'Device limit reached for your subscription', code: 'DEVICE_LIMIT_REACHED' };
    });

    const res = await postClientRedeem('tv-rollback-1');

    // External contract for the failure path is unchanged.
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: 'Device limit reached for your subscription',
      code: 'DEVICE_LIMIT_REACHED',
    });

    // The paid code is back in the pool, with activatedBy cleared — not pointing
    // at the account that is about to disappear.
    const stored = await ActivationCode.findOne({ codeHash }).lean();
    expect(stored!.status).toBe('UNUSED');
    expect(stored!.activatedBy).toBeNull();
    expect(stored!.activatedAt).toBeNull();

    await expectNoTraceOf(transientUserId);

    // Proof it is not burned: the real service activates it for a customer.
    const customer = await makeCustomer('rollback-customer');
    const redeemed = await realRedeemCode(String(customer._id), code);
    expect(redeemed.success).toBe(true);
  });

  it('reverts the same state when redeemCode throws after writing it', async () => {
    mockedRedeemCode.mockImplementation(async (userId: string, _rawCode: string, deviceInfo: any) => {
      transientUserId = userId;
      await simulateRedeemWritesAfterActivation(userId, deviceInfo.deviceId);
      throw new Error('simulated post-write crash');
    });

    const res = await postClientRedeem('tv-rollback-2');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Internal Server Error' });

    const stored = await ActivationCode.findOne({ codeHash }).lean();
    expect(stored!.status).toBe('UNUSED');
    expect(stored!.activatedBy).toBeNull();

    await expectNoTraceOf(transientUserId);

    const customer = await makeCustomer('rollback-customer-2');
    const redeemed = await realRedeemCode(String(customer._id), code);
    expect(redeemed.success).toBe(true);
  });

  it('removes the account and its FAILURE ledger row when redeemCode reported a lost claim race', async () => {
    mockedRedeemCode.mockImplementation(async (userId: string, _rawCode: string, deviceInfo: any) => {
      transientUserId = userId;
      // Exactly what the real service writes on its pre-claim failure branches
      // (recordRedemption(existing, userId, ...) with a FAILURE result).
      await ActivationRedemption.create({
        activationCodeId: null,
        userId,
        deviceId: deviceInfo.deviceId,
        result: 'FAILURE',
        failureReason: 'CODE_ALREADY_USED',
      });
      return { success: false, error: 'This code has already been used', code: 'CODE_ALREADY_USED' };
    });

    const res = await postClientRedeem('tv-rollback-3');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'This code has already been used',
      code: 'CODE_ALREADY_USED',
    });

    expect(await ActivationRedemption.countDocuments({ userId: transientUserId })).toBe(0);
    expect(await User.findById(transientUserId).lean().exec()).toBeNull();

    // Code untouched (redeemCode never claimed it) — still redeemable.
    const stored = await ActivationCode.findOne({ codeHash }).lean();
    expect(stored!.status).toBe('UNUSED');
  });

  it('never touches the account that won a concurrent claim race', async () => {
    let winnerId = '';
    mockedRedeemCode.mockImplementation(async (userId: string, _rawCode: string, deviceInfo: any) => {
      transientUserId = userId;
      const winner = await makeCustomer('claim-race-winner');
      winnerId = String(winner._id);
      await simulateRedeemWritesAfterActivation(winnerId, deviceInfo.deviceId);
      return { success: false, error: 'This code is being activated', code: 'CODE_ALREADY_USED' };
    });

    const res = await postClientRedeem('tv-rollback-4');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_ALREADY_USED');

    // The winner's activation and subscription survive untouched; only the
    // throwaway account is compensated.
    const stored = await ActivationCode.findOne({ codeHash }).lean();
    expect(stored!.status).toBe('ACTIVATED');
    expect(String(stored!.activatedBy)).toBe(winnerId);
    expect(await Subscription.countDocuments({ userId: winnerId })).toBe(1);
    expect(await User.findById(winnerId).lean().exec()).not.toBeNull();

    expect(await Subscription.countDocuments({ userId: transientUserId })).toBe(0);
    expect(await Device.countDocuments({ userId: transientUserId })).toBe(0);
    expect(await User.findById(transientUserId).lean().exec()).toBeNull();
  });

  it('keeps the account (no dangling activatedBy) when the code cannot be released, and a retry completes via the replay branch', async () => {
    mockedRedeemCode.mockImplementation(async (userId: string, _rawCode: string, deviceInfo: any) => {
      transientUserId = userId;
      await simulateRedeemWritesAfterActivation(userId, deviceInfo.deviceId);
      return { success: false, error: 'Device limit reached for your subscription', code: 'DEVICE_LIMIT_REACHED' };
    });

    // Simulate the release write itself failing (mongo outage), i.e. compensation
    // cannot be completed. `.exec()` is what the route calls, so the stub keeps
    // that shape.
    const realUpdateOne = ActivationCode.updateOne.bind(ActivationCode);
    const updateOneSpy = jest.spyOn(ActivationCode, 'updateOne').mockImplementation(((
      filter: any,
      update: any,
      options?: any,
    ) => {
      if (filter && filter.activatedBy) {
        return { exec: () => Promise.reject(new Error('simulated mongo outage')) } as any;
      }
      return realUpdateOne(filter, update, options);
    }) as any);

    const res = await postClientRedeem('tv-rollback-5');
    updateOneSpy.mockRestore();

    // Still a clean contract error — and the state was NOT half-reverted: the
    // account and its rows are intact, so nothing dangles.
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: 'Device limit reached for your subscription',
      code: 'DEVICE_LIMIT_REACHED',
    });

    const stored = await ActivationCode.findOne({ codeHash }).lean();
    expect(stored!.status).toBe('ACTIVATED');
    expect(String(stored!.activatedBy)).toBe(transientUserId);
    expect(await User.findById(transientUserId).lean().exec()).not.toBeNull();
    expect(await Subscription.countDocuments({ userId: transientUserId })).toBe(1);

    // Not burned: the same code still activates for the customer, through the
    // replay branch (which needs that account to exist).
    const retry = await postClientRedeem('tv-rollback-5');
    expect(retry.status).toBe(200);
    expect(retry.body.success).toBe(true);
    expect(retry.body.data.subscription.status).toBe('ACTIVE');
    expect(retry.body.sessionId).toHaveLength(64);
    // The replay path never re-enters redeemCode.
    expect(mockedRedeemCode).toHaveBeenCalledTimes(1);
  });

  it('does not delete the code from the pool for a plain no-write failure', async () => {
    mockedRedeemCode.mockImplementation(async (userId: string) => {
      transientUserId = userId;
      return { success: false, error: 'Invalid code', code: 'INVALID_CODE' };
    });

    const res = await postClientRedeem('tv-rollback-6');

    expect(res.status).toBe(400);
    expect(await User.findById(transientUserId).lean().exec()).toBeNull();

    const stored = await ActivationCode.findOne({ codeHash }).lean();
    expect(stored!.status).toBe('UNUSED');
    expect(stored!.activatedBy).toBeNull();
  });
});
