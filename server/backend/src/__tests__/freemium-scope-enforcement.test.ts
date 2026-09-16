// Playback tokens are always encrypted — a secret must exist even under test.
process.env.PLAYBACK_TOKEN_SECRET = process.env.PLAYBACK_TOKEN_SECRET || 'test-playback-secret';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';

import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const userPlaylistRouter = require('../routes/user-playlist');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tvRouter = require('../routes/tv');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharedAuthMiddleware = require('../middleware/requireAuth');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authRoutes = require('../routes/auth');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { issuePlaybackToken } = require('../services/playback-token');

/**
 * The freemium boundary is the paid/free channel-group scope
 * (`services/channel-scope.js`). `/tv/playback-token` applied it, but the
 * personal-selection endpoints (`PUT/GET/POST /user-playlist/me/channels`) did
 * not — and those endpoints mint a playback token for every channel they
 * return. A group-limited code could therefore add an out-of-scope shared
 * channel to its own list and receive a working stream URL straight from
 * `GET /me/channels`.
 *
 * These tests pin every layer of the fix:
 *   1. `PUT /me/channels` refuses out-of-scope shared channels,
 *   2. `GET /me/channels` filters them out (fail-closed for stale selections),
 *   3. `POST /me/channels/add` only adds in-scope ones,
 *   4. `/tv/playback/:token` re-checks the scope at consumption time,
 *   5. `routes/auth.js` re-exports the single shared requireAuth, so every
 *      session-authenticated route sees the same `req.user` (incl. the scope).
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/user-playlist', userPlaylistRouter);
  app.use('/api/v1/tv', tvRouter);
  return app;
}

let seq = 0;

async function makeUser(extra: Record<string, unknown> = {}) {
  seq += 1;
  const User = mongoose.model('User');
  const user = await User.create({
    username: `scopeU${seq}`,
    email: `u${seq}@test.local`,
    password: 'scope-test-pass',
    channelListCode: `SCP${String(seq).padStart(4, '0')}`,
    role: 'User',
    isActive: true,
    ...extra,
  });
  const Session = mongoose.model('Session');
  const sessionId = `sess_scope_${seq}_${Date.now()}`;
  await Session.create({
    sessionId,
    userId: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    expiresAt: new Date(Date.now() + 3600_000),
    ipAddress: '127.0.0.1',
  });
  return { user, sessionId };
}

async function makeChannel(extra: Record<string, unknown> = {}) {
  const Channel = mongoose.model('Channel');
  seq += 1;
  return Channel.create({
    channelName: `CH ${seq}`,
    channelId: `ch-${seq}`,
    channelUrl: `https://upstream.test/live/${seq}.m3u8`,
    channelGroup: 'SPORTS',
    isActive: true,
    ownerId: null,
    ...extra,
  });
}

describe('freemium channel-group scope is enforced on the personal playlist', () => {
  const app = buildApp();

  it('rejects adding a shared channel outside the code\'s groups', async () => {
    const { sessionId } = await makeUser({ accessGroups: ['AR'] });
    const sports = await makeChannel({ channelGroup: 'SPORTS' });

    const res = await request(app)
      .put('/api/v1/user-playlist/me/channels')
      .set('x-session-id', sessionId)
      .send({ channelIds: [String(sports._id)] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CHANNEL_OUT_OF_SCOPE');
  });

  it('accepts a shared channel inside the code\'s groups', async () => {
    const { user, sessionId } = await makeUser({ accessGroups: ['AR'] });
    const news = await makeChannel({ channelGroup: 'AR' });

    const res = await request(app)
      .put('/api/v1/user-playlist/me/channels')
      .set('x-session-id', sessionId)
      .send({ channelIds: [String(news._id)] });

    expect(res.status).toBe(200);
    const refreshed: any = await mongoose.model('User').findById(user._id).lean();
    expect(refreshed!.channels.map(String)).toEqual([String(news._id)]);
  });

  it('still accepts the user\'s own private import regardless of its group', async () => {
    const { user, sessionId } = await makeUser({ accessGroups: ['AR'] });
    const privateChannel = await makeChannel({ channelGroup: 'MY-OWN', ownerId: user._id });

    const res = await request(app)
      .put('/api/v1/user-playlist/me/channels')
      .set('x-session-id', sessionId)
      .send({ channelIds: [String(privateChannel._id)] });

    expect(res.status).toBe(200);
  });

  it('hides an already-stored out-of-scope channel from GET /me/channels', async () => {
    // Simulates a selection written before the plan changed (or before the fix):
    // the endpoint must not keep minting playback tokens for it.
    const { user, sessionId } = await makeUser({ accessGroups: ['AR'] });
    const news = await makeChannel({ channelGroup: 'AR' });
    const sports = await makeChannel({ channelGroup: 'SPORTS' });
    await mongoose
      .model('User')
      .updateOne({ _id: user._id }, { $set: { channels: [news._id, sports._id] } });

    const res = await request(app)
      .get('/api/v1/user-playlist/me/channels')
      .set('x-session-id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body.channels).toHaveLength(1);
    expect(res.body.channels[0].channelGroup).toBe('AR');
  });

  it('an unscoped user (no accessGroups) still sees the whole selection', async () => {
    const { user, sessionId } = await makeUser({ accessGroups: [] });
    const sports = await makeChannel({ channelGroup: 'SPORTS' });
    await mongoose.model('User').updateOne({ _id: user._id }, { $set: { channels: [sports._id] } });

    const res = await request(app)
      .get('/api/v1/user-playlist/me/channels')
      .set('x-session-id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body.channels).toHaveLength(1);
  });

  it('only adds in-scope channels through POST /me/channels/add', async () => {
    const { user, sessionId } = await makeUser({ accessGroups: ['AR'] });
    const news = await makeChannel({ channelGroup: 'AR' });
    const sports = await makeChannel({ channelGroup: 'SPORTS' });

    const res = await request(app)
      .post('/api/v1/user-playlist/me/channels/add')
      .set('x-session-id', sessionId)
      .send({ channelIds: [String(news._id), String(sports._id)] });

    expect(res.status).toBe(200);
    const refreshed: any = await mongoose.model('User').findById(user._id).lean();
    expect(refreshed!.channels.map(String)).toEqual([String(news._id)]);
  });

  it('re-checks the scope when an out-of-scope playback token is presented', async () => {
    // Defence in depth: a token that exists (minted before a plan change, or
    // leaked) must not play a channel the current scope excludes.
    const { user } = await makeUser({ accessGroups: ['AR'] });
    const sports = await makeChannel({ channelGroup: 'SPORTS' });
    const { token } = issuePlaybackToken({
      userId: String(user._id),
      channelListCode: user.channelListCode,
      channelRef: { channelId: sports.channelId, hls: true },
    });

    const res = await request(app).get(`/api/v1/tv/playback/${token}`);

    expect(res.status).toBe(403);
    expect(res.text).toMatch(/outside your subscription scope/i);
  });
});

describe('session auth has a single implementation', () => {
  it('routes/auth.js re-exports the shared middleware', () => {
    expect(authRoutes.requireAuth).toBe(sharedAuthMiddleware.requireAuth);
  });

  it('attaches the freemium scope fields to req.user', async () => {
    const { sessionId } = await makeUser({ accessGroups: ['AR'], freeAccess: true });
    const app = express();
    app.get('/probe', sharedAuthMiddleware.requireAuth, (req: any, res) => {
      res.json({
        id: req.user.id,
        accessGroups: req.user.accessGroups,
        freeAccess: req.user.freeAccess,
        allCatalog: req.user.allCatalog,
      });
    });

    const res = await request(app).get('/probe').set('x-session-id', sessionId);

    expect(res.status).toBe(200);
    // String, not ObjectId — the shape every route now shares.
    expect(typeof res.body.id).toBe('string');
    expect(res.body.accessGroups).toEqual(['AR']);
    expect(res.body.freeAccess).toBe(true);
    expect(res.body.allCatalog).toBe(false);
  });
});
