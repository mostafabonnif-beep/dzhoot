/**
 * The daily report must answer "is the catalog worth selling?" — not just "how many codes
 * were activated?".
 *
 * On 2026-09-20 the primary provider had been expired for five days and 13,409 channels
 * pointed at a source that no longer existed, while the report showed healthy activation
 * and subscription numbers. The two catalog failure modes need different fixes, so the
 * report counts them apart: `dead` (the source answers HTTP 200 with a `black.ts`
 * placeholder — renew the provider) and `orphaned` (the source row is gone — re-import or
 * delete). `visible` is the number a customer can actually open, and it must come from the
 * same visibility gate the catalog endpoints use, or the report would flatter itself.
 */
const mockSendEmail = jest.fn();
const mockSendOperationalAlert = jest.fn();

jest.mock('../services/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

jest.mock('../services/alert-notifier', () => ({
  sendOperationalAlert: (...args: unknown[]) => mockSendOperationalAlert(...args),
}));

import mongoose from 'mongoose';
import User from '../models/User';
import ActivationCode from '../models/ActivationCode';
import Subscription from '../models/Subscription';
import Reseller from '../models/Reseller';
import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';
import { sendDailyOpsReport } from '../services/ops-report-service';

const lean = (value: unknown) => ({ select: () => ({ lean: async () => value }) });
type Mockable = Record<string, jest.Mock>;
const mockModel = (model: unknown): Mockable => model as Mockable;

const verifiedSourceId = new mongoose.Types.ObjectId();
const goneSourceId = new mongoose.Types.ObjectId();

async function seedChannel(
  name: string,
  sourceId: string,
  isWorking: boolean | null
): Promise<void> {
  await Channel.collection.insertOne({
    channelId: `health-${name}`,
    channelName: name,
    channelUrl: 'http://stream.invalid/live.m3u8',
    channelGroup: 'HEALTH GROUP',
    ownerId: null,
    isActive: true,
    metadata: { source: 'xtream', xtreamSourceId: sourceId, isWorking },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('sendDailyOpsReport — catalog health block', () => {
  beforeEach(async () => {
    mockSendEmail.mockReset();
    mockSendOperationalAlert.mockReset();

    const activationCode = mockModel(ActivationCode);
    activationCode.countDocuments = jest.fn().mockResolvedValue(0);
    activationCode.aggregate = jest.fn().mockResolvedValue([]);

    const user = mockModel(User);
    user.countDocuments = jest.fn().mockResolvedValue(0);
    user.find = jest
      .fn()
      .mockReturnValue(lean([{ email: 'admin1@example.com', username: 'admin1' }]));

    mockModel(Subscription).countDocuments = jest.fn().mockResolvedValue(0);
    mockModel(Reseller).find = jest.fn().mockReturnValue(lean([]));

    await Channel.collection.deleteMany({});
    await XtreamSource.deleteMany({});
    await XtreamSource.create({
      _id: verifiedSourceId,
      name: 'current provider',
      serverUrl: 'http://source.invalid',
      usernameEncrypted: 'x',
      passwordEncrypted: 'y',
      status: 'Active',
      verificationStatus: 'verified',
    });

    // Two playable, one dead on a live source, two pointing at a source that is gone.
    await seedChannel('H ALIVE ONE', String(verifiedSourceId), true);
    await seedChannel('H ALIVE TWO', String(verifiedSourceId), true);
    await seedChannel('H DEAD', String(verifiedSourceId), false);
    await seedChannel('H ORPHAN ONE', String(goneSourceId), true);
    await seedChannel('H ORPHAN TWO', String(goneSourceId), false);

    mockSendEmail.mockResolvedValue({ ok: false, skipped: true });
    mockSendOperationalAlert.mockResolvedValue(true);
  });

  it('reports dead, orphaned and customer-visible counts in the delivered message', async () => {
    const result = await sendDailyOpsReport();
    expect(result.ok).toBe(true);

    const alert = mockSendOperationalAlert.mock.calls[0][0] as {
      message: string;
      details: Record<string, number>;
    };
    expect(alert.message).toContain('صحة الكتالوج');
    expect(alert.message).toContain('قنوات نشطة: 5');
    expect(alert.message).toContain('مرئية للعميل الآن: 2');
    // The two failure counts answer different questions and are allowed to overlap: the
    // dead orphan ('H ORPHAN TWO') is both unplayable and unrecoverable, so it is counted
    // in each — 'dead' says renew/replace, 'orphaned' says the source row is gone.
    expect(alert.message).toContain('ميتة (تُعيد شاشة سوداء): 2');
    expect(alert.message).toContain('يتيمة (مصدرها لم يعد موجودًا): 2');

    // The structured copy is what a future dashboard/alert rule would read.
    expect(alert.details.catalogActive).toBe(5);
    expect(alert.details.catalogVisible).toBe(2);
    expect(alert.details.catalogDead).toBe(2);
    expect(alert.details.catalogOrphaned).toBe(2);
  });

  it('passes the same block to the email template when a channel accepts mail', async () => {
    mockSendEmail.mockResolvedValue({ ok: true, skipped: false });

    const result = await sendDailyOpsReport();
    expect(result.ok).toBe(true);
    expect(result.channel).toBe('email');

    const variables = (mockSendEmail.mock.calls[0][0] as { variables: Record<string, string> })
      .variables;
    expect(variables.catalogHealth).toContain('يتيمة (مصدرها لم يعد موجودًا): 2');
  });
});
