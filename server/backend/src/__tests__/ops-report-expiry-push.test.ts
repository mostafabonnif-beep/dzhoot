/**
 * Expiry reminders must reach the customer's phone without email.
 *
 * The platform has no working mail channel (and, by decision, no plan to add one), so the
 * push notification is the only channel that reaches a customer who is not currently in
 * the app. These tests pin three things that matter operationally:
 *
 * 1. the push is narrowed to the subscribers whose subscription is actually expiring —
 *    `audience` alone cannot express that, and a reminder about someone else's renewal
 *    must never land on another customer's phone;
 * 2. a failed or unconfigured push never stops the in-app inbox reminder (and never fails
 *    the daily task);
 * 3. the once-per-day guard still holds, so a re-run cannot spam the same customer.
 */

const mockSendEmail = jest.fn();
const mockSendNotificationToDevices = jest.fn();

jest.mock('../services/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

jest.mock('../services/alert-notifier', () => ({
  sendOperationalAlert: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/fcm-service', () => ({
  sendNotificationToDevices: (...args: unknown[]) => mockSendNotificationToDevices(...args),
}));

const mockNotificationCreate = jest.fn();
const mockUserNotificationUpdate = jest.fn();

jest.mock('../models/Notification', () => ({
  create: (...args: unknown[]) => mockNotificationCreate(...args),
}));

jest.mock('../models/UserNotification', () => ({
  updateOne: (...args: unknown[]) => mockUserNotificationUpdate(...args),
}));

import Subscription from '../models/Subscription';
import mongoose from 'mongoose';
import User from '../models/User';
import { sendExpiryAlerts } from '../services/ops-report-service';

type Mockable = Record<string, jest.Mock>;
const mockModel = (model: unknown): Mockable => model as Mockable;

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

describe('sendExpiryAlerts — push delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockSendEmail.mockResolvedValue({ ok: false, skipped: true, error: 'ALERT_EMAIL_DISABLED' });
    mockNotificationCreate.mockResolvedValue({ _id: 'n1' });
    mockUserNotificationUpdate.mockResolvedValue({});

    const subscription = mockModel(Subscription);
    subscription.find = jest.fn().mockReturnValue({
      lean: async () => [
        { _id: 's1', userId: 'u1', expiresAt: tomorrow, status: 'ACTIVE', lastExpiryNoticeOn: '1999-01-01' },
      ],
    });
    subscription.updateOne = jest.fn().mockResolvedValue({});

    mockModel(User).find = jest.fn().mockReturnValue({
      select: () => ({ lean: async () => [{ _id: 'u1', email: 'client@example.com', username: 'client' }] }),
    });
  });

  it('pushes to that subscriber only, and reports what the devices accepted', async () => {
    mockSendNotificationToDevices.mockResolvedValue({ configured: true, attempted: 1, sent: 1, failed: 0 });

    const result = await sendExpiryAlerts(3);

    expect(result.ok).toBe(true);
    expect(result.inApp).toBe(1);
    expect(result.pushed).toBe(1);

    expect(mockSendNotificationToDevices).toHaveBeenCalledTimes(1);
    const push = mockSendNotificationToDevices.mock.calls[0][0];
    expect(push.userIds).toEqual(['u1']);
    expect(push.title).toContain('ينتهي');
    // The body must carry the real deadline, not a generic nudge.
    expect(push.body).toMatch(/اشتراكك/);
    expect(push.deepLink).toBe('/user/subscription');
  });

  it('keeps the in-app reminder when the push fails', async () => {
    mockSendNotificationToDevices.mockRejectedValue(new Error('FCM exploded'));

    const result = await sendExpiryAlerts(3);

    expect(result.ok).toBe(true);
    expect(result.inApp).toBe(1);
    expect(result.pushFailed).toBe(1);
    // The reminder still counts as delivered in-app, and the day is marked so the
    // customer is not reminded twice today.
    expect(mockUserNotificationUpdate).toHaveBeenCalled();
  });

  it('counts an unconfigured or token-less push as unreachable without failing the task', async () => {
    mockSendNotificationToDevices.mockResolvedValue({
      configured: false,
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 'FCM is not configured',
    });

    const result = await sendExpiryAlerts(3);

    expect(result.ok).toBe(true);
    expect(result.pushUnreachable).toBe(1);
    expect(result.pushed).toBe(0);
    expect(result.inApp).toBe(1);
  });

  it('does not remind the same subscriber twice in one day', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const subscription = mockModel(Subscription);
    subscription.find = jest.fn().mockReturnValue({
      lean: async () => [
        { _id: 's1', userId: 'u1', expiresAt: tomorrow, status: 'ACTIVE', lastExpiryNoticeOn: today },
      ],
    });

    const result = await sendExpiryAlerts(3);

    expect(result.inApp).toBe(0);
    expect(mockSendNotificationToDevices).not.toHaveBeenCalled();
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });
});

describe('expiry scan keeps the stored status honest', () => {
  it('moves a past-expiry ACTIVE subscription to EXPIRED (and reports how many)', async () => {
    // Exactly the production state on 2026-09-21: a row still marked ACTIVE whose expiresAt had
    // passed, which made every count claim more active customers than could actually play.
    const userId = new mongoose.Types.ObjectId();
    await Subscription.collection.insertOne({
      userId,
      planId: new mongoose.Types.ObjectId(),
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 40 * 864e5),
      expiresAt: new Date(Date.now() - 5 * 864e5),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await sendExpiryAlerts(3);

    expect(result.expiredMarked).toBe(1);
    const row: any = await Subscription.collection.findOne({ userId });
    expect(row.status).toBe('EXPIRED');
    expect(await Subscription.countDocuments({ status: 'ACTIVE' })).toBe(0);
  });
});
