import crypto from 'crypto';
import mongoose from 'mongoose';
import Plan from '../models/Plan';
import ActivationCode from '../models/ActivationCode';
import ActivationRedemption from '../models/ActivationRedemption';
import Subscription from '../models/Subscription';
import Device from '../models/Device';
import Reseller from '../models/Reseller';
import CreditTransaction from '../models/CreditTransaction';
import { getRedisClient, isRedisReady } from './redis';
import {
  normalizeActivationCode,
  generateActivationCode,
  hashActivationCode,
  codeLast4,
  hashIp,
} from '../utils/code-generator';
import { encryptSecret } from '../utils/crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_LOCK_TTL_MS = 15_000;
const DEVICE_LOCK_WAIT_MS = 5_000;
const localDeviceLocks = new Map<string, Promise<void>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDeviceLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = localDeviceLocks.get(userId) || Promise.resolve();
  let releaseLocal!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLocal = resolve;
  });
  const chain = previous.then(() => current);
  localDeviceLocks.set(userId, chain);
  await previous;

  const redis = isRedisReady() ? getRedisClient() : null;
  const lockKey = `dzhoof:device-lock:${userId}`;
  const lockToken = crypto.randomBytes(16).toString('hex');
  const startedAt = Date.now();
  let redisLocked = false;

  try {
    if (redis) {
      while (Date.now() - startedAt < DEVICE_LOCK_WAIT_MS) {
        const acquired = await redis.set(lockKey, lockToken, 'PX', DEVICE_LOCK_TTL_MS, 'NX');
        if (acquired === 'OK') {
          redisLocked = true;
          break;
        }
        await sleep(100);
      }
      if (!redisLocked) {
        const error = new Error('Device registration is busy; retry shortly');
        (error as any).code = 'DEVICE_REGISTRATION_BUSY';
        throw error;
      }
    }
    return await task();
  } finally {
    if (redis && redisLocked) {
      await redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          lockKey,
          lockToken,
        )
        .catch(() => undefined);
    }
    releaseLocal();
    if (localDeviceLocks.get(userId) === chain) localDeviceLocks.delete(userId);
  }
}

export type RedeemResult =
  | {
      success: true;
      subscription: any;
      plan: any;
      devicesUsed: number;
      maxDevices: number;
    }
  | {
      success: false;
      error: string;
      code?: string;
    };

export interface DeviceInfo {
  deviceId: string;
  name?: string;
  platform?: string;
  appVersion?: string;
  pushToken?: string;
}

/**
 * Core redemption flow (per DZ HOOF master spec):
 * Code exists → unused? → plan active? → user valid? → device allowed?
 * → create/extend subscription → mark code activated.
 *
 * A user who already holds an ACTIVE subscription gets its expiry extended
 * instead of creating a conflicting row.
 */
export async function redeemCode(
  userId: string,
  rawCode: string,
  deviceInfo?: DeviceInfo,
  ip?: string,
): Promise<RedeemResult> {
  const normalized = normalizeActivationCode(rawCode);
  if (normalized.length < 8) {
    return { success: false, error: 'Invalid code', code: 'INVALID_CODE' };
  }

  const codeHash = hashActivationCode(normalized);

  /**
   * Atomic claim: flip UNUSED → ACTIVATING in one update so two concurrent
   * redeems of the same code can never both mint a subscription. The winner
   * proceeds; the loser falls through to the status checks below and gets a
   * clean error. A crash mid-flight leaves the code ACTIVATING; the daily
   * expiry task resets stale ACTIVATING rows back to UNUSED.
   */
  const code = await ActivationCode.findOneAndUpdate(
    { codeHash, status: 'UNUSED' },
    { $set: { status: 'ACTIVATING' } },
    { new: true },
  ).exec();

  const now = new Date();

  if (!code) {
    // Someone else owns this code now (or it never existed). Read it to give
    // the caller the right error instead of a generic one.
    const existing = await ActivationCode.findOne({ codeHash }).exec();
    if (!existing) {
      await recordRedemption(null, userId, deviceInfo?.deviceId, null, ip, 'FAILURE', 'INVALID_CODE');
      return { success: false, error: 'Invalid code', code: 'INVALID_CODE' };
    }
    if (existing.status === 'REVOKED') {
      await recordRedemption(existing, userId, deviceInfo?.deviceId, null, ip, 'FAILURE', 'CODE_REVOKED');
      return { success: false, error: 'This code has been revoked', code: 'CODE_REVOKED' };
    }
    if (existing.status === 'ACTIVATED' || existing.status === 'ACTIVATING') {
      await recordRedemption(existing, userId, deviceInfo?.deviceId, null, ip, 'FAILURE', 'CODE_ALREADY_USED');
      return {
        success: false,
        error: existing.status === 'ACTIVATING' ? 'This code is being activated' : 'This code has already been used',
        code: 'CODE_ALREADY_USED',
      };
    }
    if (existing.codeExpiresAt && existing.codeExpiresAt < now) {
      await recordRedemption(existing, userId, deviceInfo?.deviceId, null, ip, 'FAILURE', 'CODE_EXPIRED');
      return { success: false, error: 'This code has expired', code: 'CODE_EXPIRED' };
    }
    // UNUSED here is a lost race after a concurrent expiry — treat as used.
    await recordRedemption(existing, userId, deviceInfo?.deviceId, null, ip, 'FAILURE', 'CODE_ALREADY_USED');
    return { success: false, error: 'This code has already been used', code: 'CODE_ALREADY_USED' };
  }

  if (code.codeExpiresAt && code.codeExpiresAt < now) {
    code.status = 'EXPIRED';
    await code.save();
    await recordRedemption(code, userId, deviceInfo?.deviceId, null, ip, 'FAILURE', 'CODE_EXPIRED');
    return { success: false, error: 'This code has expired', code: 'CODE_EXPIRED' };
  }

  const plan = await Plan.findById(code.planId).lean().exec();
  if (!plan || plan.status !== 'Active') {
    // Release the claim — the code stays usable for a later redemption.
    await code.updateOne({ $set: { status: 'UNUSED' } }).exec();
    await recordRedemption(code, userId, deviceInfo?.deviceId, null, ip, 'FAILURE', 'PLAN_UNAVAILABLE');
    return { success: false, error: 'This subscription plan is no longer available', code: 'PLAN_UNAVAILABLE' };
  }

  try {
    // Register the device (respecting the plan's device cap) — only when the
    // client supplied one. Registration never blocks an extension redemption.
    if (deviceInfo?.deviceId) {
      const registered = await registerDevice(userId, deviceInfo, plan.maxDevices);
      if (!registered.ok) {
        await code.updateOne({ $set: { status: 'UNUSED' } }).exec();
        await recordRedemption(code, userId, deviceInfo.deviceId, null, ip, 'FAILURE', registered.error);
        return { success: false, error: registered.message, code: registered.error };
      }
    }

    // Create or extend the active subscription. An already-expired row is
    // treated as new: the new duration starts from now, not the stale expiry.
    let subscription = await Subscription.findOne({ userId, status: 'ACTIVE' }).exec();

    if (subscription) {
      const base = subscription.expiresAt.getTime() > now.getTime() ? subscription.expiresAt : now;
      const durationDays = code.customDurationDays || plan.durationDays;
      const extendedUntil = new Date(base.getTime() + durationDays * DAY_MS);
      subscription.expiresAt = extendedUntil;
      subscription.startsAt = now;
      subscription.planId = plan._id;
      subscription.activationCodeId = code._id;
      await subscription.save();
    } else {
      subscription = await Subscription.create({
        userId,
        planId: plan._id,
        activationCodeId: code._id,
        status: 'ACTIVE',
        startsAt: now,
        expiresAt: new Date(now.getTime() + (code.customDurationDays || plan.durationDays) * DAY_MS),
      });
    }

    code.status = 'ACTIVATED';
    code.activatedAt = now;
    code.activatedBy = new mongoose.Types.ObjectId(userId);
    await code.save();

    await recordRedemption(code, userId, deviceInfo?.deviceId, subscription._id, ip, 'SUCCESS');

    const devicesUsed = await Device.countDocuments({ userId }).exec();
    return {
      success: true,
      subscription,
      plan,
      devicesUsed,
      maxDevices: plan.maxDevices,
    };
  } catch (err) {
    // Any failure after the claim must not burn a paid code — hand it back to
    // the pool so the customer can retry.
    await code
      .updateOne({ _id: code._id, status: 'ACTIVATING' }, { $set: { status: 'UNUSED' } })
      .catch((restoreErr) => console.error('[redeemCode] failed to restore claimed code:', restoreErr));
    throw err;
  }
}

/** Current active subscription with its plan, plus device usage. */
export async function getUserSubscription(userId: string) {
  const subscription = await Subscription.findOne({
    userId,
    status: { $in: ['ACTIVE', 'EXPIRED'] },
  })
    .sort({ expiresAt: -1 })
    .lean()
    .exec();
  if (!subscription) {
    const devicesUsed = await Device.countDocuments({ userId }).exec();
    return { subscription: null, plan: null, devicesUsed, maxDevices: 0, devices: [] };
  }

  const [plan, devices] = await Promise.all([
    Plan.findById(subscription.planId).lean().exec(),
    Device.find({ userId }).sort({ createdAt: 1 }).lean().exec(),
  ]);
  const isExpired = subscription.status !== 'ACTIVE' || subscription.expiresAt.getTime() <= Date.now();
  const visibleSubscription = isExpired
    ? { ...subscription, status: 'EXPIRED' as const }
    : subscription;

  return {
    subscription: visibleSubscription,
    plan,
    devicesUsed: devices.length,
    maxDevices: plan?.maxDevices ?? 0,
    devices,
  };
}

/**
 * Register (or touch) a device for a user. Enforces the device cap from the
 * user's ACTIVE subscription — the subscription is what grants device slots.
 */
export async function registerDevice(userId: string, info: DeviceInfo, maxDevices?: number) {
  const { deviceId, name, platform, appVersion, pushToken } = info;
  const normalizedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!normalizedDeviceId || normalizedDeviceId.length > 200) {
    return { ok: false as const, error: 'DEVICE_ID_REQUIRED', message: 'deviceId must be a non-empty string up to 200 characters' };
  }

  return withDeviceLock(userId, async () => {
    const existing = await Device.findOne({ userId, deviceId: normalizedDeviceId }).exec();
    if (existing) {
      existing.name = name || existing.name;
      existing.platform = platform || existing.platform;
      existing.appVersion = appVersion || existing.appVersion;
      if (pushToken) existing.pushToken = pushToken.trim().slice(0, 4096);
      existing.lastSeenAt = new Date();
      await existing.save();
      return { ok: true as const, device: existing };
    }

    let limit = maxDevices;
    if (limit == null) {
      const subscription = await Subscription.findOne({ userId, status: 'ACTIVE' }).lean().exec();
      const plan = subscription ? await Plan.findById(subscription.planId).lean().exec() : null;
      limit = plan?.maxDevices ?? 0;
    }

    const devicesUsed = await Device.countDocuments({ userId }).exec();
    if (limit > 0 && devicesUsed >= limit) {
      return {
        ok: false as const,
        error: 'DEVICE_LIMIT_REACHED',
        message: 'Device limit reached for your subscription',
        devicesUsed,
        maxDevices: limit,
      };
    }

    try {
      const device = await Device.create({
        userId,
        deviceId: normalizedDeviceId,
        name: name || '',
        platform: platform || '',
        appVersion: appVersion || '',
        pushToken: pushToken ? pushToken.trim().slice(0, 4096) : '',
        lastSeenAt: new Date(),
      });
      return { ok: true as const, device };
    } catch (error: any) {
      // A second API replica may have won the unique (userId, deviceId) race.
      if (error?.code === 11000) {
        const duplicate = await Device.findOne({ userId, deviceId: normalizedDeviceId }).exec();
        if (duplicate) return { ok: true as const, device: duplicate };
      }
      throw error;
    }
  });
}

/**
 * Generate a batch of codes. Plaintext codes are returned in the response,
 * and an AES-256-GCM encrypted copy (codeEnc) is persisted alongside the
 * verification hash so admins can reveal codes later from the dashboard.
 */
export async function generateCodes(opts: {
  planId: string;
  quantity: number;
  prefix?: string;
  codeExpiresInDays?: number | null;
  createdBy?: string | null;
  resellerId?: string | null;
  batchId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customDurationDays?: number | null;
}) {
  const plan = await Plan.findById(opts.planId).exec();
  if (!plan) {
    return { ok: false as const, error: 'Plan not found' };
  }

  const quantity = Math.min(Math.max(Math.floor(opts.quantity), 1), 10000);
  const prefix = (opts.prefix || 'DZHF').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'DZHF';
  const codeExpiresAt = opts.codeExpiresInDays
    ? new Date(Date.now() + opts.codeExpiresInDays * DAY_MS)
    : null;
  const resellerId = opts.resellerId ? new mongoose.Types.ObjectId(opts.resellerId) : null;
  const batchId = opts.batchId ? new mongoose.Types.ObjectId(opts.batchId) : null;
  const customDurationDays =
    Number.isInteger(opts.customDurationDays) && opts.customDurationDays! > 0
      ? Math.min(Math.floor(opts.customDurationDays!), 3650)
      : null;

  const plainCodes: string[] = [];
  const docs = [];
  const seen = new Set<string>();

  while (docs.length < quantity) {
    const code = generateActivationCode(prefix);
    // Hash the NORMALIZED form (no dashes) — redeemCode hashes the same way.
    const hash = hashActivationCode(normalizeActivationCode(code));
    if (seen.has(hash)) continue;
    seen.add(hash);
    plainCodes.push(code);
    docs.push({
      codeHash: hash,
      codeLast4: codeLast4(code),
      prefix,
      codeEnc: encryptSecret(code),
      planId: plan._id,
      status: 'UNUSED',
      codeExpiresAt,
      customerName: opts.customerName ? String(opts.customerName).trim().slice(0, 100) : null,
      customerPhone: opts.customerPhone ? String(opts.customerPhone).trim().slice(0, 30) : null,
      customDurationDays,
      createdBy: opts.createdBy ? new mongoose.Types.ObjectId(opts.createdBy) : null,
      resellerId,
      batchId,
    });
  }

  await ActivationCode.insertMany(docs);

  return {
    ok: true as const,
    count: docs.length,
    plan: { _id: plan._id, name: plan.name },
    codes: plainCodes,
  };
}

/** Revoke an unused code. */
export async function revokeCode(codeId: string) {
  const code = await ActivationCode.findById(codeId).exec();
  if (!code) {
    return { ok: false as const, error: 'Code not found' };
  }
  if (code.status === 'ACTIVATED') {
    return { ok: false as const, error: 'Cannot revoke an activated code' };
  }
  code.status = 'REVOKED';
  await code.save();
  return { ok: true as const, code };
}

/** Auto-expire codes whose codeExpiresAt passed (admin list shows current status). */
export async function expireStaleCodes(): Promise<number> {
  const res = await ActivationCode.updateMany(
    { status: 'UNUSED', codeExpiresAt: { $lt: new Date() } },
    { $set: { status: 'EXPIRED' } },
  ).exec();
  return res.modifiedCount;
}

/* ------------------------------------------------------------------ */
/*  Reseller credit: ledger, manual return, auto-expiry with return.   */
/* ------------------------------------------------------------------ */

/** Code expiry window (days) for reseller-generated codes — admin-configurable. */
export async function getCodeExpiryDays(): Promise<number> {
  const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
  const doc = await AppSetting.findOne({ key: 'code_expiry_days' }).lean().exec();
  const raw = doc ? Number(doc.value) : Number(process.env.CODE_EXPIRY_DAYS || 30);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
}

/** One credit ledger row. balanceAfter is the reseller's remaining credit for that plan after the tx. */
export async function recordCreditTx(opts: {
  resellerId: string;
  planId: string;
  type: 'GRANT' | 'CONSUME' | 'RETURN' | 'EXPIRE_RETURN';
  quantity: number;
  balanceAfter: number;
  note?: string;
  createdBy?: string | null;
  /** Wholesale unit price at transaction time — purchase value = quantity × unitPrice */
  unitPrice?: number;
}): Promise<void> {
  const unitPrice = Math.max(Number(opts.unitPrice) || 0, 0);
  try {
    await CreditTransaction.create({
      resellerId: new mongoose.Types.ObjectId(opts.resellerId),
      planId: new mongoose.Types.ObjectId(opts.planId),
      type: opts.type,
      quantity: opts.quantity,
      balanceAfter: Math.max(opts.balanceAfter, 0),
      unitPrice,
      amount: Math.abs(opts.quantity) * unitPrice,
      note: opts.note || '',
      createdBy: opts.createdBy ? new mongoose.Types.ObjectId(opts.createdBy) : null,
    });
  } catch (err) {
    console.error('[credit] recordCreditTx error:', (err as Error).message);
  }
}

/** Increment (or create) a reseller's credit for a plan and record a GRANT ledger row. */
export async function addResellerCredit(
  resellerId: string,
  planId: string,
  delta: number,
  note?: string,
  createdBy?: string | null,
): Promise<void> {
  if (!delta) return;
  const updated = await Reseller.findOneAndUpdate(
    { _id: resellerId, 'credit.planId': planId },
    { $inc: { 'credit.$.quantity': delta } },
    { new: true },
  )
    .select('credit')
    .lean()
    .exec();
  let balanceAfter: number;
  if (updated) {
    balanceAfter = (updated.credit || []).find((c) => String(c.planId) === planId)?.quantity || 0;
  } else {
    const qty = Math.max(delta, 0);
    await Reseller.updateOne({ _id: resellerId }, { $push: { credit: { planId: new mongoose.Types.ObjectId(planId), quantity: qty } } }).exec();
    balanceAfter = qty;
  }
  await recordCreditTx({ resellerId, planId, type: 'GRANT', quantity: delta, balanceAfter, note: note || '', createdBy });
}

/**
 * Reclaim credit for a reseller's UNUSED codes: mark them REVOKED and restore
 * the credit per plan (ledger type RETURN). If batchId is given, only that
 * batch's unused codes are reclaimed; otherwise all unused codes of the reseller
 * (optionally filtered by planId).
 */
export async function returnUnusedCreditForReseller(
  resellerId: string,
  opts: { batchId?: string; planId?: string; note?: string; createdBy?: string | null } = {},
): Promise<{ ok: boolean; revoked: number; restored: Array<{ planId: string; quantity: number }>; error?: string }> {
  const filter: Record<string, unknown> = { resellerId: new mongoose.Types.ObjectId(resellerId), status: 'UNUSED' };
  if (opts.batchId) {
    if (!mongoose.isValidObjectId(opts.batchId)) return { ok: false, revoked: 0, restored: [], error: 'Invalid batch id' };
    filter.batchId = new mongoose.Types.ObjectId(opts.batchId);
  }
  if (opts.planId) {
    if (!mongoose.isValidObjectId(opts.planId)) return { ok: false, revoked: 0, restored: [], error: 'Invalid plan id' };
    filter.planId = new mongoose.Types.ObjectId(opts.planId);
  }

  const codes = await ActivationCode.find(filter).select('planId').lean().exec();
  if (codes.length === 0) return { ok: true, revoked: 0, restored: [] };

  const ids = codes.map((c) => c._id);

  // Guarded write: only flip codes that are STILL unused. A code activated
  // between the read above and this write must not be revoked, and its credit
  // must not be restored to the reseller (that would double-pay the operator).
  await ActivationCode.updateMany(
    { _id: { $in: ids }, status: 'UNUSED' },
    { $set: { status: 'REVOKED' } },
  ).exec();

  // Count and plan-breakdown from the codes that were ACTUALLY revoked —
  // never from the pre-read snapshot.
  const revokedDocs = await ActivationCode.find({ _id: { $in: ids }, status: 'REVOKED' })
    .select('planId')
    .lean()
    .exec();
  if (revokedDocs.length === 0) return { ok: true, revoked: 0, restored: [] };

  const byPlan = new Map<string, number>();
  for (const c of revokedDocs) {
    const key = String(c.planId);
    byPlan.set(key, (byPlan.get(key) || 0) + 1);
  }

  const restored: Array<{ planId: string; quantity: number }> = [];
  for (const [planId, qty] of byPlan) {
    const updated = await Reseller.findOneAndUpdate(
      { _id: resellerId, 'credit.planId': planId },
      { $inc: { 'credit.$.quantity': qty } },
      { new: true },
    )
      .select('credit')
      .lean()
      .exec();
    let balanceAfter: number;
    if (updated) {
      balanceAfter = (updated.credit || []).find((c) => String(c.planId) === planId)?.quantity || 0;
    } else {
      await Reseller.updateOne({ _id: resellerId }, { $push: { credit: { planId: new mongoose.Types.ObjectId(planId), quantity: qty } } }).exec();
      balanceAfter = qty;
    }
    await recordCreditTx({
      resellerId,
      planId,
      type: 'RETURN',
      quantity: qty,
      balanceAfter,
      note: opts.note || `استرجاع ${qty} كود غير مستخدم`,
      createdBy: opts.createdBy,
    });
    restored.push({ planId, quantity: qty });
  }
  return { ok: true, revoked: revokedDocs.length, restored };
}

/**
 * Scheduled daily: expire UNUSED codes past codeExpiresAt and return the credit
 * to their resellers (ledger type EXPIRE_RETURN). Admin-generated codes without
 * a reseller are simply marked EXPIRED (no credit involved).
 */
export async function expireStaleCodesAndReturnCredit(): Promise<{
  expired: number;
  creditReturned: Array<{ resellerId: string; planId: string; quantity: number }>;
}> {
  const now = new Date();

  // Recover codes stuck in ACTIVATING (a process died mid-claim): hand them
  // back to the pool so they can be redeemed normally.
  await ActivationCode.updateMany(
    { status: 'ACTIVATING', updatedAt: { $lt: new Date(now.getTime() - 15 * 60 * 1000) } },
    { $set: { status: 'UNUSED' } },
  ).exec();

  const stale = await ActivationCode.find({ status: 'UNUSED', codeExpiresAt: { $lt: now } })
    .select('planId resellerId')
    .lean()
    .exec();
  if (stale.length === 0) return { expired: 0, creditReturned: [] };

  const ids = stale.map((c) => c._id);

  // Guarded write: only expire codes that are STILL unused. A code activated
  // between the read above and this write must not be expired, and its credit
  // must not be returned to the reseller.
  await ActivationCode.updateMany(
    { _id: { $in: ids }, status: 'UNUSED' },
    { $set: { status: 'EXPIRED' } },
  ).exec();

  // Plan/reseller breakdown from the codes that were ACTUALLY expired.
  const expiredDocs = await ActivationCode.find({ _id: { $in: ids }, status: 'EXPIRED' })
    .select('planId resellerId')
    .lean()
    .exec();

  const creditReturned: Array<{ resellerId: string; planId: string; quantity: number }> = [];
  const byResellerPlan = new Map<string, Map<string, number>>();
  for (const c of expiredDocs) {
    if (!c.resellerId) continue;
    const rk = String(c.resellerId);
    const pk = String(c.planId);
    if (!byResellerPlan.has(rk)) byResellerPlan.set(rk, new Map());
    const m = byResellerPlan.get(rk)!;
    m.set(pk, (m.get(pk) || 0) + 1);
  }

  for (const [rid, plans] of byResellerPlan) {
    for (const [planId, qty] of plans) {
      const updated = await Reseller.findOneAndUpdate(
        { _id: rid, 'credit.planId': planId },
        { $inc: { 'credit.$.quantity': qty } },
        { new: true },
      )
        .select('credit')
        .lean()
        .exec();
      let balanceAfter: number;
      if (updated) {
        balanceAfter = (updated.credit || []).find((c) => String(c.planId) === planId)?.quantity || 0;
      } else {
        await Reseller.updateOne({ _id: rid }, { $push: { credit: { planId: new mongoose.Types.ObjectId(planId), quantity: qty } } }).exec();
        balanceAfter = qty;
      }
      await recordCreditTx({
        resellerId: rid,
        planId,
        type: 'EXPIRE_RETURN',
        quantity: qty,
        balanceAfter,
        note: `انتهت صلاحية ${qty} كود غير مستخدم`,
      });
      creditReturned.push({ resellerId: rid, planId, quantity: qty });
    }
  }

  return { expired: expiredDocs.length, creditReturned };
}

/** Whether the platform currently gates playback behind an active subscription. */
export async function isSubscriptionRequired(): Promise<boolean> {
  const envValue = process.env.SUBSCRIPTION_REQUIRED?.trim().toLowerCase();
  if (envValue === 'true' || envValue === 'false') {
    return envValue === 'true';
  }

  const AppSetting = require('../models/AppSetting').default || require('../models/AppSetting');
  const doc = await AppSetting.findOne({ key: 'subscription_required' }).lean().exec();
  return doc ? !!doc.value : false;
}

/** Active subscription for a user (not expired), or null. */
export async function getActiveSubscription(userId: string) {
  return Subscription.findOne({
    userId,
    status: 'ACTIVE',
    expiresAt: { $gt: new Date() },
  })
    .lean()
    .exec();
}

async function recordRedemption(
  code: any,
  userId: string,
  deviceId: string | undefined,
  subscriptionId: any,
  ip: string | undefined,
  result: 'SUCCESS' | 'FAILURE',
  failureReason?: string,
) {
  try {
    await ActivationRedemption.create({
      activationCodeId: code?._id ?? null,
      userId: new mongoose.Types.ObjectId(userId),
      deviceId: deviceId || null,
      subscriptionId: subscriptionId || null,
      ipHash: hashIp(ip),
      result,
      failureReason: failureReason || null,
    });
  } catch (err) {
    console.error('[subscription] Failed to record redemption:', (err as Error).message);
  }
}

module.exports = {
  redeemCode,
  getUserSubscription,
  registerDevice,
  generateCodes,
  revokeCode,
  expireStaleCodes,
  expireStaleCodesAndReturnCredit,
  getCodeExpiryDays,
  recordCreditTx,
  addResellerCredit,
  returnUnusedCreditForReseller,
  isSubscriptionRequired,
  getActiveSubscription,
};
