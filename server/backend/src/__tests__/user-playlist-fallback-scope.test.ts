// Playback tokens are always encrypted — a secret must exist even under test.
process.env.PLAYBACK_TOKEN_SECRET = process.env.PLAYBACK_TOKEN_SECRET || 'test-playback-secret';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';

import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const userPlaylistRouter = require('../routes/user-playlist');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyPlaybackToken } = require('../services/playback-token');

/**
 * `GET /me/channels-with-fallbacks` is the documented twin of
 * `GET /me/channels` ("Same as /me/channels but each channel includes its viable
 * alternate streams" — docs/API_DOCUMENTATION.md §5) and both mint a playback
 * token for every channel they return. The fallbacks handler did not apply the
 * freemium group-scope filter, so an account whose plan narrowed (or whose
 * selection predates the change) kept a *working stream URL* for every
 * out-of-scope shared channel, straight out of the endpoint the Android app
 * reads — while the same list through `/me/channels` was correctly filtered.
 *
 * These tests pin the two endpoints together:
 *   1. an out-of-scope shared channel already in `user.channels` is not served
 *      (and no token for it is handed out) by either endpoint,
 *   2. the two endpoints return exactly the same channel ids,
 *   3. an unscoped user is unaffected,
 *   4. the user's own private import survives (its group is never the boundary),
 *   5. the token shape is what `/tv/playback` can actually re-check: SHARED
 *      channels are minted as v2 channel references (re-resolved and
 *      scope-re-checked at consumption), private imports stay v1.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/user-playlist', userPlaylistRouter);
  return app;
}

const app = buildApp();

let seq = 0;

async function makeUser(extra: Record<string, unknown> = {}) {
  seq += 1;
  const User = mongoose.model('User');
  const user = await User.create({
    username: `fallbackU${seq}`,
    email: `fb${seq}@test.local`,
    password: 'fallback-test-pass',
    channelListCode: `FBC${String(seq).padStart(4, '0')}`,
    role: 'User',
    isActive: true,
    ...extra,
  });
  const Session = mongoose.model('Session');
  const sessionId = `sess_fallback_${seq}_${Date.now()}`;
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
    channelName: `FB CH ${seq}`,
    channelId: `fb-ch-${seq}`,
    channelUrl: `https://upstream.test/live/fb/${seq}.m3u8`,
    channelGroup: 'SPORTS',
    isActive: true,
    ownerId: null,
    ...extra,
  });
}

async function setSelection(userId: mongoose.Types.ObjectId, channelIds: mongoose.Types.ObjectId[]) {
  await mongoose.model('User').updateOne({ _id: userId }, { $set: { channels: channelIds } });
}

function channelIds(channels: any[]): string[] {
  return channels.map((c) => String(c._id)).sort();
}

/** Decode every playback token embedded in the returned channel list. */
function playbackTokens(channels: any[], field = 'channelUrl'): any[] {
  return channels
    .map((c) => String(c[field] || ''))
    .map((url) => url.match(/\/api\/v1\/tv\/playback\/([^/]+?)(?:\.m3u8)?$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => verifyPlaybackToken(match[1]))
    .filter(Boolean);
}

function playbackTokensOfAlternates(channels: any[]): any[] {
  // Alternates carry their URL under `streamUrl`, not `channelUrl`.
  return channels.flatMap((c) => playbackTokens(c.alternateStreams || [], 'streamUrl'));
}

describe('GET /me/channels-with-fallbacks applies the freemium scope', () => {
  it('does not serve — or tokenize — an out-of-scope shared channel', async () => {
    // A selection written before the plan narrowed: AR code, SPORTS channel.
    const { user, sessionId } = await makeUser({ accessGroups: ['AR'] });
    const news = await makeChannel({ channelGroup: 'AR' });
    const sports = await makeChannel({ channelGroup: 'SPORTS' });
    await setSelection(user._id, [news._id, sports._id]);

    const res = await request(app)
      .get('/api/v1/user-playlist/me/channels-with-fallbacks')
      .set('x-session-id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body.channels).toHaveLength(1);
    expect(res.body.channels[0].channelGroup).toBe('AR');

    // The regression this guards: the endpoint handed out a playable URL for
    // the out-of-scope channel, so assert on the tokens, not just the rows.
    const tokens = [...playbackTokens(res.body.channels), ...playbackTokensOfAlternates(res.body.channels)];
    expect(tokens).toHaveLength(1);
    for (const payload of tokens) {
      expect(payload.channelId).not.toBe(sports.channelId);
      expect(payload.streamUrl).not.toBe(sports.channelUrl);
    }
  });

  it('returns exactly the same channel ids as GET /me/channels', async () => {
    const { user, sessionId } = await makeUser({ accessGroups: ['AR'] });
    const news = await makeChannel({ channelGroup: 'AR' });
    const sports = await makeChannel({ channelGroup: 'SPORTS' });
    await setSelection(user._id, [news._id, sports._id]);

    const [withFallbacks, plain] = await Promise.all([
      request(app).get('/api/v1/user-playlist/me/channels-with-fallbacks').set('x-session-id', sessionId),
      request(app).get('/api/v1/user-playlist/me/channels').set('x-session-id', sessionId),
    ]);

    expect(withFallbacks.status).toBe(200);
    expect(plain.status).toBe(200);
    expect(channelIds(withFallbacks.body.channels)).toEqual(channelIds(plain.body.channels));
    expect(channelIds(plain.body.channels)).toEqual([String(news._id)]);
  });

  it('leaves an unscoped user\'s whole selection alone', async () => {
    const { user, sessionId } = await makeUser({ accessGroups: [] });
    const news = await makeChannel({ channelGroup: 'AR' });
    const sports = await makeChannel({ channelGroup: 'SPORTS' });
    await setSelection(user._id, [news._id, sports._id]);

    const res = await request(app)
      .get('/api/v1/user-playlist/me/channels-with-fallbacks')
      .set('x-session-id', sessionId);

    expect(res.status).toBe(200);
    expect(channelIds(res.body.channels)).toEqual([String(news._id), String(sports._id)].sort());
  });

  it('always serves the user\'s own private import, whatever its group', async () => {
    const { user, sessionId } = await makeUser({ accessGroups: ['AR'] });
    const privateChannel = await makeChannel({ channelGroup: 'MY-OWN', ownerId: user._id });
    await setSelection(user._id, [privateChannel._id]);

    const res = await request(app)
      .get('/api/v1/user-playlist/me/channels-with-fallbacks')
      .set('x-session-id', sessionId);

    expect(res.status).toBe(200);
    expect(channelIds(res.body.channels)).toEqual([String(privateChannel._id)]);
    // Private imports must keep the v1 embedded-URL token: `/tv/playback`
    // resolves v2 references against the SHARED catalog (`ownerId: null`) only.
    const tokens = playbackTokens(res.body.channels);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].v).toBe(1);
    expect(tokens[0].streamUrl).toBe(privateChannel.channelUrl);
  });

  it('mints shared channels as v2 channel references so /tv/playback re-checks the scope', async () => {
    const { user, sessionId } = await makeUser({ accessGroups: ['AR'] });
    const news = await makeChannel({ channelGroup: 'AR' });
    await setSelection(user._id, [news._id]);

    const res = await request(app)
      .get('/api/v1/user-playlist/me/channels-with-fallbacks')
      .set('x-session-id', sessionId);

    expect(res.status).toBe(200);
    const tokens = playbackTokens(res.body.channels);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].v).toBe(2);
    expect(tokens[0].channelId).toBe(news.channelId);
    expect(tokens[0].streamUrl).toBeUndefined();
    expect(tokens[0].userId).toBe(String(user._id));
  });

  it('tokenizes shared alternate streams as v2 references too', async () => {
    const { user, sessionId } = await makeUser({ accessGroups: ['AR'] });
    const news = await makeChannel({
      channelGroup: 'AR',
      alternateStreams: [
        { streamUrl: 'https://upstream.test/alt/one.m3u8', liveness: { status: 'alive' } },
        { streamUrl: 'https://upstream.test/alt/dead.m3u8', liveness: { status: 'dead' } },
      ],
    });
    await setSelection(user._id, [news._id]);

    const res = await request(app)
      .get('/api/v1/user-playlist/me/channels-with-fallbacks')
      .set('x-session-id', sessionId);

    expect(res.status).toBe(200);
    // Dead alternates are dropped before tokenization (unchanged behaviour).
    expect(res.body.channels[0].alternateStreams).toHaveLength(1);
    const altTokens = playbackTokensOfAlternates(res.body.channels);
    expect(altTokens).toHaveLength(1);
    expect(altTokens[0].v).toBe(2);
    expect(altTokens[0].channelId).toBe(news.channelId);
    expect(typeof altTokens[0].altUrlHash).toBe('string');
  });
});
