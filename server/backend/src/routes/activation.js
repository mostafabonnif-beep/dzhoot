const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { resolveUser } = require('../middleware/resolveUser');
const { redeemCode, getUserSubscription, registerDevice } = require('../services/subscription-service');
const User = require('../models/User');
const Session = require('../models/Session');
const ActivationCode = require('../models/ActivationCode');
const ActivationRedemption = require('../models/ActivationRedemption');
const Subscription = require('../models/Subscription');
const Device = require('../models/Device');
const Plan = require('../models/Plan');
const { hashActivationCode, normalizeActivationCode } = require('../utils/code-generator');
const { computeClientRedeemSessionExpiry } = require('../utils/client-redeem-session');

const REDEEM_WINDOW_MS = 10 * 60 * 1000;
const REDEEM_MAX_ATTEMPTS = 10;
// IP-level budget that deviceId rotation CANNOT bypass: the per-(ip, deviceId)
// key is client-controlled, so a single attacker could otherwise rotate
// deviceIds and try unlimited codes. The IP budget tolerates carrier NAT
// households (a handful of activations per window) while stopping guessing
// floods from one address.
const REDEEM_MAX_IP_ATTEMPTS = Math.max(
  REDEEM_MAX_ATTEMPTS,
  parseInt(process.env.REDEEM_MAX_IP_ATTEMPTS || '30', 10) || 30,
);
const redeemAttempts = new Map();
const redeemCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - REDEEM_WINDOW_MS;
  for (const [key, timestamps] of redeemAttempts) {
    const recent = timestamps.filter((timestamp) => timestamp > cutoff);
    if (recent.length) redeemAttempts.set(key, recent);
    else redeemAttempts.delete(key);
  }
}, REDEEM_WINDOW_MS);
redeemCleanupTimer.unref?.();

/**
 * Symmetric compensation for a failed /client-redeem.
 *
 * This endpoint mints a throwaway User and then hands it to redeemCode(), which
 * writes to four collections while it works (in this order):
 *   1. ActivationCode — atomic claim UNUSED -> ACTIVATING (findOneAndUpdate at
 *      the top of redeemCode). Its own failure branches for PLAN_UNAVAILABLE and
 *      DEVICE_LIMIT_REACHED release the claim back to UNUSED, and its catch block
 *      releases a still-ACTIVATING claim before rethrowing — so a *returned*
 *      failure normally leaves the code UNUSED/EXPIRED.
 *   2. Device — registerDevice(userId, ...) creates/updates a row for the user.
 *   3. Subscription — created (or an existing ACTIVE row extended) for the user.
 *   4. ActivationCode flips to ACTIVATED with activatedAt/activatedBy=<user>.
 *   5. ActivationRedemption — SUCCESS (and, on every failure path, FAILURE) rows
 *      carrying this userId.
 * Steps 3-5 can all be reached before redeemCode reports a failure or throws:
 * the Subscription is written *before* the code is flipped to ACTIVATED, and
 * `redeemCode` rethrows (rather than returning) for anything that breaks after
 * the claim — e.g. the device lock being busy, or a write error in step 4/5.
 * The old compensation deleted only the User, leaving the code ACTIVATED with
 * activatedBy pointing at a now-deleted account: the replay branch above then
 * finds no user and answers 401 ACCOUNT_INACTIVE forever, i.e. a paid code is
 * burned while an orphan Subscription row keeps a phantom subscriber. The
 * FAILURE ledger rows and the Device row were orphaned the same way.
 *
 * Ordering and invariants:
 *  - The code claim is released FIRST and only when it is ACTIVATED by *this*
 *    throwaway user, so a concurrent redemption won by another account can
 *    never be clobbered. The guarded write is verified with a read-back because
 *    an updateOne matching zero documents is not an error.
 *  - `revokeCode()` is deliberately NOT used: it refuses ACTIVATED codes and
 *    REVOKED is terminal, so it would permanently burn the very code we are
 *    handing back.
 *  - The throwaway account is deleted LAST, and only once every earlier step
 *    succeeded. If anything failed, the account and its rows are kept: the code
 *    stays ACTIVATED by a live account, so the replay branch finishes the
 *    activation on the customer's retry. A dangling activatedBy (the permanent
 *    401) is therefore impossible; the worst case is an inert orphan account
 *    plus a loud log for ops.
 *
 * The HTTP contract is untouched — callers still get 400/403 with
 * {success, error, code}; the compensation result only drives logging.
 *
 * @param {{ _id: any }} user the throwaway account created by this request
 * @param {string} codeHash hashActivationCode() of the code being redeemed
 * @returns {Promise<{ ok: boolean, failures: string[] }>}
 */
async function compensateFailedClientRedeem(user, codeHash) {
  const failures = [];

  // 1. Give the customer's code back. Guarded on activatedBy so an activation
  //    owned by another account (lost claim race) is left untouched.
  try {
    await ActivationCode.updateOne(
      { codeHash, status: 'ACTIVATED', activatedBy: user._id },
      { $set: { status: 'UNUSED', activatedAt: null, activatedBy: null } },
    ).exec();
  } catch (err) {
    failures.push('code-release');
    console.error('[activation] client-redeem: failed to release activation code claim:', err);
  }

  // Read back rather than trusting the write: this is the one state that can
  // strand a paid code forever, so verify it explicitly.
  let claimStillOwned = false;
  try {
    claimStillOwned = Boolean(
      await ActivationCode.findOne({ codeHash, status: 'ACTIVATED', activatedBy: user._id }).select('_id').lean().exec(),
    );
  } catch (err) {
    claimStillOwned = true; // cannot verify -> assume the worst and keep the account
    failures.push('code-verify');
    console.error('[activation] client-redeem: failed to verify activation code release:', err);
  }

  if (claimStillOwned) {
    // Keep the account AND its rows: the code is ACTIVATED by a live account, so
    // the replay branch can still complete this activation on a retry. Deleting
    // the user here is exactly the bug this helper exists to prevent.
    console.error(
      `[activation] client-redeem: compensation incomplete for ${user._id} (${failures.join(', ')}); account kept so the code stays redeemable through the replay path`,
    );
    return { ok: false, failures };
  }

  // 2. Revert the rows redeemCode() wrote for the throwaway user. The account was
  //    created by this very request, so every row carrying its userId is ours.
  const revertRows = async (label, remove) => {
    try {
      await remove();
    } catch (err) {
      failures.push(label);
      console.error(`[activation] client-redeem: failed to remove ${label} rows:`, err);
    }
  };
  await revertRows('subscription', () => Subscription.deleteMany({ userId: user._id }).exec());
  await revertRows('device', () => Device.deleteMany({ userId: user._id }).exec());
  await revertRows('redemption-ledger', () => ActivationRedemption.deleteMany({ userId: user._id }).exec());

  if (failures.length > 0) {
    // Keep the account so no surviving row is left pointing at a deleted userId.
    // The code is already UNUSED, so the customer can simply redeem again.
    console.error(
      `[activation] client-redeem: compensation incomplete for ${user._id} (${failures.join(', ')}); account kept to avoid orphaned rows`,
    );
    return { ok: false, failures };
  }

  // 3. Everything is reverted — the throwaway account can go.
  try {
    await User.deleteOne({ _id: user._id }).exec();
  } catch (err) {
    // Code, subscription, device and ledger are already clean; a surviving empty
    // account is inert (random password, never handed a session). Log, but do
    // not turn an already-clean failure into an error the client must interpret.
    console.error('[activation] client-redeem: failed to delete throwaway account:', err);
  }

  return { ok: true, failures: [] };
}

/**
 * Never throws: a problem inside the compensation must not change the HTTP
 * contract — a failed redeem still answers 400/403 with {success, error, code}.
 * (`compensateFailedClientRedeem` is defensive, this is the belt-and-braces
 * guard for e.g. a driver-level failure while it is cleaning up.)
 */
async function safeCompensateFailedClientRedeem(user, codeHash) {
  try {
    return await compensateFailedClientRedeem(user, codeHash);
  } catch (err) {
    console.error('[activation] client-redeem: compensation crashed:', err);
    return { ok: false, failures: ['compensation-crashed'] };
  }
}

// Customer bootstrap: the installed client receives only an activation code. The
// code is a bearer credential, so this endpoint is deliberately rate-limited and
// returns a normal session plus the managed channel-list credential. Existing
// authenticated users continue to use the protected /redeem endpoint below.
router.post('/client-redeem', async (req, res) => {
  try {
    const { code, deviceId, deviceName, platform, appVersion } = req.body || {};
    const normalized = typeof code === 'string' ? normalizeActivationCode(code) : '';
    const normalizedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';
    if (normalized.length < 8 || normalized.length > 100 || !normalizedDeviceId || normalizedDeviceId.length > 200) {
      return res.status(400).json({ success: false, error: 'Activation code and deviceId are required', code: 'INVALID_CODE' });
    }

    const rateLimitKey = `${req.ip || 'unknown'}:${normalizedDeviceId}`;
    const cutoff = Date.now() - REDEEM_WINDOW_MS;
    const recentAttempts = (redeemAttempts.get(rateLimitKey) || []).filter((timestamp) => timestamp > cutoff);
    if (recentAttempts.length >= REDEEM_MAX_ATTEMPTS) {
      res.set('Retry-After', String(Math.ceil(REDEEM_WINDOW_MS / 1000)));
      return res.status(429).json({ success: false, error: 'Too many activation attempts. Try again later.', code: 'ACTIVATION_RATE_LIMITED' });
    }
    redeemAttempts.set(rateLimitKey, [...recentAttempts, Date.now()]);

    // IP-level budget (see REDEEM_MAX_IP_ATTEMPTS) — recorded for EVERY request,
    // including invalid codes, so rotating deviceIds cannot flush it.
    const ipRateLimitKey = `ip:${req.ip || 'unknown'}`;
    const recentIpAttempts = (redeemAttempts.get(ipRateLimitKey) || []).filter((timestamp) => timestamp > cutoff);
    if (recentIpAttempts.length >= REDEEM_MAX_IP_ATTEMPTS) {
      res.set('Retry-After', String(Math.ceil(REDEEM_WINDOW_MS / 1000)));
      return res.status(429).json({ success: false, error: 'Too many activation attempts. Try again later.', code: 'ACTIVATION_RATE_LIMITED' });
    }
    redeemAttempts.set(ipRateLimitKey, [...recentIpAttempts, Date.now()]);

    const codeHash = hashActivationCode(normalized);
    const activation = await ActivationCode.findOne({ codeHash }).exec();
    if (!activation) return res.status(400).json({ success: false, error: 'Invalid code', code: 'INVALID_CODE' });

    let user;
    if (activation.status === 'ACTIVATED' && activation.activatedBy) {
      user = await User.findById(activation.activatedBy).exec();
      if (!user || !user.isActive) return res.status(401).json({ success: false, error: 'Customer account is inactive', code: 'ACCOUNT_INACTIVE' });
      const plan = await Plan.findById(activation.planId).lean().exec();
      const registered = await registerDevice(user._id.toString(), {
        deviceId: normalizedDeviceId,
        name: deviceName,
        platform,
        appVersion,
      }, plan?.maxDevices);
      if (!registered.ok) return res.status(403).json({ success: false, error: registered.message, code: registered.error });
    } else {
      const plan = await Plan.findById(activation.planId).lean().exec();
      if (!plan || plan.status !== 'Active') return res.status(400).json({ success: false, error: 'Subscription plan is unavailable', code: 'PLAN_UNAVAILABLE' });
      const clientId = crypto.randomBytes(10).toString('hex');
      const channelListCode = await User.generateChannelListCode();
      user = await User.create({
        username: `client_${clientId}`,
        email: `${clientId}@clients.dzhoof.invalid`,
        password: crypto.randomBytes(32).toString('hex'),
        role: 'User',
        channelListCode,
        allCatalog: plan.features?.allCatalog !== false,
        isActive: true,
        emailVerified: true,
      });
      let result;
      try {
        result = await redeemCode(user._id.toString(), normalized, {
          deviceId: normalizedDeviceId,
          name: deviceName,
          platform,
          appVersion,
        }, req.ip);
      } catch (err) {
        // redeemCode rethrows after releasing a still-ACTIVATING claim, but it may
        // already have written a Device/Subscription/ledger row for this account
        // and (when the error happens after the subscription write) flipped the
        // code to ACTIVATED. Revert symmetrically before surfacing the 500 —
        // otherwise the throwaway account is left holding the customer's code.
        await safeCompensateFailedClientRedeem(user, codeHash);
        throw err;
      }
      if (!result.success) {
        // Compensate for every collection redeemCode may have touched: deleting
        // only the user left an ACTIVATED code pointing at a deleted account
        // (permanent 401 on retry) plus orphan Subscription/Device/ledger rows.
        await safeCompensateFailedClientRedeem(user, codeHash);
        return res.status(result.code === 'DEVICE_LIMIT_REACHED' ? 403 : 400).json({ success: false, error: result.error, code: result.code });
      }
    }

    const data = await getUserSubscription(user._id.toString());
    const sessionId = crypto.randomBytes(32).toString('hex');
    await Session.create({
      sessionId,
      userId: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      // Bound the bootstrap session to the subscription instead of minting a
      // fixed year: expiresAt = min(now + 365d, subscriptionEnd + 7d grace),
      // floored at 1h so an expired-subscription re-registration still works
      // briefly instead of failing at the first API call.
      expiresAt: computeClientRedeemSessionExpiry(data?.subscription?.expiresAt),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    redeemAttempts.delete(rateLimitKey);
    redeemAttempts.delete(ipRateLimitKey);
    return res.json({
      success: true,
      sessionId,
      user: { id: user._id, username: user.username, role: user.role, channelListCode: user.channelListCode },
      data,
    });
  } catch (err) {
    console.error('[activation] client bootstrap error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// All account-based activation endpoints require a signed-in user.
router.use(resolveUser);

// POST /api/v1/activation/redeem
// Body: { code: "DZHF-XXXX-XXXX-XXXX", deviceId?, deviceName?, platform?, appVersion? }
router.post('/redeem', async (req, res) => {
  try {
    const { code, deviceId, deviceName, platform, appVersion } = req.body || {};
    if (!code || typeof code !== 'string' || code.length > 100) {
      return res
        .status(400)
        .json({ success: false, error: 'Code is required and must be at most 100 characters', code: 'INVALID_CODE' });
    }

    const rateLimitKey = String(req.user.id);
    const cutoff = Date.now() - REDEEM_WINDOW_MS;
    const recentAttempts = (redeemAttempts.get(rateLimitKey) || []).filter((timestamp) => timestamp > cutoff);
    if (recentAttempts.length >= REDEEM_MAX_ATTEMPTS) {
      res.set('Retry-After', String(Math.ceil(REDEEM_WINDOW_MS / 1000)));
      return res.status(429).json({
        success: false,
        error: 'Too many activation attempts. Try again later.',
        code: 'ACTIVATION_RATE_LIMITED',
      });
    }
    redeemAttempts.set(rateLimitKey, [...recentAttempts, Date.now()]);

    const deviceInfo = deviceId
      ? { deviceId, name: deviceName, platform, appVersion }
      : undefined;

    const result = await redeemCode(req.user.id, code, deviceInfo, req.ip);

    if (!result.success) {
      const status = result.code === 'DEVICE_LIMIT_REACHED' ? 403 : 400;
      return res.status(status).json({
        success: false,
        error: result.error,
        code: result.code,
      });
    }

    redeemAttempts.delete(rateLimitKey);
    return res.json({
      success: true,
      data: {
        subscription: result.subscription,
        plan: {
          _id: result.plan._id,
          name: result.plan.name,
          durationDays: result.plan.durationDays,
          maxDevices: result.plan.maxDevices,
        },
        devicesUsed: result.devicesUsed,
        maxDevices: result.maxDevices,
      },
    });
  } catch (err) {
    console.error('[activation] redeem error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
