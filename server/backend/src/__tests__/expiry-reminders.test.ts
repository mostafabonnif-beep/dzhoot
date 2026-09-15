import mongoose from 'mongoose';
import User from '../models/User';
import Plan from '../models/Plan';
import Subscription from '../models/Subscription';
import Notification from '../models/Notification';
import UserNotification from '../models/UserNotification';
import { sendExpiryAlerts } from '../services/ops-report-service';

// Retention loop: a subscriber about to expire must actually be reachable.
// Customers created by the app are registered with a synthetic
// @clients.dzhoof.invalid address, so an email-only reminder reaches nobody —
// the reminder has to land in the in-app inbox as well.

// `sendEmail` resolves a result object (`{ ok }`) and never throws; the reminder
// service counts a reminder as sent only when that result says so.
jest.mock('../services/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

import { sendEmail } from '../services/email';
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;

const DAY_MS = 24 * 60 * 60 * 1000;

async function makeUser(overrides: Record<string, unknown> = {}) {
  const hex = new mongoose.Types.ObjectId().toHexString();
  return User.create({
    username: `rem_${hex}`,
    password: 'password123',
    email: overrides.email || `rem_${hex}@example.com`,
    channelListCode: await (User as any).generateChannelListCode(),
    ...overrides,
  });
}

async function makeSubscription(userId: mongoose.Types.ObjectId, daysLeft: number) {
  const plan = await Plan.create({
    name: `plan-${daysLeft}`,
    durationDays: 30,
    maxDevices: 1,
    status: 'Active',
  });
  return Subscription.create({
    userId,
    planId: plan._id,
    status: 'ACTIVE',
    startsAt: new Date(Date.now() - (30 - daysLeft) * DAY_MS),
    expiresAt: new Date(Date.now() + daysLeft * DAY_MS),
  });
}

describe('subscription expiry reminders', () => {
  beforeEach(() => {
    mockedSendEmail.mockClear();
  });

  it('reaches an app-created customer through the in-app inbox (no email)', async () => {
    const user = await makeUser({ email: 'abc123@clients.dzhoof.invalid' });
    await makeSubscription(user._id, 2);

    const result = await sendExpiryAlerts(3);

    expect(result.ok).toBe(true);
    expect(result.inApp).toBe(1);
    // The synthetic address is not worth a send.
    expect(result.sent).toBe(0);
    expect(mockedSendEmail).not.toHaveBeenCalled();

    const inbox = await Notification.find({ targetUserId: user._id }).lean();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].status).toBe('SENT');
    expect(inbox[0].title).toContain('ينتهي');
    expect(inbox[0].body).toContain('2');

    // A read-state row exists so the app shows it as unread.
    const state = await UserNotification.findOne({ userId: user._id }).lean();
    expect(state).not.toBeNull();
    expect(state?.readAt).toBeNull();
  });

  it('still emails customers who signed up with a real address', async () => {
    const user = await makeUser({ email: 'real@example.com' });
    await makeSubscription(user._id, 1);

    const result = await sendExpiryAlerts(3);

    expect(result.inApp).toBe(1);
    expect(result.sent).toBe(1);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
  });

  it('is idempotent within the same day', async () => {
    const user = await makeUser({ email: 'daily@example.com' });
    await makeSubscription(user._id, 2);

    await sendExpiryAlerts(3);
    const second = await sendExpiryAlerts(3);

    expect(second.inApp).toBe(0);
    expect(second.sent).toBe(0);
    expect(await Notification.countDocuments({ targetUserId: user._id })).toBe(1);
    // The day marker is recorded on the subscription itself.
    const subscription = await Subscription.findOne({ userId: user._id }).lean();
    expect(subscription?.lastExpiryNoticeOn).toBe(new Date().toISOString().slice(0, 10));
  });

  it('ignores subscriptions outside the reminder window', async () => {
    const user = await makeUser({ email: 'later@example.com' });
    await makeSubscription(user._id, 20);

    const result = await sendExpiryAlerts(3);

    expect(result.inApp).toBe(0);
    expect(await Notification.countDocuments({ targetUserId: user._id })).toBe(0);
  });
});
