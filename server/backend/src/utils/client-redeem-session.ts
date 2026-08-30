/**
 * Session expiry policy for POST /api/v1/activation/client-redeem.
 *
 * The activation code is a bearer credential handed to unauthenticated
 * clients, so the bootstrap session must not outlive the subscription by a
 * wide margin (the historical fixed 365-day session left e.g. a 7-day trial
 * with a full year of channel-list access). The session expires at:
 *
 *   min(now + CLIENT_REDEEM_MAX_SESSION_DAYS, subscriptionEnd + graceDays)
 *
 * with a 1-hour floor so an already-expired subscription never mints a dead
 * session (device re-registration on an expired code must still return
 * something usable).
 */
export const CLIENT_REDEEM_MAX_SESSION_DAYS = 365;
export const CLIENT_REDEEM_SESSION_GRACE_DAYS = 7;
export const CLIENT_REDEEM_SESSION_FLOOR_MS = 60 * 60 * 1000;

export function computeClientRedeemSessionExpiry(
  subscriptionExpiresAt: Date | string | null | undefined,
  now: number = Date.now(),
  graceDays: number = CLIENT_REDEEM_SESSION_GRACE_DAYS,
): Date {
  const maxMs = CLIENT_REDEEM_MAX_SESSION_DAYS * 24 * 60 * 60 * 1000;
  const graceMs = Math.max(0, graceDays) * 24 * 60 * 60 * 1000;

  let expiresMs = now + maxMs;
  if (subscriptionExpiresAt) {
    const subEnd = new Date(subscriptionExpiresAt).getTime();
    if (Number.isFinite(subEnd)) {
      expiresMs = Math.min(expiresMs, subEnd + graceMs);
    }
  }
  return new Date(Math.max(expiresMs, now + CLIENT_REDEEM_SESSION_FLOOR_MS));
}

module.exports = { computeClientRedeemSessionExpiry, CLIENT_REDEEM_MAX_SESSION_DAYS, CLIENT_REDEEM_SESSION_GRACE_DAYS };
