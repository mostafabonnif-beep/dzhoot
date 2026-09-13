/**
 * Ads policy — AdSense (web) / AdMob (Android).
 *
 * The operator configures public ad identifiers from the control panel; nothing
 * is hard-coded and no ad is ever requested when the feature is off.
 *
 * Who sees ads (the freemium rule):
 *   - Admin: never.
 *   - Free tier (`demo` / `freeAccess`): yes, unless the operator disables
 *     `free_access.showAds`.
 *   - Paid subscription: never, UNLESS the active plan explicitly opts in with
 *     `features.ads === true` (a deliberately ad-supported cheap tier).
 *
 * Ad identifiers are public by design (they ship inside every client) so the
 * public config exposes the client/slot IDs but never anything else.
 */

const AppSetting = require('../models/AppSetting');
const { isFreeTierUser, getFreeAccessConfig } = require('./channel-scope');

const ADSENSE_CLIENT_RE = /^ca-pub-\d{10,20}$/;
const ADSENSE_SLOT_RE = /^\d{6,20}$/;
const ADMOB_APP_RE = /^ca-app-pub-\d{10,20}~\d{6,20}$/;
const ADMOB_UNIT_RE = /^ca-app-pub-\d{10,20}\/\d{6,20}$/;

// Operators routinely copy the publisher number straight from the AdSense
// dashboard ("pub-1234…") or the AdMob console without the "ca-" prefix.
// Accept both shapes and normalize to the canonical form instead of silently
// dropping the id (which would make ads never render, with no error).
function canonicalizeAdId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^ca-/.test(raw)) return raw;
  // AdMob unit/app ids carry a second number after "~" (app) or "/" (unit);
  // those canonicalize to "ca-app-pub-…", while a lone publisher id is
  // "ca-pub-…". Getting this wrong means AdSense silently never renders.
  if (/^pub-\d{10,20}[~/]\d{6,20}$/.test(raw)) return `ca-app-${raw}`;
  if (/^app-pub-\d{10,20}[~/]\d{6,20}$/.test(raw)) return `ca-${raw}`;
  if (/^pub-\d{10,20}$/.test(raw)) return `ca-${raw}`;
  return raw;
}

const SETTINGS_TTL_MS = 30 * 1000;
let cached = null; // { at, value }

const DEFAULTS = Object.freeze({
  enabled: false,
  showOnFreeTier: true,
  interstitialEveryMinutes: 15,
  frequencyCapPerSession: 3,
  web: { clientId: '', slotBelowPlayer: '', slotSidebar: '' },
  android: { appId: '', bannerUnitId: '', interstitialUnitId: '', rewardedUnitId: '' },
});

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

/** Validate + normalize a raw ads settings object. Never throws. */
function normalizeAdsConfig(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const web = raw.web && typeof raw.web === 'object' ? raw.web : {};
  const android = raw.android && typeof raw.android === 'object' ? raw.android : {};
  const clientId = canonicalizeAdId(web.clientId);
  const slotBelowPlayer = String(web.slotBelowPlayer || '').trim();
  const slotSidebar = String(web.slotSidebar || '').trim();
  const appId = canonicalizeAdId(android.appId);
  const bannerUnitId = canonicalizeAdId(android.bannerUnitId);
  const interstitialUnitId = canonicalizeAdId(android.interstitialUnitId);
  const rewardedUnitId = canonicalizeAdId(android.rewardedUnitId);
  return {
    enabled: raw.enabled === true,
    showOnFreeTier: raw.showOnFreeTier !== false,
    interstitialEveryMinutes: clampInt(raw.interstitialEveryMinutes, 0, 240, DEFAULTS.interstitialEveryMinutes),
    frequencyCapPerSession: clampInt(raw.frequencyCapPerSession, 0, 20, DEFAULTS.frequencyCapPerSession),
    web: {
      clientId: ADSENSE_CLIENT_RE.test(clientId) ? clientId : '',
      slotBelowPlayer: ADSENSE_SLOT_RE.test(slotBelowPlayer) ? slotBelowPlayer : '',
      slotSidebar: ADSENSE_SLOT_RE.test(slotSidebar) ? slotSidebar : '',
    },
    android: {
      appId: ADMOB_APP_RE.test(appId) ? appId : '',
      bannerUnitId: ADMOB_UNIT_RE.test(bannerUnitId) ? bannerUnitId : '',
      interstitialUnitId: ADMOB_UNIT_RE.test(interstitialUnitId) ? interstitialUnitId : '',
      rewardedUnitId: ADMOB_UNIT_RE.test(rewardedUnitId) ? rewardedUnitId : '',
    },
  };
}

/** Human-readable problems in a submitted ads config (empty array = valid). */
function validateAdsConfig(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const web = raw.web && typeof raw.web === 'object' ? raw.web : {};
  const android = raw.android && typeof raw.android === 'object' ? raw.android : {};
  const errors = [];
  const check = (value, re, label) => {
    const v = canonicalizeAdId(value);
    if (v && !re.test(v)) errors.push(`${label} غير صالح`);
  };
  check(web.clientId, ADSENSE_CLIENT_RE, 'AdSense clientId (ca-pub-...)');
  check(web.slotBelowPlayer, ADSENSE_SLOT_RE, 'AdSense slot تحت المشغل');
  check(web.slotSidebar, ADSENSE_SLOT_RE, 'AdSense slot جانبي');
  check(android.appId, ADMOB_APP_RE, 'AdMob appId (ca-app-pub-...~...)');
  check(android.bannerUnitId, ADMOB_UNIT_RE, 'AdMob banner unit');
  check(android.interstitialUnitId, ADMOB_UNIT_RE, 'AdMob interstitial unit');
  check(android.rewardedUnitId, ADMOB_UNIT_RE, 'AdMob rewarded unit');
  return errors;
}

/**
 * Deployment-level defaults, so a shipped release can carry the operator's
 * public ad identifiers inside `/etc/dzhoot/.env.production` (the same place
 * every other production value lives) instead of being hand-typed after each
 * deploy. The admin panel always wins over these — it is the operator's switch.
 */
function configFromEnv() {
  return normalizeAdsConfig({
    enabled: process.env.ADS_ENABLED === 'true',
    showOnFreeTier: process.env.ADS_SHOW_ON_FREE !== 'false',
    interstitialEveryMinutes: process.env.ADS_INTERSTITIAL_EVERY_MINUTES,
    frequencyCapPerSession: process.env.ADS_FREQUENCY_CAP,
    web: {
      clientId: process.env.ADSENSE_CLIENT_ID,
      slotBelowPlayer: process.env.ADSENSE_SLOT_BELOW_PLAYER,
      slotSidebar: process.env.ADSENSE_SLOT_SIDEBAR,
    },
    android: {
      appId: process.env.ADMOB_APP_ID,
      bannerUnitId: process.env.ADMOB_BANNER_UNIT_ID,
      interstitialUnitId: process.env.ADMOB_INTERSTITIAL_UNIT_ID,
      rewardedUnitId: process.env.ADMOB_REWARDED_UNIT_ID,
    },
  });
}

/** Panel value wins per field; an empty panel field keeps the env default. */
function mergeAdsConfig(envConfig, storedConfig) {
  const pick = (envValue, storedValue) => storedValue || envValue;
  return {
    enabled: storedConfig.enabled,
    showOnFreeTier: storedConfig.showOnFreeTier,
    interstitialEveryMinutes: storedConfig.interstitialEveryMinutes,
    frequencyCapPerSession: storedConfig.frequencyCapPerSession,
    web: {
      clientId: pick(envConfig.web.clientId, storedConfig.web.clientId),
      slotBelowPlayer: pick(envConfig.web.slotBelowPlayer, storedConfig.web.slotBelowPlayer),
      slotSidebar: pick(envConfig.web.slotSidebar, storedConfig.web.slotSidebar),
    },
    android: {
      appId: pick(envConfig.android.appId, storedConfig.android.appId),
      bannerUnitId: pick(envConfig.android.bannerUnitId, storedConfig.android.bannerUnitId),
      interstitialUnitId: pick(envConfig.android.interstitialUnitId, storedConfig.android.interstitialUnitId),
      rewardedUnitId: pick(envConfig.android.rewardedUnitId, storedConfig.android.rewardedUnitId),
    },
  };
}

/**
 * Stored, normalized ads config (cached briefly — read on request paths).
 * Precedence: admin panel (when the `ads` setting exists) → deployment env →
 * disabled defaults. Nothing is served while the resolved `enabled` is false.
 */
async function getAdsConfig({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.value;
  const envConfig = configFromEnv();
  let value = envConfig;
  try {
    const doc = await AppSetting.findOne({ key: 'ads' }).lean();
    if (doc?.value !== undefined && doc?.value !== null) {
      const stored = normalizeAdsConfig(doc.value);
      // `enabled` is the operator's explicit switch: the panel decides when set.
      value = mergeAdsConfig(envConfig, stored);
    }
  } catch {
    // Keep the env/disabled default — never break a page because Mongo hiccuped.
  }
  cached = { at: Date.now(), value };
  return value;
}

/** Clear the ads cache (tests, and after an admin saves the setting). */
function clearAdsCache() {
  cached = null;
}

/** The client-facing subset: public identifiers + rendering hints only. */
function publicAdsConfig(config) {
  const ads = config || DEFAULTS;
  return {
    enabled: ads.enabled === true,
    web: {
      clientId: ads.web?.clientId || '',
      slotBelowPlayer: ads.web?.slotBelowPlayer || '',
      slotSidebar: ads.web?.slotSidebar || '',
    },
    android: {
      appId: ads.android?.appId || '',
      bannerUnitId: ads.android?.bannerUnitId || '',
      interstitialUnitId: ads.android?.interstitialUnitId || '',
      rewardedUnitId: ads.android?.rewardedUnitId || '',
    },
    interstitialEveryMinutes: ads.interstitialEveryMinutes,
    frequencyCapPerSession: ads.frequencyCapPerSession,
  };
}

/**
 * Decide whether ads should be requested for this user, and return the public
 * config alongside the decision so clients need a single call.
 */
async function adsPolicyForUser(user) {
  const config = await getAdsConfig();
  const base = publicAdsConfig(config);
  if (!config.enabled) return { showAds: false, reason: 'DISABLED', config: base };
  if (!user) return { showAds: false, reason: 'NO_USER', config: base };
  if (user.role === 'Admin') return { showAds: false, reason: 'ADMIN', config: base };

  if (isFreeTierUser(user)) {
    const freeConfig = await getFreeAccessConfig();
    const show = config.showOnFreeTier !== false && freeConfig.showAds !== false;
    return { showAds: show, reason: show ? 'FREE_TIER' : 'FREE_TIER_OPT_OUT', config: base };
  }

  // Paid subscriber: ads only when their active plan explicitly opts in.
  const optedIn = await activePlanOptsIntoAds(user);
  return {
    showAds: optedIn,
    reason: optedIn ? 'PLAN_OPT_IN' : 'PAID_NO_ADS',
    config: base,
  };
}

async function activePlanOptsIntoAds(user) {
  const userId = String(user?._id || user?.id || '');
  if (!userId) return false;
  try {
    const Subscription = require('../models/Subscription');
    const Plan = require('../models/Plan');
    const subscription = await Subscription.findOne({
      userId,
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() },
    })
      .sort({ expiresAt: -1 })
      .select('planId')
      .lean();
    if (!subscription?.planId) return false;
    const plan = await Plan.findById(subscription.planId).select('features').lean();
    return plan?.features?.ads === true;
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULTS,
  canonicalizeAdId,
  configFromEnv,
  mergeAdsConfig,
  normalizeAdsConfig,
  validateAdsConfig,
  getAdsConfig,
  clearAdsCache,
  publicAdsConfig,
  adsPolicyForUser,
};
