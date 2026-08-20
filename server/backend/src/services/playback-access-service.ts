import {
  getActiveSubscription,
  isSubscriptionRequired,
} from './subscription-service';
import Plan from '../models/Plan';

export interface PlaybackAccessResult {
  allowed: boolean;
  required: boolean;
  subscription: any | null;
  plan: any | null;
}

/**
 * Single source of truth for subscription-gated playback.
 * Admins bypass the commercial gate; regular users must have an unexpired
 * ACTIVE subscription whenever the platform flag is enabled.
 */
export async function checkPlaybackSubscription(
  userId: string | undefined,
  role: string | undefined,
): Promise<PlaybackAccessResult> {
  const required = await isSubscriptionRequired();
  if (!required || role === 'Admin') {
    return { allowed: true, required, subscription: null, plan: null };
  }
  if (!userId) {
    return { allowed: false, required, subscription: null, plan: null };
  }
  const subscription = await getActiveSubscription(String(userId));
  const plan = subscription?.planId ? await Plan.findById(subscription.planId).lean().exec() : null;
  return { allowed: Boolean(subscription && plan), required, subscription, plan };
}

module.exports = { checkPlaybackSubscription };
