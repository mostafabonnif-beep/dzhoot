/* eslint-disable no-console */
/**
 * End-to-end smoke test for the subscription & activation system.
 * Boots the REAL server against the CI MongoDB service when TEST_MONGO_URI is
 * available (or MongoMemoryServer for local runs), then walks the full commercial
 * loop: admin login → create plan → generate codes → verify public registration
 * is locked → provision a user through the admin API → redeem a code → check
 * subscription → negative cases.
 *
 * Run: npx tsx scripts/smoke-activation.js
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

async function jfetch(path: string, options: RequestInit = {}, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body };
}

async function main() {
  // CI supplies a managed MongoDB service so this smoke test must not download
  // a second MongoDB binary. Local runs retain the self-contained in-memory mode.
  const ciMongoUri = String(process.env.TEST_MONGO_URI || '').trim();
  if (ciMongoUri) {
    process.env.MONGODB_URI = ciMongoUri;
  } else {
    const mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
  }
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'smoke-access-secret-0123456789';
  process.env.JWT_REFRESH_SECRET = 'smoke-refresh-secret-0123456789';
  process.env.SUPER_ADMIN_USERNAME = 'superadmin';
  process.env.SUPER_ADMIN_EMAIL = 'admin@dzhoof.test';
  process.env.SUPER_ADMIN_PASSWORD = 'SmokeAdmin123!';
  process.env.REDIS_URL = '';

  // Import AFTER env is set — server.js reads env at require time. The module
  // intentionally does not listen when imported, so the smoke test starts it explicitly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startServer } = require('../src/server');
  void startServer();

  // Wait for the API to come up.
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  check('server boots and /health responds', ready);

  if (!ready) {
    process.exit(1);
  }

  // 1. Admin login
  const login = await jfetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'superadmin', password: 'SmokeAdmin123!' }),
  });
  check('admin login succeeds', login.status === 200 && login.body?.success === true, login.body);
  const adminSession = login.body?.sessionId;
  const adminHeaders = { 'x-session-id': adminSession };

  // 2. Create a plan
  const plan = await jfetch(
    '/api/v1/admin/plans',
    { method: 'POST', body: JSON.stringify({ name: 'Smoke 1 Month', durationDays: 30, maxDevices: 2, price: 500, currency: 'DZD' }) },
    adminHeaders,
  );
  check('admin creates a plan', plan.status === 201 && plan.body?.success === true, plan.body);
  const planId = plan.body?.data?._id;

  // 3. Generate codes
  const gen = await jfetch(
    '/api/v1/admin/activation-codes/generate',
    { method: 'POST', body: JSON.stringify({ planId, quantity: 3, prefix: 'SMK' }) },
    adminHeaders,
  );
  check(
    'admin generates 3 codes (plaintext returned once)',
    gen.status === 201 && gen.body?.data?.codes?.length === 3,
    gen.body,
  );
  const codes: string[] = gen.body?.data?.codes ?? [];

  // 4. Codes list + stats
  const list = await jfetch('/api/v1/admin/activation-codes', {}, adminHeaders);
  check('admin lists codes', list.status === 200 && list.body?.data?.length === 3, list.body);
  const stats = await jfetch('/api/v1/admin/activation-codes/stats', {}, adminHeaders);
  check('admin sees code stats (3 unused)', stats.status === 200 && stats.body?.data?.byStatus?.UNUSED === 3, stats.body);

  // 5. Public registration is intentionally locked; operators provision users.
  const blockedRegistration = await jfetch('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'blockeduser', email: 'blocked@dzhoof.test', password: 'SmokePass123!' }),
  });
  check('public registration remains disabled', blockedRegistration.status === 403, blockedRegistration.body);

  const provisionedUser = await jfetch(
    '/api/v1/users',
    {
      method: 'POST',
      body: JSON.stringify({ username: 'smokeuser', email: 'smoke@dzhoof.test', password: 'SmokePass123!', role: 'User' }),
    },
    adminHeaders,
  );
  check('admin provisions a normal user', provisionedUser.status === 201 && provisionedUser.body?.success === true, provisionedUser.body);
  const smokeUserId = provisionedUser.body?.data?._id || provisionedUser.body?.data?.id;

  const userLogin = await jfetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'smokeuser', password: 'SmokePass123!' }),
  });
  check('user login succeeds', userLogin.status === 200 && userLogin.body?.success === true, userLogin.body);
  const userSession = userLogin.body?.sessionId;
  const userHeaders = { 'x-session-id': userSession };

  // 6. Redeem the first code
  const redeem = await jfetch(
    '/api/v1/activation/redeem',
    { method: 'POST', body: JSON.stringify({ code: codes[0] }) },
    userHeaders,
  );
  check(
    'user redeems code → ACTIVE subscription',
    redeem.status === 200 && redeem.body?.data?.subscription?.status === 'ACTIVE',
    redeem.body,
  );
  const expiresAt = new Date(redeem.body?.data?.subscription?.expiresAt ?? 0).getTime();
  const startsAt = new Date(redeem.body?.data?.subscription?.startsAt ?? 0).getTime();
  check('duration is ~30 days', Math.round((expiresAt - startsAt) / 86400000) === 30, { expiresAt, startsAt });

  // 7. Redeeming the same code again fails
  const again = await jfetch(
    '/api/v1/activation/redeem',
    { method: 'POST', body: JSON.stringify({ code: codes[0] }) },
    userHeaders,
  );
  check('same code cannot be reused', again.body?.code === 'CODE_ALREADY_USED', again.body);

  // 8. Bad code fails with INVALID_CODE
  const bad = await jfetch(
    '/api/v1/activation/redeem',
    { method: 'POST', body: JSON.stringify({ code: 'NOPE-NOPE-NOPE' }) },
    userHeaders,
  );
  check('invalid code rejected', bad.body?.code === 'INVALID_CODE', bad.body);

  // 9. Subscription view
  const me = await jfetch('/api/v1/me/subscription', {}, userHeaders);
  check(
    'GET /me/subscription shows plan + device counts',
    me.status === 200 && me.body?.data?.plan?.name === 'Smoke 1 Month' && me.body?.data?.maxDevices === 2,
    me.body,
  );

  // 10. Device registration + limit
  const dev1 = await jfetch(
    '/api/v1/me/devices',
    { method: 'POST', body: JSON.stringify({ deviceId: 'tv-1', name: 'Living Room TV' }) },
    userHeaders,
  );
  check('device tv-1 registers', dev1.status === 201 && dev1.body?.success === true, dev1.body);
  const dev2 = await jfetch(
    '/api/v1/me/devices',
    { method: 'POST', body: JSON.stringify({ deviceId: 'phone-1' }) },
    userHeaders,
  );
  const dev3 = await jfetch(
    '/api/v1/me/devices',
    { method: 'POST', body: JSON.stringify({ deviceId: 'tablet-1' }) },
    userHeaders,
  );
  check('third device blocked (limit 2)', dev3.body?.code === 'DEVICE_LIMIT_REACHED', dev3.body);

  // 11. Redeem second code → extends expiry
  const redeem2 = await jfetch(
    '/api/v1/activation/redeem',
    { method: 'POST', body: JSON.stringify({ code: codes[1] }) },
    userHeaders,
  );
  const expires2 = new Date(redeem2.body?.data?.subscription?.expiresAt ?? 0).getTime();
  check('second code extends subscription (~60 days)', Math.round((expires2 - startsAt) / 86400000) === 60, redeem2.body);

  // 12. Admin revoke + stats update (re-fetch the list AFTER redemptions)
  const list2 = await jfetch('/api/v1/admin/activation-codes', {}, adminHeaders);
  const revokedTarget = list2.body?.data?.find((c: any) => c.status === 'UNUSED');
  if (revokedTarget) {
    const revoke = await jfetch(
      `/api/v1/admin/activation-codes/${revokedTarget._id}/revoke`,
      { method: 'POST' },
      adminHeaders,
    );
    check('admin revokes an unused code', revoke.status === 200 && revoke.body?.success === true, revoke.body);
  } else {
    check('admin revokes an unused code', false, 'no unused code found');
  }

  const stats2 = await jfetch('/api/v1/admin/activation-codes/stats', {}, adminHeaders);
  check(
    'stats reflect 2 activated + 1 revoked',
    stats2.body?.data?.byStatus?.ACTIVATED === 2 && stats2.body?.data?.byStatus?.REVOKED === 1,
    stats2.body,
  );

  // 13. Stream authorization gate (E2E)
  const ch = await jfetch(
    '/api/v1/admin/channels',
    { method: 'POST', body: JSON.stringify({ channelId: 'smoke-live-1', channelName: 'Smoke Live', channelUrl: 'https://example.com/live.m3u8', channelGroup: 'Smoke' }) },
    adminHeaders,
  );
  check('admin creates a live channel', ch.status === 201 || ch.status === 200, ch.body);
  const channelId = ch.body?.data?._id || ch.body?.channel?._id || ch.body?.data?.channelId;

  // Enable the subscription gate
  const setFlag = await jfetch(
    '/api/v1/admin/app-settings',
    { method: 'PUT', body: JSON.stringify({ subscription_required: true }) },
    adminHeaders,
  );
  check('admin enables subscription_required', setFlag.status === 200 && setFlag.body?.data?.subscription_required === true, setFlag.body);

  // Without a subscription → 403 SUBSCRIPTION_EXPIRED. Provision a fresh
  // account through the same admin workflow used when public registration is locked.
  const provisionedGateUser = await jfetch(
    '/api/v1/users',
    {
      method: 'POST',
      body: JSON.stringify({ username: 'gateguy', email: 'gate@dzhoof.test', password: 'SmokePass123!', role: 'User' }),
    },
    adminHeaders,
  );
  check('admin provisions an unsubscribed gate user', provisionedGateUser.status === 201 && provisionedGateUser.body?.success === true, provisionedGateUser.body);
  const gateUserId = provisionedGateUser.body?.data?._id || provisionedGateUser.body?.data?.id;
  const gateLogin = await jfetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'gateguy', password: 'SmokePass123!' }),
  });
  const gateHeaders = { 'x-session-id': gateLogin.body?.sessionId };

  // Channel access is provisioned per user: grant the subscriber the full catalog
  // (admin API) — mirrors the production provisioning flow.
  const grant = await jfetch(
    `/api/v1/users/${gateUserId}`,
    { method: 'PUT', body: JSON.stringify({ allCatalog: true }) },
    adminHeaders,
  );
  check('admin grants subscriber catalog access', grant.status === 200, grant.body);

  const denied = await jfetch(
    '/api/v1/streams/authorize',
    { method: 'POST', body: JSON.stringify({ contentType: 'LIVE', contentId: String(channelId) }) },
    gateHeaders,
  );
  check('streams/authorize blocks unsubscribed user', denied.body?.code === 'SUBSCRIPTION_EXPIRED', denied.body);

  // Subscribed user with catalog access is allowed (channel access is provisioned per user)
  const grantSub = await jfetch(
    `/api/v1/users/${smokeUserId}`,
    { method: 'PUT', body: JSON.stringify({ allCatalog: true }) },
    adminHeaders,
  );
  check('admin grants subscriber catalog access', grantSub.status === 200, grantSub.body);

  const allowed = await jfetch(
    '/api/v1/streams/authorize',
    { method: 'POST', body: JSON.stringify({ contentType: 'LIVE', contentId: String(channelId) }) },
    userHeaders,
  );
  check(
    'streams/authorize allows active subscriber with tokenized URL',
    allowed.status === 200 &&
      allowed.body?.data?.authorized === true &&
      typeof allowed.body?.data?.url === 'string' &&
      allowed.body?.data?.url.length > 0,
    allowed.body,
  );

  // Admin bypasses the gate
  const adminAllowed = await jfetch(
    '/api/v1/streams/authorize',
    { method: 'POST', body: JSON.stringify({ contentType: 'LIVE', contentId: String(channelId) }) },
    adminHeaders,
  );
  check('admin bypasses the gate', adminAllowed.status === 200 && adminAllowed.body?.data?.authorized === true, adminAllowed.body);

  // 14. Home endpoint
  const home = await jfetch('/api/v1/home', {});
  check('home endpoint returns sections', home.status === 200 && Array.isArray(home.body?.data?.latestMovies), home.body);

  // 15. Notifications flow
  const notif = await jfetch(
    '/api/v1/admin/notifications',
    { method: 'POST', body: JSON.stringify({ title: 'Welcome', body: 'Enjoy DZ HOOF' }) },
    adminHeaders,
  );
  check('admin creates a notification', notif.status === 201 && notif.body?.success === true, notif.body);
  const notifId = notif.body?.data?._id;
  const sent = await jfetch(`/api/v1/admin/notifications/${notifId}/send`, { method: 'POST' }, adminHeaders);
  check('admin sends the notification', sent.status === 200 && sent.body?.data?.status === 'SENT', sent.body);

  const myNotifs = await jfetch('/api/v1/me/notifications', {}, userHeaders);
  check(
    'user sees the sent notification as unread',
    myNotifs.status === 200 && myNotifs.body?.data?.[0]?.title === 'Welcome' && myNotifs.body?.data?.[0]?.read === false,
    myNotifs.body,
  );
  const markRead = await jfetch(`/api/v1/me/notifications/${notifId}/read`, { method: 'POST' }, userHeaders);
  check('user marks it read', markRead.status === 200 && markRead.body?.success === true, markRead.body);
  const myNotifs2 = await jfetch('/api/v1/me/notifications', {}, userHeaders);
  check('notification now read', myNotifs2.body?.data?.[0]?.read === true, myNotifs2.body);

  // 16. Catalog + search (VOD empty here — no Xtream panel, but endpoints must respond)
  const movies = await jfetch('/api/v1/catalog/movies', {});
  check('catalog/movies responds', movies.status === 200 && Array.isArray(movies.body?.data), movies.body);
  const search = await jfetch('/api/v1/catalog/search?q=smoke', {});
  check('catalog/search responds', search.status === 200 && search.body?.data?.channels?.length >= 1, search.body);

  console.log(failures === 0 ? '\n🎉 ALL SMOKE CHECKS PASSED' : `\n💥 ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke run crashed:', err);
  process.exit(1);
});
