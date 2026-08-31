import mongoose from 'mongoose';
import User from '../models/User';
import Subscription from '../models/Subscription';
import ActivationCode from '../models/ActivationCode';
import Reseller from '../models/Reseller';
import Plan from '../models/Plan';
import { sendEmail } from './email';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily operations report — emailed to every Admin each morning:
 * codes activated yesterday (total + per reseller), new users, active subscriptions.
 * No secrets, no PII beyond what admins already see in the panel.
 */
export async function sendDailyOpsReport(): Promise<{ ok: boolean; recipients: number; error?: string }> {
  try {
    const now = new Date();
    const yesterdayStart = new Date(now.getTime() - DAY_MS);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterdayStart.getTime() + DAY_MS);

    const [activatedYesterday, activatedPerReseller, newUsers, activeSubs, admins] = await Promise.all([
      ActivationCode.countDocuments({ status: 'ACTIVATED', activatedAt: { $gte: yesterdayStart, $lt: yesterdayEnd } }),
      ActivationCode.aggregate([
        { $match: { status: 'ACTIVATED', activatedAt: { $gte: yesterdayStart, $lt: yesterdayEnd }, resellerId: { $ne: null } } },
        { $group: { _id: '$resellerId', n: { $sum: 1 } } },
      ]),
      User.countDocuments({ createdAt: { $gte: yesterdayStart, $lt: yesterdayEnd } }),
      Subscription.countDocuments({ status: 'ACTIVE', expiresAt: { $gt: now } }),
      User.find({ role: 'Admin', isActive: true }).select('email username').lean(),
    ]);

    const recipients = admins.map((a) => a.email).filter(Boolean);
    if (recipients.length === 0) return { ok: false, recipients: 0, error: 'no admin email' };

    // Per-reseller breakdown
    const resellerIds = activatedPerReseller.map((r) => r._id).filter(Boolean);
    const resellers = await Reseller.find({ _id: { $in: resellerIds } }).select('name city').lean();
    const resellerMap = new Map(resellers.map((r) => [String(r._id), r]));
    const perResellerLines = activatedPerReseller
      .map((r) => {
        const res = resellerMap.get(String(r._id));
        return `• ${res ? `${res.name} (${res.city || '—'})` : 'محل محذوف'}: ${r.n}`;
      })
      .join('\n');

    const dateStr = yesterdayStart.toISOString().slice(0, 10);
    const subject = `تقرير DZ HOOF اليومي — ${dateStr}`;
    const variables: Record<string, string> = {
      date: dateStr,
      activated: String(activatedYesterday),
      perReseller: perResellerLines || 'لا توجد تفعيلات لمحلات أمس.',
      newUsers: String(newUsers),
      activeSubs: String(activeSubs),
    };

    for (const to of recipients) {
      await sendEmail({ to, subject, template: 'daily-report', variables });
    }
    return { ok: true, recipients: recipients.length };
  } catch (err: any) {
    console.error('[ops-report] daily report error:', err);
    return { ok: false, recipients: 0, error: err?.message || String(err) };
  }
}

/**
 * Subscription expiry reminders — emails users whose ACTIVE subscription
 * expires within `withinDays` (default 3) so they can renew before losing access.
 */
export async function sendExpiryAlerts(withinDays = 3): Promise<{ ok: boolean; sent: number; error?: string }> {
  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + withinDays * DAY_MS);
    const subs = await Subscription.find({ status: 'ACTIVE', expiresAt: { $gt: now, $lte: horizon } }).lean();
    if (subs.length === 0) return { ok: true, sent: 0 };

    const userIds = [...new Set(subs.map((s) => String(s.userId)))];
    const users = await User.find({ _id: { $in: userIds }, isActive: true }).select('email username').lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    let sent = 0;
    for (const sub of subs) {
      const user = userMap.get(String(sub.userId));
      if (!user?.email) continue;
      const daysLeft = Math.max(1, Math.ceil((sub.expiresAt.getTime() - now.getTime()) / DAY_MS));
      try {
        await sendEmail({
          to: user.email,
          subject: 'تنبيه: اشتراكك يقترب من الانتهاء',
          template: 'subscription-expiry',
          variables: {
            username: user.username || '',
            daysLeft: String(daysLeft),
            expiresAt: sub.expiresAt.toISOString().slice(0, 10),
          },
        });
        sent += 1;
      } catch (e: any) {
        console.error(`[ops-report] expiry email failed for ${user.email}:`, e?.message || e);
      }
    }
    return { ok: true, sent };
  } catch (err: any) {
    console.error('[ops-report] expiry alerts error:', err);
    return { ok: false, sent: 0, error: err?.message || String(err) };
  }
}

module.exports = { sendDailyOpsReport, sendExpiryAlerts };
