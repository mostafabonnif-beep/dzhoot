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
  contentType?: 'Live' | 'VOD',
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
  const allowed = Boolean(subscription && plan) && planAllowsContentType(plan, contentType);
  return { allowed, required, subscription, plan };
}

/**
 * Work-plan part 5: a plan may be scoped to Live TV only, VOD only, or both.
 * Plans with no contentTypes (legacy documents / backfill gap) keep granting
 * everything, so the gate only restricts when the plan explicitly narrows.
 */
export function planAllowsContentType(plan: any | null | undefined, contentType?: 'Live' | 'VOD'): boolean {
  if (!contentType) return true;
  if (!plan) return false;
  const types = Array.isArray(plan.contentTypes) ? plan.contentTypes.filter(Boolean) : [];
  if (types.length === 0) return true;
  return types.includes(contentType);
}

module.exports = { checkPlaybackSubscription, planAllowsContentType };
