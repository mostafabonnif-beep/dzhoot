import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Movie from '../models/Movie';
import Series from '../models/Series';
import Season from '../models/Season';
import Episode from '../models/Episode';
import XtreamSource from '../models/XtreamSource';

jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: new mongoose.Types.ObjectId().toString(), role: 'Admin' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vodRouter = require('../routes/admin-vod');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/vod', vodRouter);
  return app;
}

let sourceId: mongoose.Types.ObjectId;

async function seedCatalog() {
  const source = await XtreamSource.create({
    name: 'Panel',
    serverUrl: 'http://panel.example:8080',
    usernameEncrypted: 'enc-u',
    passwordEncrypted: 'enc-p',
  });
  sourceId = source._id;

  await Movie.create([
    { sourceId, externalId: 'm1', title: 'Alpha', category: 'Action', streamUrl: 'http://x/m1.mp4', isActive: true },
    { sourceId, externalId: 'm2', title: 'Beta', category: 'Junk', streamUrl: 'http://x/m2.mp4', isActive: true },
    { sourceId, externalId: 'm3', title: 'Gamma', category: 'Junk', streamUrl: 'http://x/m3.mp4', isActive: true },
  ]);

  const series = await Series.create({
    sourceId,
    externalId: 's1',
    title: 'Series One',
    category: 'Drama',
    isActive: true,
  });
  const season = await Season.create({ seriesId: series._id, seasonNumber: 1, name: 'S1' });
  await Episode.create([
    { seriesId: series._id, seasonId: season._id, externalId: 'e1', episodeNumber: 1, title: 'Ep1', streamUrl: 'http://x/e1.mp4' },
    { seriesId: series._id, seasonId: season._id, externalId: 'e2', episodeNumber: 2, title: 'Ep2', streamUrl: 'http://x/e2.mp4' },
  ]);
  await Series.create({ sourceId, externalId: 's2', title: 'Series Two', category: 'Junk', isActive: true });
}

describe('admin-vod routes', () => {
  beforeEach(async () => {
    await Promise.all([
      Movie.deleteMany({}),
      Series.deleteMany({}),
      Season.deleteMany({}),
      Episode.deleteMany({}),
      XtreamSource.deleteMany({}),
    ]);
    await seedCatalog();
  });

  /* ---------- Movies ---------- */

  it('bulk-disables movies by ids (requires confirmed)', async () => {
    const app = buildApp();
    const movies = await Movie.find({}).lean();

    const unconfirmed = await request(app)
      .patch('/api/v1/admin/vod/movies/bulk')
      .send({ ids: movies.map((m) => String(m._id)), isActive: false });
    expect(unconfirmed.status).toBe(400);

    const res = await request(app)
      .patch('/api/v1/admin/vod/movies/bulk')
      .send({ ids: movies.map((m) => String(m._id)), isActive: false, confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(3);
    expect(await Movie.countDocuments({ isActive: false })).toBe(3);
  });

  it('rejects bulk without valid ids and caps at 2000', async () => {
    const app = buildApp();
    const noIds = await request(app)
      .patch('/api/v1/admin/vod/movies/bulk')
      .send({ ids: ['not-an-id'], isActive: false, confirmed: true });
    expect(noIds.status).toBe(400);

    const tooMany = await request(app)
      .patch('/api/v1/admin/vod/movies/bulk')
      .send({ ids: Array.from({ length: 2001 }, () => new mongoose.Types.ObjectId().toString()), isActive: false, confirmed: true });
    expect(tooMany.status).toBe(400);
  });

  it('bulk-disables movies by category (with optional source scoping)', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch('/api/v1/admin/vod/movies/bulk-by-category')
      .send({ categories: ['Junk'], isActive: false, confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(2);
    expect(await Movie.countDocuments({ category: 'Junk', isActive: false })).toBe(2);
    expect(await Movie.countDocuments({ category: 'Action', isActive: true })).toBe(1);
  });

  it('bulk-deletes movies by category', async () => {
    const app = buildApp();
    const res = await request(app)
      .delete('/api/v1/admin/vod/movies/bulk-by-category')
      .send({ categories: ['Junk'], confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(2);
    expect(await Movie.countDocuments({})).toBe(1);
  });

  it('toggles a single movie', async () => {
    const app = buildApp();
    const movie = await Movie.findOne({ externalId: 'm1' }).lean();
    const res = await request(app)
      .patch(`/api/v1/admin/vod/movies/${movie!._id}`)
      .send({ isActive: false, confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it('deletes a single movie', async () => {
    const app = buildApp();
    const movie = await Movie.findOne({ externalId: 'm1' }).lean();
    const res = await request(app)
      .delete(`/api/v1/admin/vod/movies/${movie!._id}`)
      .send({ confirmed: true });
    expect(res.status).toBe(200);
    expect(await Movie.findById(movie!._id)).toBeNull();
  });

  /* ---------- Series ---------- */

  it('bulk-disables series by ids', async () => {
    const app = buildApp();
    const list = await Series.find({}).lean();
    const res = await request(app)
      .patch('/api/v1/admin/vod/series/bulk')
      .send({ ids: list.map((s) => String(s._id)), isActive: false, confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(2);
  });

  it('deleting a series cascades to seasons and episodes', async () => {
    const app = buildApp();
    const series = await Series.findOne({ externalId: 's1' }).lean();
    const res = await request(app)
      .delete(`/api/v1/admin/vod/series/${series!._id}`)
      .send({ confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.cascaded).toEqual({ seasons: 1, episodes: 2 });
    expect(await Season.countDocuments({ seriesId: series!._id })).toBe(0);
    expect(await Episode.countDocuments({ seriesId: series!._id })).toBe(0);
  });

  it('bulk-deletes series by category with cascade', async () => {
    const app = buildApp();
    const res = await request(app)
      .delete('/api/v1/admin/vod/series/bulk-by-category')
      .send({ categories: ['Junk'], confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(1);
    expect(await Series.countDocuments({})).toBe(1);
  });

  it('returns 404 for unknown movie', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/vod/movies/${new mongoose.Types.ObjectId()}`)
      .send({ isActive: false, confirmed: true });
    expect(res.status).toBe(404);
  });
});
