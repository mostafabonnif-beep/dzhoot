import {
  getActiveSubscription,
  isSubscriptionRequired,
} from './subscription-service';

export interface PlaybackAccessResult {
  allowed: boolean;
  required: boolean;
  subscription: any | null;
  plan: any | null;
  entitlement: { allowLive: boolean; allowVod: boolean; maxConcurrentStreams: number | null };
}

type PopulatedPlan = {
  features?: Record<string, unknown>;
};

function isPopulatedPlan(value: unknown): value is PopulatedPlan {
  return Boolean(value && typeof value === 'object' && 'features' in value);
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
    return { allowed: true, required, subscription: null, plan: null, entitlement: { allowLive: true, allowVod: true, maxConcurrentStreams: null } };
  }
  if (!userId) {
    return { allowed: false, required, subscription: null, plan: null, entitlement: { allowLive: false, allowVod: false, maxConcurrentStreams: null } };
  }
  const subscription = await getActiveSubscription(String(userId));
  if (!subscription) return { allowed: false, required, subscription: null, plan: null, entitlement: { allowLive: false, allowVod: false, maxConcurrentStreams: null } };
  const plan = isPopulatedPlan(subscription.planId) ? subscription.planId : null;
  const features = plan?.features && typeof plan.features === 'object' ? plan.features : {};
  const allowLive = features.allowLive !== false;
  const allowVod = features.allowVod !== false;
  const configuredMax = Number(features.maxConcurrentStreams);
  const maxConcurrentStreams = Number.isFinite(configuredMax) && configuredMax > 0 ? Math.floor(configuredMax) : null;
  return { allowed: allowLive || allowVod, required, subscription, plan, entitlement: { allowLive, allowVod, maxConcurrentStreams } };
}

module.exports = { checkPlaybackSubscription };
