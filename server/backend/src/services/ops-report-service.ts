import mongoose from 'mongoose';
import User from '../models/User';
import Subscription from '../models/Subscription';
import ActivationCode from '../models/ActivationCode';
import Reseller from '../models/Reseller';
import Plan from '../models/Plan';
import { sendEmail } from './email';
import { sendOperationalAlert } from './alert-notifier';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily operations report — emailed to every Admin each morning:
 * codes activated yesterday (total + per reseller), new users, active subscriptions.
 * No secrets, no PII beyond what admins already see in the panel.
 */
export async function sendDailyOpsReport(): Promise<{
  ok: boolean;
  recipients: number;
  /** Recipients the SMTP path actually accepted. `ok` is false when this is 0. */
  delivered?: number;
  /** Where the report actually arrived. 'alert-channels' = the email channel could not
   * deliver it and the operational channels (Telegram/webhook) carried it instead. */
  channel?: 'email' | 'alert-channels';
  error?: string;
}> {
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

    // Count what was actually delivered. The previous version discarded the result
    // and always returned `ok: true`, so the scheduler logged
    // "'Daily Operations Report' completed" while every recipient's mail failed
    // (2026-09-15: two admins, zero emails, job reported success).
    const delivered: string[] = [];
    const failed: string[] = [];
    for (const to of recipients) {
      const res = await sendEmail({ to, subject, template: 'daily-report', variables });
      if (res.ok) delivered.push(to);
      else failed.push(`${to}${res.skipped ? ' (email channel disabled)' : ''}`);
    }
    if (delivered.length === 0) {
      // The job error string is persisted in the task history, so it carries a count
      // and the reason code only — never the recipient addresses.
      const reason = failed.length
        ? `${failed.length} recipient(s) rejected by the email channel`
        : 'no recipients configured';

      // Fall back to the operational channels instead of losing the report. The email
      // channel being unconfigured is a known state (production ran with empty Brevo
      // credentials, so every daily report and expiry alert was silently dropped), and
      // the one channel that demonstrably works there is Telegram. sendOperationalAlert
      // tries webhook → email → Telegram and returns true only if one of them accepted
      // it, so a report that arrives is never reported as lost.
      const summary = [
        `تقرير DZ HOOF اليومي — ${dateStr}`,
        `• تفعيلات أمس: ${activatedYesterday}`,
        perResellerLines,
        `• مستخدمون جدد: ${newUsers}`,
        `• اشتراكات نشطة: ${activeSubs}`,
        '',
        'وصل عبر قنوات التنبيه لأن قناة البريد غير قابلة للتسليم.',
      ]
        .filter((line) => line !== undefined && line !== null && line !== '')
        .join('\n');
      const alerted = await sendOperationalAlert({
        // The date is part of the event key so the notifier's cooldown can never
        // swallow a later day's report.
        event: `ops-report:${dateStr}`,
        severity: 'warning',
        message: summary,
        details: { activated: activatedYesterday, newUsers, activeSubs },
      });
      if (alerted) {
        console.warn(
          `[ops-report] email channel accepted 0/${recipients.length} recipients — report delivered through the alert channels instead`,
        );
        return { ok: true, recipients: recipients.length, delivered: 0, channel: 'alert-channels' };
      }

      console.error(
        `[ops-report] daily report was NOT delivered to ${recipients.length} recipient(s): ${reason}`,
      );
      return { ok: false, recipients: recipients.length, delivered: 0, error: reason };
    }
    if (failed.length) {
      console.warn(`[ops-report] daily report partially delivered: ${delivered.length}/${recipients.length}`);
    }
    return { ok: true, recipients: recipients.length, delivered: delivered.length, channel: 'email' };
  } catch (err: any) {
    console.error('[ops-report] daily report error:', err);
    return { ok: false, recipients: 0, delivered: 0, error: err?.message || String(err) };
  }
}

/**
 * Subscription expiry reminders — emails users whose ACTIVE subscription
 * expires within `withinDays` (default 3) so they can renew before losing access.
 */
export async function sendExpiryAlerts(
  withinDays = 3,
): Promise<{
  ok: boolean;
  sent: number;
  inApp?: number;
  /** Recipients whose email was skipped because the channel is not usable. */
  emailDisabled?: number;
  /** Recipients whose email was attempted and rejected by the SMTP server. */
  emailFailed?: number;
  error?: string;
}> {
  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + withinDays * DAY_MS);
    const subs = await Subscription.find({ status: 'ACTIVE', expiresAt: { $gt: now, $lte: horizon } }).lean();
    if (subs.length === 0) return { ok: true, sent: 0, inApp: 0 };

    const userIds = [...new Set(subs.map((s) => String(s.userId)))];
    const users = await User.find({ _id: { $in: userIds }, isActive: true }).select('email username').lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const Notification = require('../models/Notification');
    const UserNotification = require('../models/UserNotification');
    const today = now.toISOString().slice(0, 10);

    let sent = 0;
    let inApp = 0;
    let emailDisabled = 0;
    let emailFailed = 0;
    for (const sub of subs) {
      const user = userMap.get(String(sub.userId));
      if (!user) continue;
      // One reminder per subscriber per day — the task runs daily, and a stale
      // run must not spam the same inbox twice.
      if (sub.lastExpiryNoticeOn === today) continue;

      const daysLeft = Math.max(1, Math.ceil((sub.expiresAt.getTime() - now.getTime()) / DAY_MS));
      const expiryDate = sub.expiresAt.toISOString().slice(0, 10);

      // In-app reminder first: customers created by the app have a synthetic
      // @clients.dzhoof.invalid address, so email cannot reach them. The inbox
      // is the only channel that always works.
      try {
        const notification = await Notification.create({
          title: 'اشتراكك ينتهي قريباً',
          body: `تنتهي صلاحية اشتراكك بعد ${daysLeft} ${daysLeft === 1 ? 'يوم' : 'أيام'} (${expiryDate}). جدّد الآن لمواصلة المشاهدة دون انقطاع.`,
          deepLink: '/user/subscription',
          audience: 'ALL',
          targetUserId: sub.userId,
          status: 'SENT',
          sentAt: now,
        });
        await UserNotification.updateOne(
          { userId: sub.userId, notificationId: notification._id },
          { $setOnInsert: { userId: sub.userId, notificationId: notification._id, readAt: null } },
          { upsert: true },
        );
        inApp += 1;
      } catch (e: any) {
        console.error(`[ops-report] in-app expiry notice failed for ${String(sub.userId)}:`, e?.message || e);
      }

      // Email is a bonus for customers who signed up with a real address.
      const email = String(user.email || '');
      const emailDeliverable = email && !/\.invalid$/i.test(email.split('@')[1] || '');
      if (emailDeliverable) {
        try {
          // `sendEmail` never throws (it returns {ok:false}), so the old try/catch
          // could not fire and `sent += 1` counted failures as successes.
          const res = await sendEmail({
            to: email,
            subject: 'تنبيه: اشتراكك يقترب من الانتهاء',
            template: 'subscription-expiry',
            variables: {
              username: user.username || '',
              daysLeft: String(daysLeft),
              expiresAt: expiryDate,
            },
          });
          if (res.ok) sent += 1;
          else if (res.skipped) emailDisabled += 1;
          else emailFailed += 1;
        } catch (e: any) {
          emailFailed += 1;
          console.error(`[ops-report] expiry email failed for ${email}:`, e?.message || e);
        }
      }

      // Mark the day so a second run does not duplicate the reminder.
      await Subscription.updateOne({ _id: sub._id }, { $set: { lastExpiryNoticeOn: today } });
    }
    if (emailDisabled || emailFailed) {
      console.warn(
        `[ops-report] expiry emails: ${sent} delivered, ${emailFailed} failed, ` +
          `${emailDisabled} skipped (email channel disabled)`,
      );
    }
    return { ok: true, sent, inApp, emailDisabled, emailFailed };
  } catch (err: any) {
    console.error('[ops-report] expiry alerts error:', err);
    return { ok: false, sent: 0, error: err?.message || String(err) };
  }
}

module.exports = { sendDailyOpsReport, sendExpiryAlerts };
