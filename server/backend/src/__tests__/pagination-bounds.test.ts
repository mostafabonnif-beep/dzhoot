import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';

// The route modules are CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalogRouter = require('../routes/catalog');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const watchProgressRouter = require('../routes/watch-progress');

/**
 * Query-parameter bounds for two list endpoints that took the raw value:
 *
 *   - `catalog.js` capped `limit` at 100 but never capped `page`, so
 *     `?page=1e9` reached Mongo as an unbounded skip;
 *   - both used `Number(x) || default`, which let `-5` through — mongoose reads
 *     a negative `limit()` as an absolute value.
 *
 * The convention reused here is the repo's: `catalog-helpers.parsePagination`
 * (limit cap 100, page cap 10 000) and `admin-error-reports.boundedLimit`
 * (invalid / non-positive → default).
 */
const { paginate } = catalogRouter._private;
const { boundedLimit, MAX_CONTINUE_WATCHING_LIMIT } = watchProgressRouter._private;

// Models through the registry — the model modules are TS default exports.
const Movie = mongoose.model('Movie');
const WatchProgress = mongoose.model('WatchProgress');

describe('catalog paginate bounds', () => {
  it('keeps the published defaults', () => {
    expect(paginate({})).toEqual({ page: 1, limit: 30, skip: 0 });
  });

  it('passes valid values through', () => {
    expect(paginate({ page: '2', limit: '5' })).toEqual({ page: 2, limit: 5, skip: 5 });
    expect(paginate({ page: '3', limit: '24' })).toEqual({ page: 3, limit: 24, skip: 48 });
  });

  it('caps limit at MAX_PAGE_SIZE and page at the 10 000 convention', () => {
    expect(paginate({ limit: '100000' }).limit).toBe(100);
    expect(paginate({ page: '1e9' }).page).toBe(10000);
    expect(paginate({ page: '1e9' })).toEqual({ page: 10000, limit: 30, skip: 299970 });
  });

  it('falls back to the default for non-numeric, fractional, zero and negative values', () => {
    for (const bad of ['abc', '', '-5', '0', '2.5', ['1', '2'], null, undefined, {}, 'NaN']) {
      const { page, limit } = paginate({ page: bad, limit: bad });
      expect({ input: bad, page, limit }).toEqual({ input: bad, page: 1, limit: 30 });
    }
  });
});

describe('GET /api/v1/catalog/movies honours the bounds', () => {
  const app = express();
  app.use('/api/v1/catalog', catalogRouter);

  beforeEach(async () => {
    await Movie.collection.deleteMany({});
    // Raw insert: the schema demands more required fields than this suite needs.
    await Movie.collection.insertMany(
      Array.from({ length: 3 }, (_, i) => ({
        title: `Bounds Movie ${i}`,
        isActive: true,
        streamUrl: `https://example.invalid/bounds-${i}.mp4`,
        sourceId: new mongoose.Types.ObjectId(),
      })),
    );
  });

  async function get(query: string) {
    const res = await request(app).get(`/api/v1/catalog/movies${query}`);
    expect(res.status).toBe(200);
    return res.body;
  }

  it('reports the clamped limit', async () => {
    expect((await get('?limit=100000')).limit).toBe(100);
  });

  it('reports the default limit for an unusable value, not a negative one', async () => {
    expect((await get('?limit=abc')).limit).toBe(30);
    expect((await get('?limit=-5')).limit).toBe(30);
    expect((await get('?limit=0')).limit).toBe(30);
  });

  it('reports the capped page and never queries beyond it', async () => {
    const body = await get('?page=1e9');
    expect(body.page).toBe(10000);
    expect(body.data).toEqual([]);
  });
});

describe('GET /api/v1/watch-progress honours the bounds', () => {
  const app = express();
  app.use('/api/v1/watch-progress', watchProgressRouter);

  let userId: string;
  let sessionId: string;

  // The global test setup wipes every collection after each test, so the
  // account has to be rebuilt per test.
  beforeEach(async () => {
    const User = mongoose.model('User');
    const user = await User.create({
      username: 'wpBoundsUser',
      email: 'wp-bounds@test.local',
      password: 'wp-bounds-pass',
      channelListCode: 'WPB0001',
      role: 'User',
      isActive: true,
    });
    userId = String(user._id);
    sessionId = `sess_wp_bounds_${Date.now()}`;
    await mongoose.model('Session').create({
      sessionId,
      userId: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      expiresAt: new Date(Date.now() + 3600_000),
      ipAddress: '127.0.0.1',
    });
    await WatchProgress.insertMany(
      Array.from({ length: 60 }, (_, i) => ({
        userId,
        contentId: `bounds-${i}`,
        contentType: 'movie',
        positionSec: 100,
        durationSec: 600,
      })),
    );
  });

  async function get(query: string) {
    const res = await request(app)
      .get(`/api/v1/watch-progress${query}`)
      .set('x-session-id', sessionId);
    expect(res.status).toBe(200);
    return res.body;
  }

  it('honours an explicit limit', async () => {
    expect((await get('?limit=5')).data).toHaveLength(5);
  });

  it('caps an oversized limit at the service ceiling', async () => {
    const body = await get('?limit=1000');
    expect(body.data).toHaveLength(MAX_CONTINUE_WATCHING_LIMIT);
  });

  it('treats non-numeric and negative values as the default', async () => {
    expect((await get('?limit=abc')).data).toHaveLength(20);
    expect((await get('?limit=-3')).data).toHaveLength(20);
    expect((await get('?limit=0')).data).toHaveLength(20);
    expect((await get('?limit=2.5')).data).toHaveLength(20);
  });
});

describe('boundedLimit', () => {
  it('mirrors the repo convention', () => {
    expect(boundedLimit('7', 20, 50)).toBe(7);
    expect(boundedLimit('500', 20, 50)).toBe(50);
    for (const bad of [undefined, null, '', 'abc', '-1', '0', '1.5', ['1', '2']]) {
      expect(boundedLimit(bad, 20, 50)).toBe(20);
    }
  });
});
