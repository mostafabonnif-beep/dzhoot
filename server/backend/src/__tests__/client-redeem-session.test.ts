import { computeClientRedeemSessionExpiry, CLIENT_REDEEM_MAX_SESSION_DAYS } from '../utils/client-redeem-session';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('computeClientRedeemSessionExpiry', () => {
  const now = new Date('2026-08-30T12:00:00.000Z').getTime();

  it('caps at the hard limit when there is no subscription yet', () => {
    const expiry = computeClientRedeemSessionExpiry(null, now);
    expect(expiry.getTime()).toBe(now + CLIENT_REDEEM_MAX_SESSION_DAYS * DAY);
  });

  it('bounds a short subscription to its end + grace instead of a full year', () => {
    // Monthly plan: 20 days left of a 30-day subscription.
    const subEnd = new Date(now + 20 * DAY);
    const expiry = computeClientRedeemSessionExpiry(subEnd, now);
    expect(expiry.getTime()).toBe(now + (20 + 7) * DAY); // subEnd + 7d grace
  });

  it('never lets an annual subscription exceed the hard cap', () => {
    const subEnd = new Date(now + 400 * DAY); // 400 days out — beyond the cap
    const expiry = computeClientRedeemSessionExpiry(subEnd, now);
    expect(expiry.getTime()).toBe(now + CLIENT_REDEEM_MAX_SESSION_DAYS * DAY);
  });

  it('floors at one hour for an already-expired subscription', () => {
    const subEnd = new Date(now - 10 * DAY); // expired 10 days ago
    const expiry = computeClientRedeemSessionExpiry(subEnd, now);
    expect(expiry.getTime()).toBe(now + HOUR);
  });

  it('applies a custom grace period', () => {
    const subEnd = new Date(now + 5 * DAY);
    const expiry = computeClientRedeemSessionExpiry(subEnd, now, 0);
    expect(expiry.getTime()).toBe(now + 5 * DAY);
  });

  it('accepts ISO strings and ignores invalid dates', () => {
    expect(computeClientRedeemSessionExpiry(new Date(now + 3 * DAY).toISOString(), now).getTime()).toBe(
      now + (3 + 7) * DAY,
    );
    expect(computeClientRedeemSessionExpiry('not-a-date', now).getTime()).toBe(
      now + CLIENT_REDEEM_MAX_SESSION_DAYS * DAY,
    );
  });
});
