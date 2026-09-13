import Plan from '../models/Plan';
import Subscription from '../models/Subscription';
import AppSetting from '../models/AppSetting';
import User from '../models/User';
import {
  canonicalizeAdId,
  configFromEnv,
  mergeAdsConfig,
  normalizeAdsConfig,
  validateAdsConfig,
  adsPolicyForUser,
  getAdsConfig,
  publicAdsConfig,
  clearAdsCache,
} from '../services/ads-policy';
import { clearScopeCache } from '../services/channel-scope';

// Ads policy: who sees ads (free tier yes, paid no) and which identifiers are
// accepted from the operator. No ad is ever requested while the feature is off.

const VALID_WEB = {
  clientId: 'ca-pub-1234567890123456',
  slotBelowPlayer: '1234567890',
  slotSidebar: '9876543210',
};
const VALID_ANDROID = {
  appId: 'ca-app-pub-1234567890123456~1234567890',
  bannerUnitId: 'ca-app-pub-1234567890123456/1234567890',
  interstitialUnitId: 'ca-app-pub-1234567890123456/1111111111',
};

async function setAds(value: Record<string, unknown>) {
  await AppSetting.updateOne({ key: 'ads' }, { $set: { value } }, { upsert: true });
  clearAdsCache();
}

async function makeUser(username: string, overrides: Record<string, unknown> = {}) {
  const code = await (User as any).generateChannelListCode();
  return User.create({
    username,
    password: 'password123',
    email: `${username}@example.com`,
    channelListCode: code,
    ...overrides,
  });
}

describe('normalizeAdsConfig', () => {
  it('keeps valid AdSense and AdMob identifiers', () => {
    const cfg = normalizeAdsConfig({ enabled: true, web: VALID_WEB, android: VALID_ANDROID });
    expect(cfg.enabled).toBe(true);
    expect(cfg.web.clientId).toBe(VALID_WEB.clientId);
    expect(cfg.web.slotBelowPlayer).toBe(VALID_WEB.slotBelowPlayer);
    expect(cfg.android.appId).toBe(VALID_ANDROID.appId);
    expect(cfg.android.bannerUnitId).toBe(VALID_ANDROID.bannerUnitId);
  });

  it('accepts the bare publisher number the dashboard shows and canonicalizes it', () => {
    // Operators copy "pub-9770740237819457" from AdSense; the canonical id the
    // client needs is "ca-pub-9770740237819457".
    expect(canonicalizeAdId('pub-9770740237819457')).toBe('ca-pub-9770740237819457');
    expect(canonicalizeAdId('ca-pub-9770740237819457')).toBe('ca-pub-9770740237819457');
    expect(canonicalizeAdId('pub-9770740237819457~1234567890')).toBe(
      'ca-app-pub-9770740237819457~1234567890',
    );
    expect(canonicalizeAdId('pub-9770740237819457/1234567890')).toBe(
      'ca-app-pub-9770740237819457/1234567890',
    );
    expect(canonicalizeAdId('garbage')).toBe('garbage');
    expect(canonicalizeAdId('')).toBe('');

    const cfg = normalizeAdsConfig({ enabled: true, web: { clientId: 'pub-9770740237819457' } });
    expect(cfg.web.clientId).toBe('ca-pub-9770740237819457');
    expect(validateAdsConfig({ web: { clientId: 'pub-9770740237819457' } })).toEqual([]);
  });

  it('drops malformed identifiers instead of storing junk', () => {
    const cfg = normalizeAdsConfig({
      enabled: true,
      web: { clientId: 'not-a-publisher', slotBelowPlayer: 'abc' },
      android: { appId: 'ca-pub-1~2', bannerUnitId: 'nope' },
    });
    expect(cfg.web.clientId).toBe('');
    expect(cfg.web.slotBelowPlayer).toBe('');
    expect(cfg.android.appId).toBe('');
    expect(cfg.android.bannerUnitId).toBe('');
  });

  it('clamps the interstitial frequency settings', () => {
    const cfg = normalizeAdsConfig({ interstitialEveryMinutes: -5, frequencyCapPerSession: 999 });
    expect(cfg.interstitialEveryMinutes).toBe(0);
    expect(cfg.frequencyCapPerSession).toBe(20);
  });

  it('validateAdsConfig reports each invalid field and passes valid input', () => {
    expect(validateAdsConfig({ web: VALID_WEB, android: VALID_ANDROID })).toEqual([]);
    const errors = validateAdsConfig({ web: { clientId: 'bad' } });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('publicAdsConfig exposes identifiers but nothing else', () => {
    const pub = publicAdsConfig(normalizeAdsConfig({ enabled: true, web: VALID_WEB }));
    expect(pub.web.clientId).toBe(VALID_WEB.clientId);
    expect(Object.keys(pub)).not.toContain('showOnFreeTier');
  });
});

describe('adsPolicyForUser', () => {
  beforeEach(() => {
    clearAdsCache();
    clearScopeCache();
  });

  it('is off by default (no ads until the operator enables them)', async () => {
    const policy = await adsPolicyForUser({ role: 'User', id: 'x' });
    expect(policy.showAds).toBe(false);
    expect(policy.reason).toBe('DISABLED');
  });

  it('never shows ads to an Admin', async () => {
    await setAds({ enabled: true, web: VALID_WEB });
    const policy = await adsPolicyForUser({ role: 'Admin', id: 'admin' });
    expect(policy.showAds).toBe(false);
    expect(policy.reason).toBe('ADMIN');
  });

  it('shows ads to the free tier when enabled', async () => {
    await setAds({ enabled: true, web: VALID_WEB });
    const policy = await adsPolicyForUser({ role: 'User', id: 'free', freeAccess: true });
    expect(policy.showAds).toBe(true);
    expect(policy.reason).toBe('FREE_TIER');
  });

  it('honours free_access.showAds = false (free tier without ads)', async () => {
    await setAds({ enabled: true, web: VALID_WEB });
    await AppSetting.updateOne(
      { key: 'free_access' },
      { $set: { value: { enabled: true, channelGroups: [], showAds: false } } },
      { upsert: true },
    );
    clearScopeCache();
    const policy = await adsPolicyForUser({ role: 'User', id: 'free2', freeAccess: true });
    expect(policy.showAds).toBe(false);
    expect(policy.reason).toBe('FREE_TIER_OPT_OUT');
  });

  it('keeps a paying subscriber ad-free', async () => {
    await setAds({ enabled: true, web: VALID_WEB });
    const user = await makeUser('paid_noads');
    const plan = await Plan.create({
      name: 'All channels',
      durationDays: 30,
      maxDevices: 1,
      status: 'Active',
      channelGroups: [],
    });
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });
    const policy = await adsPolicyForUser(user);
    expect(policy.showAds).toBe(false);
    expect(policy.reason).toBe('PAID_NO_ADS');
  });

  it('shows ads on a plan that explicitly opts in', async () => {
    await setAds({ enabled: true, web: VALID_WEB });
    const user = await makeUser('paid_ads');
    const plan = await Plan.create({
      name: 'Ad-supported cheap tier',
      durationDays: 30,
      maxDevices: 1,
      status: 'Active',
      features: { ads: true },
    });
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });
    const policy = await adsPolicyForUser(user);
    expect(policy.showAds).toBe(true);
    expect(policy.reason).toBe('PLAN_OPT_IN');
  });

  it('getAdsConfig stays disabled when nothing is stored', async () => {
    const cfg = await getAdsConfig({ fresh: true });
    expect(cfg.enabled).toBe(false);
  });
});

describe('deployment defaults (env)', () => {
  const AD_ENV_KEYS = [
    'ADS_ENABLED',
    'ADS_SHOW_ON_FREE',
    'ADSENSE_CLIENT_ID',
    'ADSENSE_SLOT_BELOW_PLAYER',
    'ADSENSE_SLOT_SIDEBAR',
    'ADMOB_APP_ID',
    'ADMOB_BANNER_UNIT_ID',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of AD_ENV_KEYS) saved[key] = process.env[key];
    for (const key of AD_ENV_KEYS) delete process.env[key];
    clearAdsCache();
  });

  afterEach(() => {
    for (const key of AD_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key] as string;
    }
    clearAdsCache();
  });

  it('a shipped release can carry the publisher id in the environment', async () => {
    // The operator's account id, saved in the project so a deploy needs no
    // hand-typing. Canonicalized to the form the AdSense script expects.
    process.env.ADS_ENABLED = 'true';
    process.env.ADSENSE_CLIENT_ID = 'pub-9770740237819457';

    const cfg = await getAdsConfig({ fresh: true });
    expect(cfg.enabled).toBe(true);
    expect(cfg.web.clientId).toBe('ca-pub-9770740237819457');
  });

  it('stays disabled when only the id is present (no explicit switch)', async () => {
    process.env.ADSENSE_CLIENT_ID = 'pub-9770740237819457';
    const cfg = await getAdsConfig({ fresh: true });
    expect(cfg.enabled).toBe(false);
    expect(cfg.web.clientId).toBe('ca-pub-9770740237819457');
  });

  it('configFromEnv canonicalizes AdMob ids too', () => {
    process.env.ADMOB_APP_ID = 'pub-9770740237819457~1234567890';
    process.env.ADMOB_BANNER_UNIT_ID = 'pub-9770740237819457/1234567890';
    const cfg = configFromEnv();
    expect(cfg.android.appId).toBe('ca-app-pub-9770740237819457~1234567890');
    expect(cfg.android.bannerUnitId).toBe('ca-app-pub-9770740237819457/1234567890');
  });

  it('the panel wins per field, and its switch decides enabled', async () => {
    process.env.ADS_ENABLED = 'true';
    process.env.ADSENSE_CLIENT_ID = 'pub-1111111111111111';
    process.env.ADSENSE_SLOT_BELOW_PLAYER = '1111111111';
    await setAds({
      enabled: false,
      web: { clientId: 'pub-9770740237819457', slotBelowPlayer: '', slotSidebar: '' },
    });

    const cfg = await getAdsConfig({ fresh: true });
    // Panel turned ads off on purpose → off, even though env says enabled.
    expect(cfg.enabled).toBe(false);
    // Panel id wins; the slot the panel left empty falls back to the env value.
    expect(cfg.web.clientId).toBe('ca-pub-9770740237819457');
    expect(cfg.web.slotBelowPlayer).toBe('1111111111');
  });

  it('mergeAdsConfig prefers stored values', () => {
    const envCfg = configFromEnv();
    const stored = normalizeAdsConfig({ web: { clientId: 'ca-pub-2222222222222222' } });
    expect(mergeAdsConfig(envCfg, stored).web.clientId).toBe('ca-pub-2222222222222222');
    expect(mergeAdsConfig(envCfg, normalizeAdsConfig({})).web.clientId).toBe('');
  });
});
