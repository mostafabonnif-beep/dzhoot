/**
 * Regression: /api/v1/watch-progress must accept the paired-TV credential.
 *
 * The Android/TV client never holds a session — `AppPreferences.setSessionId`
 * has no caller anywhere in the app, so every managed request carries only
 * `X-TV-Code` (plus an optional `X-Session-Id` that is in practice empty). While
 * this router used `requireAuth` (session-only) the endpoint answered 401 for
 * the one client that renders Continue Watching, so cross-device resume could
 * not be wired up on the app side at all and `WatchProgress` stayed device-local
 * in Room.
 *
 * `requireTvOrSessionAuth` accepts the paired TV code and the session cookie/header.
 * These tests pin that contract through the real router and the real middleware
 * (no auth mock): if someone swaps the guard back to the session-only
 * `requireAuth`, the first four cases fail — verified by reverting the guard and
 * watching exactly those four fail.
 */

import request from 'supertest';
import express from 'express';
import User from '../models/User';
import WatchProgress from '../models/WatchProgress';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const watchProgressRouter = require('../routes/watch-progress');

const BASE = '/api/v1/watch-progress';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(BASE, watchProgressRouter);
  return app;
}

/** A PIN-paired TV user, exactly as pairing would create one. */
async function seedPairedUser(overrides: Record<string, unknown> = {}) {
  const user = new User({
    username: 'pairedtv',
    password: 'password123',
    email: 'pairedtv@example.com',
    channelListCode: 'TVCODE1',
    ...overrides,
  });
  await user.save();
  return user;
}

describe('watch-progress accepts the paired-TV credential', () => {
  it('saves a resume position for a request carrying only X-TV-Code', async () => {
    const user = await seedPairedUser();

    const res = await request(buildApp())
      .put(`${BASE}/movie/m1`)
      .set('x-tv-code', user.channelListCode)
      .send({ positionSec: 120, durationSec: 600 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await WatchProgress.findOne({ contentId: 'm1' });
    expect(row).not.toBeNull();
    // The row must belong to the paired user, not to whoever else is in the DB.
    expect(String(row!.userId)).toBe(String(user._id));
    expect(row!.positionSec).toBe(120);
  });

  it('lists Continue Watching for the paired user', async () => {
    const user = await seedPairedUser();
    const app = buildApp();

    await request(app)
      .put(`${BASE}/movie/m1`)
      .set('x-tv-code', user.channelListCode)
      .send({ positionSec: 120, durationSec: 600 });
    await request(app)
      .put(`${BASE}/episode/e9`)
      .set('x-tv-code', user.channelListCode)
      .send({ positionSec: 300, durationSec: 1200 });

    const res = await request(app).get(BASE).set('x-tv-code', user.channelListCode);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((x: { contentId: string }) => x.contentId).sort()).toEqual(['e9', 'm1']);
  });

  it('removes a single item and clears the list for the paired user', async () => {
    const user = await seedPairedUser();
    const app = buildApp();

    await request(app)
      .put(`${BASE}/movie/m1`)
      .set('x-tv-code', user.channelListCode)
      .send({ positionSec: 120, durationSec: 600 });

    const removed = await request(app)
      .delete(`${BASE}/movie/m1`)
      .set('x-tv-code', user.channelListCode);
    expect(removed.status).toBe(200);
    expect(removed.body.data.removed).toBe(true);
    expect(await WatchProgress.countDocuments({})).toBe(0);
  });

  it('does not leak one user\'s progress to another paired TV code', async () => {
    const owner = await seedPairedUser({ username: 'owner', email: 'owner@example.com' });
    const other = await seedPairedUser({
      username: 'other',
      email: 'other@example.com',
      channelListCode: 'TVCODE2',
    });
    const app = buildApp();

    await request(app)
      .put(`${BASE}/movie/mine`)
      .set('x-tv-code', owner.channelListCode)
      .send({ positionSec: 120, durationSec: 600 });

    const res = await request(app).get(BASE).set('x-tv-code', other.channelListCode);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('still rejects a request with no credential at all', async () => {
    const res = await request(buildApp())
      .put(`${BASE}/movie/m1`)
      .send({ positionSec: 120, durationSec: 600 });

    expect(res.status).toBe(401);
    expect(await WatchProgress.countDocuments({})).toBe(0);
  });

  it('rejects an unknown TV code', async () => {
    await seedPairedUser();

    const res = await request(buildApp())
      .get(BASE)
      .set('x-tv-code', 'NOPE99');

    expect(res.status).toBe(401);
  });

  it('rejects a revoked TV code', async () => {
    // `resolveUser` requires `codeRevokedAt: null`; a revoked code must not be a
    // usable credential even though the row still exists.
    const user = await seedPairedUser({ codeRevokedAt: new Date() });

    const res = await request(buildApp())
      .get(BASE)
      .set('x-tv-code', user.channelListCode);

    expect(res.status).toBe(401);
  });

  it('rejects a deactivated account', async () => {
    const user = await seedPairedUser({ isActive: false });

    const res = await request(buildApp())
      .get(BASE)
      .set('x-tv-code', user.channelListCode);

    expect(res.status).toBe(401);
  });

  it('refuses a demo session instead of failing the ObjectId cast', async () => {
    // A configured DEMO_TV_CODE authenticates without an account; the middleware
    // sets `req.user = { id: 'demo', demo: true }`. There is nothing to attach
    // progress to, so the route must answer 401 — and must not hand 'demo' to the
    // model, where the ObjectId cast on `userId` failed and produced a 400 plus a
    // stack trace in the log.
    //
    // The code is generated, not written: a literal device code in a tracked file
    // is exactly what scripts/security/check-secrets.sh rejects (it flagged this
    // test's first version before it ran), and it needs no annotation this way.
    const demoCode = `ZD${Date.now().toString(36).toUpperCase()}`;
    const original = process.env.DEMO_TV_CODE;
    process.env.DEMO_TV_CODE = demoCode;
    try {
      const res = await request(buildApp())
        .put(`${BASE}/movie/m1`)
        .set('x-tv-code', demoCode)
        .send({ positionSec: 120, durationSec: 600 });

      expect(res.status).toBe(401);
      // Distinguish the two 401s: the middleware rejecting the credential says
      // 'Invalid TV code'. Here the credential was ACCEPTED (demo) and the route
      // refused it, so the body must be the route's own 'Unauthorized'. Without
      // this assertion the test would pass vacuously if DEMO_TV_CODE stopped
      // being honoured and the guard simply rejected the code.
      expect(res.body.error).toBe('Unauthorized');
      expect(await WatchProgress.countDocuments({})).toBe(0);
    } finally {
      if (original === undefined) delete process.env.DEMO_TV_CODE;
      else process.env.DEMO_TV_CODE = original;
    }
  });
});
