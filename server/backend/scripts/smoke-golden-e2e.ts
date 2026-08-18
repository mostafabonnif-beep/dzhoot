/* eslint-disable no-console */
/**
 * Golden production-flow smoke test.
 *
 * Covers the security-critical path without requiring a real upstream stream:
 * user → active subscription/entitlement → device credential → device-bound
 * playback token → playback endpoint → device revoke → old token rejected.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = 4197;
const BASE = `http://127.0.0.1:${PORT}`;
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✅ ${name}`);
  else { failures += 1; console.error(`  ❌ ${name}`, detail ?? ''); }
};

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'test';
  process.env.SUBSCRIPTION_REQUIRED = 'true';
  process.env.JWT_ACCESS_SECRET = 'golden-access-secret-0123456789';
  process.env.JWT_REFRESH_SECRET = 'golden-refresh-secret-0123456789';
  process.env.PLAYBACK_TOKEN_SECRET = 'golden-playback-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
  process.env.SUPER_ADMIN_USERNAME = 'superadmin';
  process.env.SUPER_ADMIN_EMAIL = 'admin@dzhoof.test';
  process.env.SUPER_ADMIN_PASSWORD = 'GoldenAdmin123!';
  process.env.REDIS_URL = '';
  process.env.PUBLIC_BASE_URL = BASE;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../src/server');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) { ready = true; break; } } catch { /* boot wait */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  check('server boots', ready);
  if (!ready) throw new Error('server did not boot');

  const json = async (path: string, options: RequestInit = {}, headers: Record<string, string> = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* empty */ }
    return { status: res.status, body };
  };

  const User = require('../src/models/User').default || require('../src/models/User');
  const Plan = require('../src/models/Plan').default || require('../src/models/Plan');
  const Subscription = require('../src/models/Subscription').default || require('../src/models/Subscription');
  const Channel = require('../src/models/Channel').default || require('../src/models/Channel');
  const Device = require('../src/models/Device').default || require('../src/models/Device');
  const { issueDeviceCredential } = require('../src/services/device-credential');

  const reg = await json('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'goldenuser', email: 'golden@dzhoof.test', password: 'GoldenPass123!' }),
  });
  check('register user', reg.status === 201, reg.body);
  const userId = reg.body?.user?.id;

  const login = await json('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'goldenuser', password: 'GoldenPass123!' }),
  });
  const sessionId = login.body?.sessionId;
  check('login user', login.status === 200 && Boolean(sessionId), login.body);
  const sessionHeaders = { 'x-session-id': sessionId };

  const plan = await Plan.create({
    name: 'Golden Premium', durationDays: 30, maxDevices: 2, status: 'Active',
    features: { allowLive: true, allowVod: false, maxConcurrentStreams: 1 },
  });
  await Subscription.create({
    userId, planId: plan._id, status: 'ACTIVE',
    startsAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400000),
  });
  await User.updateOne({ _id: userId }, { $set: { allCatalog: true } });
  check('active premium subscription exists', true);

  const channel = await Channel.create({
    channelId: 'golden-live-1', channelName: 'Golden Live',
    channelUrl: 'http://127.0.0.1:9/unreachable.m3u8', channelGroup: 'Golden', isActive: true,
  });

  const issued = issueDeviceCredential({ userId, deviceId: 'golden-tv-1' });
  await Device.create({
    userId, deviceId: 'golden-tv-1', name: 'Golden TV', platform: 'Android TV',
    credentialHash: issued.tokenHash, credentialExpiresAt: issued.expiresAt,
  });
  check('device credential issued and stored as hash', issued.tokenHash !== issued.token);

  const playback = await json('/api/v1/tv/playback-token', {
    method: 'POST',
    body: JSON.stringify({ channelId: channel.channelId }),
  }, { 'x-device-token': issued.token });
  const playbackUrl = playback.body?.data?.playbackUrl;
  check('device credential can issue playback token', playback.status === 200 && typeof playbackUrl === 'string', playback.body);
  check('playback token URL does not expose upstream URL', !String(playbackUrl || '').includes('127.0.0.1:9'));

  const beforeRevoke = await fetch(playbackUrl);
  // It may fail at the upstream connection, but it must not fail as an auth error.
  check('fresh playback token reaches proxy authorization', beforeRevoke.status !== 401, { status: beforeRevoke.status });

  const secondIssued = issueDeviceCredential({ userId, deviceId: 'golden-tv-2' });
  await Device.create({ userId, deviceId: 'golden-tv-2', name: 'Golden TV 2', platform: 'Android TV', credentialHash: secondIssued.tokenHash, credentialExpiresAt: secondIssued.expiresAt });

  const expired = await Subscription.updateOne({ userId }, { $set: { expiresAt: new Date(Date.now() - 1000), status: 'EXPIRED' } });
  check('subscription can be expired for negative-path test', expired.modifiedCount === 1);

  const postExpiry = await json('/api/v1/tv/playback-token', {
    method: 'POST',
    body: JSON.stringify({ channelId: channel.channelId }),
  }, { 'x-device-token': secondIssued.token });
  check('expired subscription blocks new playback authorization', postExpiry.body?.code === 'SUBSCRIPTION_EXPIRED', postExpiry.body);

  const restored = await Subscription.updateOne({ userId }, { $set: { expiresAt: new Date(Date.now() + 30 * 86400000), status: 'ACTIVE' } });
  check('subscription restored for revoke test', restored.modifiedCount === 1);

  const revoked = await json('/api/v1/me/devices/golden-tv-1/revoke', { method: 'POST' }, sessionHeaders);
  check('device revoke succeeds', revoked.status === 200 && revoked.body?.success === true, revoked.body);

  const afterRevoke = await fetch(playbackUrl);
  check('old playback token is rejected immediately after device revoke', afterRevoke.status === 401, { status: afterRevoke.status });

  console.log(failures === 0 ? '\n🎉 GOLDEN E2E PASSED' : `\n💥 ${failures} GOLDEN CHECK(S) FAILED`);
  await mongo.stop();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Golden E2E crashed:', err);
  process.exit(1);
});
