import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import Reseller from '../models/Reseller';
import ResellerApiKey, {
  createResellerApiKey,
  hashResellerApiKey,
} from '../models/ResellerApiKey';
import Plan from '../models/Plan';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret-white-label';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const resellerRouter = require('../routes/reseller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminResellersRouter = require('../routes/admin-resellers');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const shopRouter = require('../routes/public-shop');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { requireAuth, requireAdmin } = require('../routes/auth');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/reseller', resellerRouter);
  app.use('/api/v1/admin/resellers', adminResellersRouter);
  app.use('/api/v1/shop', shopRouter);
  return app;
}

let adminSeq = 0;
async function makeAdminSession() {
  adminSeq += 1;
  const User = mongoose.model('User');
  const admin = await User.create({
    username: `admin${adminSeq}`,
    email: `admin${adminSeq}@test.local`,
    passwordHash: 'x',
    password: 'wl-test-pass',
    channelListCode: `ADM${String(adminSeq).padStart(4, '0')}`,
    role: 'Admin',
    isActive: true,
  });
  const Session = mongoose.model('Session');
  const sessionId = `sess_${adminSeq}_${Date.now()}_${adminSeq}`;
  await Session.create({
    sessionId,
    userId: admin._id,
    username: admin.username,
    email: admin.email,
    role: admin.role,
    expiresAt: new Date(Date.now() + 3600_000),
    ipAddress: '127.0.0.1',
  });
  return sessionId;
}

let resellerSeq = 0;
async function makeReseller(extra: Record<string, unknown> = {}) {
  resellerSeq += 1;
  return Reseller.create({
    name: `محل ${resellerSeq}`,
    city: 'الجزائر',
    status: 'Active',
    username: `shop${resellerSeq}`,
    prefix: `W${String(resellerSeq).padStart(2, '0')}X`,
    ...extra,
  } as any);
}

function resellerToken(resellerId: string | mongoose.Types.ObjectId): string {
  return jwt.sign({ sub: String(resellerId), role: 'reseller' }, process.env.JWT_ACCESS_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

describe('White-label branding + reseller API keys (وايت لابل ومفاتيح API)', () => {
  beforeEach(async () => {
    await Reseller.deleteMany({});
    await ResellerApiKey.deleteMany({});
    const PlanAny = Plan as any;
    if (PlanAny.deleteMany) await PlanAny.deleteMany({});
  });

  it('createResellerApiKey stores only a sha-256 hash and returns the plaintext once', async () => {
    const r = await makeReseller();
    const { plaintext, doc } = await createResellerApiKey(String(r._id), 'تكامل خارجي');
    expect(plaintext.startsWith('dzhk_')).toBe(true);
    expect(doc.tokenHash).toBe(hashResellerApiKey(plaintext));
    expect(doc.tokenHash).not.toContain(plaintext);
    expect(doc.prefix).toBe(plaintext.slice(0, 12));
    expect(doc.name).toBe('تكامل خارجي');
    expect(doc.active).toBe(true);
  });

  it('public shop endpoint exposes reseller branding with name fallback', async () => {
    const app = buildApp();
    const r = await makeReseller();
    await Reseller.findByIdAndUpdate(r._id, {
      $set: {
        'branding.displayName': 'متجر الجزيرة',
        'branding.logoUrl': 'https://cdn.example.test/logo.png',
        'branding.primaryColor': '#22c55e',
      },
    });
    const noBranding = await makeReseller();
    const withBranding = await request(app).get(`/api/v1/shop/plans?shop=${r._id}`);
    expect(withBranding.status).toBe(200);
    expect(withBranding.body.data.shop).toMatchObject({
      name: 'متجر الجزيرة',
      logoUrl: 'https://cdn.example.test/logo.png',
      primaryColor: '#22c55e',
      phone: '',
    });
    const fallback = await request(app).get(`/api/v1/shop/plans?shop=${noBranding._id}`);
    expect(fallback.body.data.shop.name).toBe(noBranding.name);
    expect(fallback.body.data.shop.logoUrl).toBe('');
  });

  it('reseller updates own branding (JWT); invalid https logo is rejected', async () => {
    const app = buildApp();
    const r = await makeReseller();
    const token = resellerToken(r._id);

    const ok = await request(app)
      .put('/api/v1/reseller/branding')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'هويتي', logoUrl: 'https://cdn.example.test/x.png', primaryColor: '#22c55e' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      displayName: 'هويتي',
      logoUrl: 'https://cdn.example.test/x.png',
      primaryColor: '#22c55e',
    });

    const bad = await request(app)
      .put('/api/v1/reseller/branding')
      .set('Authorization', `Bearer ${token}`)
      .send({ logoUrl: 'http://insecure.example.test/x.png' });
    expect(bad.status).toBe(400);

    const clear = await request(app)
      .put('/api/v1/reseller/branding')
      .set('Authorization', `Bearer ${token}`)
      .send({ logoUrl: '' });
    expect(clear.status).toBe(200);
    expect(clear.body.data.logoUrl).toBe('');
  });

  it('API key works on allow-listed GET reads only; writes and key management stay JWT-only', async () => {
    const app = buildApp();
    const r = await makeReseller();
    const token = resellerToken(r._id);
    const { plaintext } = await createResellerApiKey(String(r._id), 'read-only');

    const me = await request(app).get('/api/v1/reseller/me').set('X-API-Key', plaintext);
    expect(me.status).toBe(200);
    expect(me.body.data.name).toBe(r.name);
    expect(me.body.data.branding).toBeDefined();

    const ledger = await request(app).get('/api/v1/reseller/ledger').set('X-API-Key', plaintext);
    expect(ledger.status).toBe(200);

    const write = await request(app)
      .put('/api/v1/reseller/branding')
      .set('X-API-Key', plaintext)
      .send({ displayName: 'اختراق' });
    expect(write.status).toBe(403);
    expect(await Reseller.findById(r._id)).toMatchObject({});

    const keyMgmt = await request(app).get('/api/v1/reseller/api-keys').set('X-API-Key', plaintext);
    expect(keyMgmt.status).toBe(403);

    const create = await request(app)
      .post('/api/v1/reseller/api-keys')
      .set('X-API-Key', plaintext)
      .send({ name: 'self-replicate' });
    expect(create.status).toBe(403);

    const bogus = await request(app).get('/api/v1/reseller/me').set('X-API-Key', 'dzhk_nope');
    expect(bogus.status).toBe(401);

    // JWT still works everywhere (the portal UI path).
    const portal = await request(app).get('/api/v1/reseller/me').set('Authorization', `Bearer ${token}`);
    expect(portal.status).toBe(200);
  });

  it('revoked keys stop working immediately', async () => {
    const app = buildApp();
    const r = await makeReseller();
    const token = resellerToken(r._id);
    const created = await request(app)
      .post('/api/v1/reseller/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'مفتاح مؤقت' });
    expect(created.status).toBe(201);
    const { _id: keyId, key: plaintext } = created.body.data;

    const before = await request(app).get('/api/v1/reseller/me').set('X-API-Key', plaintext);
    expect(before.status).toBe(200);

    const revoke = await request(app)
      .delete(`/api/v1/reseller/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(revoke.status).toBe(200);

    const after = await request(app).get('/api/v1/reseller/me').set('X-API-Key', plaintext);
    expect(after.status).toBe(401);

    // Revoked keys are hidden from the list.
    const list = await request(app)
      .get('/api/v1/reseller/api-keys')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.find((k: any) => k._id === keyId)).toBeUndefined();
  });

  it('caps active keys at 10 per reseller', async () => {
    const app = buildApp();
    const r = await makeReseller();
    const token = resellerToken(r._id);
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post('/api/v1/reseller/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `key-${i}` });
      expect(res.status).toBe(201);
    }
    const eleventh = await request(app)
      .post('/api/v1/reseller/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'key-11' });
    expect(eleventh.status).toBe(400);
  });

  it('admin manages branding and API keys per reseller', async () => {
    const app = buildApp();
    const r = await makeReseller();
    const adminSession = await makeAdminSession();

    const brand = await request(app)
      .put(`/api/v1/admin/resellers/${r._id}`)
      .set('x-session-id', adminSession)
      .send({ branding: { displayName: 'وكالة الشرق', logoUrl: 'https://x.example.test/l.png' } });
    expect(brand.status).toBe(200);

    const bad = await request(app)
      .put(`/api/v1/admin/resellers/${r._id}`)
      .set('x-session-id', adminSession)
      .send({ branding: { logoUrl: 'ftp://nope' } });
    expect(bad.status).toBe(400);

    const created = await request(app)
      .post(`/api/v1/admin/resellers/${r._id}/api-keys`)
      .set('x-session-id', adminSession)
      .send({ name: 'من الإدارة' });
    expect(created.status).toBe(201);
    const { _id: keyId, key } = created.body.data;

    // The key works for reads even when created by the admin.
    const me = await request(app).get('/api/v1/reseller/me').set('X-API-Key', key);
    expect(me.status).toBe(200);

    const list = await request(app)
      .get(`/api/v1/admin/resellers/${r._id}/api-keys`)
      .set('x-session-id', adminSession);
    expect(list.status).toBe(200);
    const item = list.body.data.find((k: any) => k._id === keyId);
    expect(item).toBeDefined();
    expect(JSON.stringify(item)).not.toContain(key);

    const revoke = await request(app)
      .delete(`/api/v1/admin/resellers/${r._id}/api-keys/${keyId}`)
      .set('x-session-id', adminSession);
    expect(revoke.status).toBe(200);
    const after = await request(app).get('/api/v1/reseller/me').set('X-API-Key', key);
    expect(after.status).toBe(401);
  });
});
