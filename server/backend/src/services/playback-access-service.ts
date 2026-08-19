import {
  getActiveSubscription,
  isSubscriptionRequired,
} from './subscription-service';

export interface PlaybackAccessResult {
  allowed: boolean;
  required: boolean;
  subscription: any | null;
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
    return { allowed: true, required, subscription: null };
  }
  if (!userId) {
    return { allowed: false, required, subscription: null };
  }
  const subscription = await getActiveSubscription(String(userId));
  return { allowed: Boolean(subscription), required, subscription };
}

module.exports = { checkPlaybackSubscription };
