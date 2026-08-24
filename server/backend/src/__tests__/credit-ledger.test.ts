import mongoose from 'mongoose';
import Plan from '../models/Plan';
import Reseller from '../models/Reseller';
import ActivationCode from '../models/ActivationCode';
import CreditTransaction from '../models/CreditTransaction';
import AppSetting from '../models/AppSetting';
import {
  getCodeExpiryDays,
  recordCreditTx,
  addResellerCredit,
  returnUnusedCreditForReseller,
  expireStaleCodesAndReturnCredit,
  generateCodes,
} from '../services/subscription-service';

async function makePlan(days = 30) {
  return Plan.create({ name: 'شهري', durationDays: days, maxDevices: 1, maxConcurrentStreams: 1, price: 1000, currency: 'DZD', status: 'Active' });
}

async function makeReseller(planId: mongoose.Types.ObjectId, creditQty: number) {
  return Reseller.create({
    name: 'محل الاختبار',
    city: 'الجزائر',
    status: 'Active',
    credit: [{ planId, quantity: creditQty }],
  });
}

async function creditOf(resellerId: string, planId: mongoose.Types.ObjectId): Promise<number> {
  const r = await Reseller.findById(resellerId).lean().exec();
  return r?.credit?.find((c) => String(c.planId) === String(planId))?.quantity || 0;
}

describe('Reseller credit ledger (سجل حركات الرصيد)', () => {
  it('records GRANT with balanceAfter', async () => {
    const plan = await makePlan();
    const reseller = await makeReseller(plan._id, 10);

    await recordCreditTx({ resellerId: String(reseller._id), planId: String(plan._id), type: 'GRANT', quantity: 10, balanceAfter: 10, note: 'منح' });

    const rows = await CreditTransaction.find({ resellerId: reseller._id }).lean().exec();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('GRANT');
    expect(rows[0].quantity).toBe(10);
    expect(rows[0].balanceAfter).toBe(10);
  });

  it('addResellerCredit increments and creates the entry when missing', async () => {
    const plan = await makePlan();
    const reseller = await makeReseller(plan._id, 5);

    await addResellerCredit(String(reseller._id), String(plan._id), 3, 'منح إضافي');

    expect(await creditOf(String(reseller._id), plan._id)).toBe(8);
    const rows = await CreditTransaction.find({ resellerId: reseller._id }).lean().exec();
    expect(rows[0].type).toBe('GRANT');
    expect(rows[0].quantity).toBe(3);
    expect(rows[0].balanceAfter).toBe(8);
  });

  it('getCodeExpiryDays defaults to 30 and honors AppSetting', async () => {
    expect(await getCodeExpiryDays()).toBe(30);

    await AppSetting.create({ key: 'code_expiry_days', value: 14 });
    expect(await getCodeExpiryDays()).toBe(14);
  });
});

describe('Manual credit reclaim (استرجاع الرصيد)', () => {
  it('revokes unused codes, restores credit, records RETURN', async () => {
    const plan = await makePlan();
    const reseller = await makeReseller(plan._id, 5);

    // Service-level generateCodes does NOT deduct credit (the route does it).
    // Simulate the route's deduction to keep the ledger flow realistic.
    const gen = await generateCodes({ planId: String(plan._id), quantity: 2, codeExpiresInDays: 30, resellerId: String(reseller._id) });
    expect(gen.ok).toBe(true);
    await Reseller.updateOne({ _id: reseller._id, 'credit.planId': plan._id }, { $inc: { 'credit.$.quantity': -2 } }).exec();
    await recordCreditTx({ resellerId: String(reseller._id), planId: String(plan._id), type: 'CONSUME', quantity: -2, balanceAfter: 3, note: 'توليد' });
    expect(await creditOf(String(reseller._id), plan._id)).toBe(3);

    const result = await returnUnusedCreditForReseller(String(reseller._id), {});
    expect(result.ok).toBe(true);
    expect(result.revoked).toBe(2);
    expect(result.restored[0].quantity).toBe(2);

    expect(await creditOf(String(reseller._id), plan._id)).toBe(5);
    const remaining = await ActivationCode.countDocuments({ resellerId: reseller._id, status: 'UNUSED' });
    expect(remaining).toBe(0);
    const revoked = await ActivationCode.countDocuments({ resellerId: reseller._id, status: 'REVOKED' });
    expect(revoked).toBe(2);

    const rows = await CreditTransaction.find({ resellerId: reseller._id }).sort({ createdAt: 1 }).lean().exec();
    expect(rows.map((r) => r.type)).toEqual(['CONSUME', 'RETURN']);
    expect(rows[1].quantity).toBe(2);
    expect(rows[1].balanceAfter).toBe(5);
  });

  it('returns ok with zero when nothing to reclaim', async () => {
    const plan = await makePlan();
    const reseller = await makeReseller(plan._id, 2);
    const result = await returnUnusedCreditForReseller(String(reseller._id), {});
    expect(result.ok).toBe(true);
    expect(result.revoked).toBe(0);
    expect(result.restored).toHaveLength(0);
  });
});

describe('Auto expiry with credit return (انتهاء الصلاحية)', () => {
  it('expires stale codes and returns credit as EXPIRE_RETURN', async () => {
    const plan = await makePlan();
    const reseller = await makeReseller(plan._id, 4);

    // Two codes expiring in the past (already stale), one far in the future.
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 86400000);
    await ActivationCode.create([
      { prefix: 'DZHF', codeHash: 'e1', codeLast4: 'AAAA', planId: plan._id, status: 'UNUSED', codeExpiresAt: past, resellerId: reseller._id },
      { prefix: 'DZHF', codeHash: 'e2', codeLast4: 'BBBB', planId: plan._id, status: 'UNUSED', codeExpiresAt: past, resellerId: reseller._id },
      { prefix: 'DZHF', codeHash: 'e3', codeLast4: 'CCCC', planId: plan._id, status: 'UNUSED', codeExpiresAt: future, resellerId: reseller._id },
    ]);

    const result = await expireStaleCodesAndReturnCredit();
    expect(result.expired).toBe(2);
    expect(result.creditReturned).toHaveLength(1);
    expect(result.creditReturned[0].quantity).toBe(2);

    expect(await creditOf(String(reseller._id), plan._id)).toBe(6);
    const expiredCount = await ActivationCode.countDocuments({ resellerId: reseller._id, status: 'EXPIRED' });
    expect(expiredCount).toBe(2);

    const rows = await CreditTransaction.find({ resellerId: reseller._id }).lean().exec();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('EXPIRE_RETURN');
    expect(rows[0].quantity).toBe(2);
    expect(rows[0].balanceAfter).toBe(6);
  });

  it('does nothing when there are no stale codes', async () => {
    const result = await expireStaleCodesAndReturnCredit();
    expect(result.expired).toBe(0);
    expect(result.creditReturned).toHaveLength(0);
  });
});

describe('Round 9: reseller prefix & purchase amounts', () => {
  it('Reseller model stores and validates a unique uppercase prefix', async () => {
    const plan = await makePlan();
    const r1 = await Reseller.create({ name: 'محل 1', city: 'وهران', status: 'Active', prefix: 'oran1', credit: [{ planId: plan._id, quantity: 1 }] });
    expect(r1.prefix).toBe('ORAN1'); // stored uppercase

    await expect(
      Reseller.create({ name: 'محل 2', city: 'قسنطينة', status: 'Active', prefix: 'ORAN1' }),
    ).rejects.toThrow(); // duplicate prefix rejected

    await expect(
      Reseller.create({ name: 'محل 3', city: 'عنابة', status: 'Active', prefix: 'A' }),
    ).rejects.toThrow(); // too short
  });

  it('generateCodes uses the provided prefix for codes', async () => {
    const plan = await makePlan();
    const reseller = await Reseller.create({ name: 'محل 4', city: 'تلمسان', status: 'Active', prefix: 'TLM5' });
    const gen = await generateCodes({ planId: String(plan._id), quantity: 2, prefix: 'TLM5', resellerId: String(reseller._id) });
    expect(gen.ok).toBe(true);
    if (gen.ok) {
      for (const code of gen.codes) expect(code.startsWith('TLM5')).toBe(true);
    }
    const stored = await ActivationCode.find({ resellerId: reseller._id }).lean().exec();
    expect(stored.every((c) => c.prefix === 'TLM5')).toBe(true);
  });

  it('recordCreditTx stores unitPrice and purchase amount for GRANT rows', async () => {
    const plan = await makePlan();
    const reseller = await makeReseller(plan._id, 0);
    await recordCreditTx({
      resellerId: String(reseller._id),
      planId: String(plan._id),
      type: 'GRANT',
      quantity: 10,
      balanceAfter: 10,
      unitPrice: 800,
      note: 'شراء رصيد',
    });
    const row = await CreditTransaction.findOne({ resellerId: reseller._id }).lean().exec();
    expect(row?.unitPrice).toBe(800);
    expect(row?.amount).toBe(8000); // 10 × 800
  });
});
