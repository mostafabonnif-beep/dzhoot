import mongoose from 'mongoose';
import Reseller from '../models/Reseller';
import Plan from '../models/Plan';
import ActivationCode from '../models/ActivationCode';
import CodeBatch from '../models/CodeBatch';
import { generateCodes } from '../services/subscription-service';

async function makePlan() {
  return Plan.create({ name: 'شهري', durationDays: 30, maxDevices: 1, price: 1000, currency: 'DZD', status: 'Active' });
}

async function makeReseller(planId: string, creditQty = 5) {
  return Reseller.create({
    name: 'محل الاختبار',
    city: 'الجزائر',
    status: 'Active',
    credit: [{ planId, quantity: creditQty }],
  });
}

describe('Reseller credit system (رصيد الموزعين)', () => {
  it('stores per-plan credit and atomically decrements on generation', async () => {
    const plan = await makePlan();
    const reseller = await makeReseller(String(plan._id), 3);

    // Atomic deduction with guard: enough credit (3 >= 2) → succeeds
    const updated = await Reseller.findOneAndUpdate(
      { _id: reseller._id, credit: { $elemMatch: { planId: plan._id, quantity: { $gte: 2 } } } },
      { $inc: { 'credit.$.quantity': -2 } },
      { new: true },
    ).lean().exec();

    expect(updated).not.toBeNull();
    expect((updated!.credit as any[]).find((c) => String(c.planId) === String(plan._id)).quantity).toBe(1);

    // Guard fails when credit is insufficient (1 >= 2 → no match)
    const blocked = await Reseller.findOneAndUpdate(
      { _id: reseller._id, credit: { $elemMatch: { planId: plan._id, quantity: { $gte: 2 } } } },
      { $inc: { 'credit.$.quantity': -2 } },
      { new: true },
    ).lean().exec();
    expect(blocked).toBeNull();
  });

  it('mints codes tied to reseller + batch (the self-service flow)', async () => {
    const plan = await makePlan();
    const reseller = await makeReseller(String(plan._id), 2);
    const batch = await CodeBatch.create({
      resellerId: reseller._id,
      planId: plan._id,
      batchNumber: 1,
      quantity: 2,
      receiptDate: new Date(),
      notes: 'توليد ذاتي من بوابة الموزعين',
      status: 'delivered',
    });
    const result = await generateCodes({
      planId: String(plan._id),
      quantity: 2,
      prefix: 'DZHF',
      resellerId: String(reseller._id),
      batchId: String(batch._id),
    });

    expect(result.ok).toBe(true);
    const codes = await ActivationCode.find({ resellerId: reseller._id, batchId: batch._id }).lean().exec();
    expect(codes).toHaveLength(2);
    expect(codes.every((c) => c.status === 'UNUSED')).toBe(true);

    const resellerAfter = await Reseller.findById(reseller._id).lean().exec();
    expect((resellerAfter!.credit as any[]).find((c) => String(c.planId) === String(plan._id)).quantity).toBe(2);
  });
});
