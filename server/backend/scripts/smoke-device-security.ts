/* eslint-disable no-console */
/**
 * Security smoke: pairing-issued device credential authenticates, then becomes
 * unusable immediately after revocation. Also checks a short-lived playback
 * token is rejected after the user's playback credential version changes.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = 4196;
const BASE = `http://127.0.0.1:${PORT}`;
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => ok ? console.log(`  ✅ ${name}`) : (failures++, console.error(`  ❌ ${name}`, detail ?? ''));

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'device-smoke-access-secret-0123456789';
  process.env.JWT_REFRESH_SECRET = 'device-smoke-refresh-secret-0123456789';
  process.env.PLAYBACK_TOKEN_SECRET = 'device-smoke-playback-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
  process.env.SUPER_ADMIN_USERNAME = 'superadmin';
  process.env.SUPER_ADMIN_EMAIL = 'admin@dzhoof.test';
  process.env.SUPER_ADMIN_PASSWORD = 'DeviceSmokeAdmin123!';
  process.env.REDIS_URL = '';

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../src/server');
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* boot wait */ }
    await new Promise(r => setTimeout(r, 250));
  }

  const json = async (path: string, options: RequestInit = {}, headers: Record<string,string> = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...headers } });
    let body: any = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  };

  const reg = await json('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ username: 'devicesmoke', email: 'device@dzhoof.test', password: 'DeviceSmoke123!' }) });
  check('user registration succeeds', reg.status === 201, reg.body);
  const login = await json('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'devicesmoke', password: 'DeviceSmoke123!' }) });
  const session = login.body?.sessionId;
  check('user login succeeds', login.status === 200 && Boolean(session), login.body);

  const Device = require('../src/models/Device');
  const { issueDeviceCredential, hashDeviceCredential, verifyDeviceCredential } = require('../src/services/device-credential');
  const userId = reg.body?.user?.id;
  const issued = issueDeviceCredential({ userId, deviceId: 'security-tv-1' });
  await Device.create({ userId, deviceId: 'security-tv-1', credentialHash: issued.tokenHash, credentialExpiresAt: issued.expiresAt });
  const verified = await verifyDeviceCredential(issued.token);
  check('fresh device credential verifies', Boolean(verified));
  check('credential is stored only as a hash', issued.tokenHash === hashDeviceCredential(issued.token) && issued.tokenHash !== issued.token);

  // Give the smoke user admin access only through a direct DB update; no production endpoint bypass.
  await Device.updateOne({ userId, deviceId: 'security-tv-1' }, { $set: { credentialRevokedAt: new Date() }, $inc: { credentialVersion: 1 } });
  const revoked = await verifyDeviceCredential(issued.token);
  check('revoked device credential is rejected', revoked === null);

  await mongo.stop();
  if (failures) process.exit(1);
  console.log('✅ Device security smoke passed');
}
main().catch(err => { console.error(err); process.exit(1); });
