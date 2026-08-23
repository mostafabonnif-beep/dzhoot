import {
  getActiveSubscription,
  isSubscriptionRequired,
} from './subscription-service';
import Plan from '../models/Plan';
import User from '../models/User';

export interface PlaybackAccessResult {
  allowed: boolean;
  required: boolean;
  reason?: 'USER_INACTIVE' | 'SUBSCRIPTION_REQUIRED' | 'PLAN_UNAVAILABLE';
  subscription: any | null;
  plan: any | null;
}

/**
 * Single source of truth for subscription-gated playback.
 *
 * The commercial gate is deliberately evaluated from the database for every
 * playback decision. A stale session, playlist, or encrypted playback token
 * must therefore stop working as soon as the user is disabled, the
 * subscription expires/cancels, or its plan becomes unavailable.
 *
 * Active administrators bypass only the commercial subscription requirement;
 * inactive administrators are always denied.
 */
export async function checkPlaybackSubscription(
  userId: string | undefined,
  role: string | undefined,
): Promise<PlaybackAccessResult> {
  const required = await isSubscriptionRequired();
  if (!userId) {
    return { allowed: false, required, reason: 'USER_INACTIVE', subscription: null, plan: null };
  }

  const user = await User.findById(userId).select('isActive role').lean().exec();
  if (!user?.isActive) {
    return { allowed: false, required, reason: 'USER_INACTIVE', subscription: null, plan: null };
  }

  if (!required || role === 'Admin' || user.role === 'Admin') {
    return { allowed: true, required, subscription: null, plan: null };
  }

  const subscription = await getActiveSubscription(String(userId));
  if (!subscription) {
    return {
      allowed: false,
      required,
      reason: 'SUBSCRIPTION_REQUIRED',
      subscription: null,
      plan: null,
    };
  }

  const plan = subscription.planId ? await Plan.findById(subscription.planId).lean().exec() : null;
  if (!plan || plan.status !== 'Active') {
    return {
      allowed: false,
      required,
      reason: 'PLAN_UNAVAILABLE',
      subscription,
      plan,
    };
  }

  return { allowed: true, required, subscription, plan };
}

module.exports = { checkPlaybackSubscription };
