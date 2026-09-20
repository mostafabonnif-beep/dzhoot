import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';

// The route module is CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const favoritesRouter = require('../routes/favorites');

/**
 * `POST /favorites` replaces `user.metadata.favorites` on the hot User
 * document with whatever the body contains — validated only as "an array".
 * With a 5 MB body limit, one request could bolt an arbitrarily large array
 * onto an account document that EVERY authenticated request for that user
 * loads. The array is now bounded and its elements must look like channel
 * identifiers; the response shape is unchanged.
 */
const { MAX_FAVORITES } = favoritesRouter._private;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/favorites', favoritesRouter);
  return app;
}

const app = buildApp();

let seq = 0;

async function makeUser() {
  seq += 1;
  const User = mongoose.model('User');
  const user = await User.create({
    username: `favU${seq}`,
    email: `fav${seq}@test.local`,
    password: 'favorites-test-pass',
    channelListCode: `FAV${String(seq).padStart(4, '0')}`,
    role: 'User',
    isActive: true,
  });
  const sessionId = `sess_fav_${seq}_${Date.now()}`;
  await mongoose.model('Session').create({
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

async function storedFavorites(userId: mongoose.Types.ObjectId) {
  const doc: any = await mongoose.model('User').findById(userId).lean();
  return doc?.metadata?.favorites;
}

describe('POST /favorites bounds what lands on the user document', () => {
  it('still accepts and stores a real favourites list', async () => {
    const { user, sessionId } = await makeUser();
    // Mongo ObjectId (web client) and catalog channelId slug (Android client).
    const ids = [String(new mongoose.Types.ObjectId()), 'fb-ch-7', '262849'];

    const res = await request(app)
      .post('/api/v1/favorites')
      .set('x-session-id', sessionId)
      .send({ channel_ids: ids, device_id: 'a1b2c3d4e5f60718' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Favorites synced',
      timestamp: expect.any(Number),
    });
    expect(await storedFavorites(user._id)).toEqual(ids);

    const getRes = await request(app)
      .get('/api/v1/favorites')
      .set('x-session-id', sessionId);
    expect(getRes.status).toBe(200);
    expect(getRes.body.channel_ids).toEqual(ids);
  });

  it('accepts an empty list (clearing favourites)', async () => {
    const { user, sessionId } = await makeUser();

    const res = await request(app)
      .post('/api/v1/favorites')
      .set('x-session-id', sessionId)
      .send({ channel_ids: [] });

    expect(res.status).toBe(200);
    expect(await storedFavorites(user._id)).toEqual([]);
  });

  it('rejects a list longer than MAX_FAVORITES without touching the document', async () => {
    const { user, sessionId } = await makeUser();
    await mongoose
      .model('User')
      .updateOne({ _id: user._id }, { $set: { metadata: { favorites: ['keep-me'] } } });

    const res = await request(app)
      .post('/api/v1/favorites')
      .set('x-session-id', sessionId)
      .send({ channel_ids: Array.from({ length: MAX_FAVORITES + 1 }, (_, i) => `ch-${i}`) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/more than/i);
    expect(await storedFavorites(user._id)).toEqual(['keep-me']);
  });

  it('accepts exactly MAX_FAVORITES entries', async () => {
    const { user, sessionId } = await makeUser();

    const res = await request(app)
      .post('/api/v1/favorites')
      .set('x-session-id', sessionId)
      .send({ channel_ids: Array.from({ length: MAX_FAVORITES }, (_, i) => `ch-${i}`) });

    expect(res.status).toBe(200);
    expect((await storedFavorites(user._id))?.length).toBe(MAX_FAVORITES);
  });

  it('rejects implausible elements instead of storing them', async () => {
    const { user, sessionId } = await makeUser();
    const tooLong = 'x'.repeat(129);
    const cases: unknown[] = [
      [42],
      [null],
      [{}],
      [''],
      ['   '],
      [tooLong],
      [`ok\u0000injected`],
      ['ok', 'bad\nnewline'],
      ['valid-id', 7],
    ];

    for (const channel_ids of cases) {
      const res = await request(app)
        .post('/api/v1/favorites')
        .set('x-session-id', sessionId)
        .send({ channel_ids });

      expect({ input: JSON.stringify(channel_ids), status: res.status }).toEqual({
        input: JSON.stringify(channel_ids),
        status: 400,
      });
      expect(res.body.success).toBe(false);
    }
    // Untouched: the schema default (`[]`), not the rejected payload.
    expect(await storedFavorites(user._id)).toEqual([]);
  });

  it('keeps the "must be an array" contract for non-arrays', async () => {
    const { sessionId } = await makeUser();

    for (const channel_ids of ['not-an-array', 5, { a: 1 }, null]) {
      const res = await request(app)
        .post('/api/v1/favorites')
        .set('x-session-id', sessionId)
        .send({ channel_ids });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('channel_ids must be an array');
    }
  });

  it('bounds the device id that shares the same write', async () => {
    const { user, sessionId } = await makeUser();

    const res = await request(app)
      .post('/api/v1/favorites')
      .set('x-session-id', sessionId)
      .send({ channel_ids: ['ok-id'], device_id: 'y'.repeat(1000) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/device_id/i);
    expect(await storedFavorites(user._id)).toEqual([]);
  });

  it('is still idempotent for a device id it already accepted', async () => {
    const { user, sessionId } = await makeUser();

    for (let i = 0; i < 2; i += 1) {
      const res = await request(app)
        .post('/api/v1/favorites')
        .set('x-session-id', sessionId)
        .send({ channel_ids: ['dup-id'], device_id: 'device-1' });
      expect(res.status).toBe(200);
    }
    const doc: any = await mongoose.model('User').findById(user._id).lean();
    expect(doc.metadata.favorites).toEqual(['dup-id']);
    expect(doc.metadata.favoritesDeviceId).toBe('device-1');
  });
});
