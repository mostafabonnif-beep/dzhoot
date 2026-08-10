/* eslint-disable no-console */
/**
 * End-to-end smoke test for the subscription & activation system.
 * Boots the REAL server (Express + MongoMemoryServer), then walks the full
 * commercial loop: admin login → create plan → generate codes → register a
 * user → redeem a code → check subscription → negative cases.
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
  // Boot an in-memory MongoDB and point the server at it.
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'smoke-access-secret-0123456789';
  process.env.JWT_REFRESH_SECRET = 'smoke-refresh-secret-0123456789';
  process.env.SUPER_ADMIN_USERNAME = 'superadmin';
  process.env.SUPER_ADMIN_EMAIL = 'admin@dzhoof.test';
  process.env.SUPER_ADMIN_PASSWORD = 'SmokeAdmin123!';
  process.env.REDIS_URL = '';

  // Import AFTER env is set — server.js reads env at require time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../src/server');

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

  // 5. Register + login a normal user
  const reg = await jfetch('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'smokeuser', email: 'smoke@dzhoof.test', password: 'SmokePass123!' }),
  });
  check('user registers', reg.status === 201 && reg.body?.success === true, reg.body);

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

  console.log(failures === 0 ? '\n🎉 ALL SMOKE CHECKS PASSED' : `\n💥 ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke run crashed:', err);
  process.exit(1);
});
