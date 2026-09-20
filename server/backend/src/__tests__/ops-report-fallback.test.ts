/**
 * The daily operations report must not be lost when the email channel cannot deliver.
 *
 * Production ran with empty Brevo credentials, so `sendEmail` returned `skipped: true`
 * for every recipient and the job failed — every day, silently, with no other channel
 * involved. Telegram was configured and working the whole time.
 *
 * These tests pin the fallback: email stays the primary channel, and the operational
 * channels (Telegram/webhook) carry the report only when email reaches nobody. `ok`
 * reflects "the report arrived somewhere", while `delivered` keeps meaning "the SMTP
 * path accepted this many recipients".
 *
 * The model modules are NOT jest.mock'd: replacing them erases the types the service
 * is written against (mongoose's own return types), so only the methods used here are
 * replaced with jest fakes on the real model objects.
 */

const mockSendEmail = jest.fn();
const mockSendOperationalAlert = jest.fn();

jest.mock('../services/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

jest.mock('../services/alert-notifier', () => ({
  sendOperationalAlert: (...args: unknown[]) => mockSendOperationalAlert(...args),
}));

import User from '../models/User';
import ActivationCode from '../models/ActivationCode';
import Subscription from '../models/Subscription';
import Reseller from '../models/Reseller';
import { sendDailyOpsReport } from '../services/ops-report-service';

const lean = (value: unknown) => ({ select: () => ({ lean: async () => value }) });

/** The models are real objects (their types are what the service is written against);
 * only the methods used by the report are swapped for jest fakes. */
type Mockable = Record<string, jest.Mock>;
const mockModel = (model: unknown): Mockable => model as Mockable;

describe('sendDailyOpsReport — channel fallback', () => {
  beforeEach(() => {
    mockSendEmail.mockReset();
    mockSendOperationalAlert.mockReset();

    const activationCode = mockModel(ActivationCode);
    activationCode.countDocuments = jest.fn().mockResolvedValue(12);
    activationCode.aggregate = jest.fn().mockResolvedValue([{ _id: 'r1', n: 5 }]);

    const user = mockModel(User);
    user.countDocuments = jest.fn().mockResolvedValue(7);
    user.find = jest.fn().mockReturnValue(lean([{ email: 'admin1@example.com' }, { email: 'admin2@example.com' }]));

    mockModel(Subscription).countDocuments = jest.fn().mockResolvedValue(431);
    mockModel(Reseller).find = jest.fn().mockReturnValue(lean([{ _id: 'r1', name: 'محل وهران', city: 'وهران' }]));
  });

  it('delivers through the alert channels when the email channel reaches nobody', async () => {
    mockSendEmail.mockResolvedValue({ ok: false, skipped: true });
    mockSendOperationalAlert.mockResolvedValue(true);

    const result = await sendDailyOpsReport();

    expect(result.ok).toBe(true);
    expect(result.channel).toBe('alert-channels');
    // The SMTP path accepted nobody — that number must not be inflated by the fallback.
    expect(result.delivered).toBe(0);
    expect(result.recipients).toBe(2);

    expect(mockSendOperationalAlert).toHaveBeenCalledTimes(1);
    const payload = mockSendOperationalAlert.mock.calls[0][0];
    expect(payload.severity).toBe('warning');
    // The date is in the event key so the notifier's cooldown cannot swallow a later day.
    expect(payload.event).toMatch(/^ops-report:\d{4}-\d{2}-\d{2}$/);
    expect(payload.message).toContain('تفعيلات أمس: 12');
    expect(payload.message).toContain('مستخدمون جدد: 7');
    expect(payload.message).toContain('اشتراكات نشطة: 431');
    expect(payload.message).toContain('محل وهران');
  });

  it('uses email alone when it accepts at least one recipient', async () => {
    mockSendEmail.mockResolvedValue({ ok: true });

    const result = await sendDailyOpsReport();

    expect(result.ok).toBe(true);
    expect(result.channel).toBe('email');
    expect(result.delivered).toBe(2);
    expect(mockSendOperationalAlert).not.toHaveBeenCalled();
  });

  it('reports failure when neither channel can carry the report', async () => {
    mockSendEmail.mockResolvedValue({ ok: false, skipped: true });
    mockSendOperationalAlert.mockResolvedValue(false);

    const result = await sendDailyOpsReport();

    expect(result.ok).toBe(false);
    expect(result.delivered).toBe(0);
    expect(result.error).toContain('email channel');
  });
});
