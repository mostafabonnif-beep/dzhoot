/**
 * `POST /api/v1/streams/authorize` must authorize a title the customer can see.
 *
 * This is the regression test for the production outage of 2026-09-25: one
 * source's LIVE channels went dead (its panel probe answered HTTP 407), the live
 * watchdog marked the source `Inactive`, and because the movie/episode gate
 * required `status: 'Active'` AND `verificationStatus: 'verified'`, EVERY movie
 * in the customer catalog returned 404 CONTENT_NOT_FOUND — 17,176 titles — while
 * the video bytes were reachable the whole time (verified: HTTP 206, real
 * MPEG-TS payload). The channel path already accepted such a source; the movie
 * path did not, and the two had drifted apart.
 *
 * The guard is not removed, only made consistent, so the test also pins the
 * negative cases: a source with no visibility signal and no live verdict stays
 * unplayable, a de-listed movie stays unplayable, and the raw upstream URL is
 * never returned to the client.
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import XtreamSource from '../models/XtreamSource';
import Movie from '../models/Movie';

// The gate under test must be reached without Redis or the free-tier ledger.
jest.mock('../services/stream-session-service', () => ({
  registerStreamSession: jest.fn(async () => ({ allowed: true, max: 2, active: 1 })),
}));
jest.mock('../services/stream-usage-service', () => ({
  resolveEgressTier: jest.fn(async () => 'paid'),
}));
jest.mock('../services/free-tier-guard', () => ({
  checkFreeTierAdmission: jest.fn(async () => ({ allowed: true })),
}));

// The router mounts its own auth middleware before the handler, so the gate under
// test is reached only by standing in for that middleware. Inline values on
// purpose: jest.mock factories may not close over outer variables.
type StubRequest = { user?: Record<string, unknown> };

function stubAuth(req: StubRequest, _res: unknown, next: () => void) {
  // The subscription gate is bypassed for Admin, so what this file measures is the
  // source-eligibility gate alone.
  req.user = {
    id: new mongoose.Types.ObjectId().toString(),
    role: 'Admin',
    channelListCode: 'TVTESTCODE1',
  };
  next();
}

jest.mock('../middleware/requireTvOrSessionAuth', () => ({
  requireTvOrSessionAuth: (req: StubRequest, res: unknown, next: () => void) =>
    stubAuth(req, res, next),
}));
jest.mock('../middleware/resolveUser', () => ({
  resolveUser: (req: StubRequest, res: unknown, next: () => void) => stubAuth(req, res, next),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const streamsRouter = require('../routes/streams');

const BASE = '/api/v1/streams';

// The route mints a real playback token, so the key must exist. A test-only value:
// the assertion that matters here is the gate, not the signature (which has its own
// suite in services/playback-token.test.ts).
beforeAll(() => {
  process.env.PLAYBACK_TOKEN_SECRET = 'test-only-playback-token-secret';
});

function buildApp() {
  const app = express();
  app.use(express.json());
  // The subscription gate is bypassed for Admin (see the mocked auth middleware
  // above), so this file measures the source-eligibility gate only.
  app.use(BASE, streamsRouter);
  return app;
}

async function seedSource(overrides: Record<string, unknown> = {}) {
  return XtreamSource.create({
    name: 'Movie Source',
    serverUrl: 'http://panel.test',
    usernameEncrypted: 'u',
    passwordEncrypted: 'p',
    status: 'Inactive',
    verificationStatus: 'degraded',
    ...overrides,
  });
}

async function seedMovie(sourceId: mongoose.Types.ObjectId, overrides: Record<string, unknown> = {}) {
  return Movie.create({
    sourceId,
    externalId: 'ext-1',
    title: 'فيلم الاختبار',
    streamUrl: 'http://panel.test/movie/user/secret/12345.mkv',
    isActive: true,
    ...overrides,
  });
}

const authorize = (movieId: unknown, contentType = 'MOVIE') =>
  request(buildApp())
    .post(`${BASE}/authorize`)
    .send({ contentType, contentId: String(movieId) });

describe('movie playback is gated on source eligibility, not on the live verdict', () => {
  const originalDirectPlayback = process.env.ALLOW_DIRECT_PLAYBACK;
  afterEach(() => {
    if (originalDirectPlayback === undefined) delete process.env.ALLOW_DIRECT_PLAYBACK;
    else process.env.ALLOW_DIRECT_PLAYBACK = originalDirectPlayback;
  });

  it('authorizes a movie from a live-degraded source that is direct-playback ready', async () => {
    // Direct delivery is a deployment opt-in; the point of the assertion is that the
    // source's direct flag survives the eligibility decision.
    process.env.ALLOW_DIRECT_PLAYBACK = 'true';
    const source = await seedSource({ directPlayback: true });
    const movie = await seedMovie(source._id);

    const res = await authorize(movie._id);

    expect(res.status).toBe(200);
    expect(res.body.data.authorized).toBe(true);
    expect(res.body.data.url).toContain('/api/v1/tv/playback/');
    expect(res.body.data.deliveryMode).toBe('direct');
  });

  it('authorizes a movie from a live-degraded but customer-visible source', async () => {
    process.env.ALLOW_DIRECT_PLAYBACK = 'false';
    const source = await seedSource({ customerVisible: true });
    const movie = await seedMovie(source._id);

    const res = await authorize(movie._id);

    expect(res.status).toBe(200);
    expect(res.body.data.deliveryMode).toBe('proxy');
  });

  it('never returns the raw upstream URL to the client', async () => {
    process.env.ALLOW_DIRECT_PLAYBACK = 'true';
    const source = await seedSource({ directPlayback: true });
    const movie = await seedMovie(source._id);

    const res = await authorize(movie._id);

    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(JSON.stringify(res.body)).not.toContain('panel.test');
  });

  it('still refuses a source with no visibility signal and no live verdict', async () => {
    const source = await seedSource();
    const movie = await seedMovie(source._id);

    const res = await authorize(movie._id);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CONTENT_NOT_FOUND');
  });

  it('still refuses a movie whose source no longer exists', async () => {
    const movie = await seedMovie(new mongoose.Types.ObjectId());

    const res = await authorize(movie._id);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CONTENT_NOT_FOUND');
  });

  it('still refuses a de-listed movie, whatever its source says', async () => {
    const source = await seedSource({ directPlayback: true });
    const movie = await seedMovie(source._id, { isActive: false });

    const res = await authorize(movie._id);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CONTENT_NOT_FOUND');
  });
});
