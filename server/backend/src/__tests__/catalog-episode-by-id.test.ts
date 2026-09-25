/**
 * Tests for `GET /api/v1/catalog/episodes/:id`.
 *
 * This endpoint exists so a client holding only an episode id can resolve it:
 * every other episode route is keyed by a SEASON id, and a resume position from
 * `/api/v1/watch-progress` carries an episode id with no season or series. Without
 * this, Continue Watching is buildable for live channels and movies only.
 *
 * The two assertions that matter most are the leak guards: the raw upstream
 * `streamUrl` must never appear in the payload, and a de-listed series must not
 * be reachable through an episode id a device cached while it was live.
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Series from '../models/Series';
import Season from '../models/Season';
import Episode from '../models/Episode';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalogRouter = require('../routes/catalog');

const BASE = '/api/v1/catalog';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(BASE, catalogRouter);
  return app;
}

const SOURCE_ID = new mongoose.Types.ObjectId();

async function seedEpisode({ seriesActive = true, title = 'الحلقة الأولى' } = {}) {
  const series = await Series.create({
    sourceId: SOURCE_ID,
    externalId: 'ext-series-1',
    title: '4K-AR: مسلسل الاختبار',
    poster: 'https://cdn.example/poster.jpg',
    isActive: seriesActive,
  });
  const season = await Season.create({
    seriesId: series._id,
    seasonNumber: 2,
    name: 'الموسم الثاني',
  });
  const episode = await Episode.create({
    seriesId: series._id,
    seasonId: season._id,
    externalId: 'ext-ep-1',
    episodeNumber: 3,
    title,
    duration: 2700,
    // A credential-shaped value on purpose: the test proves it never leaves.
    streamUrl: 'http://panel.example:8080/live/user/SECRETPASS/12345.ts',
  });
  return { series, season, episode };
}

describe('GET /catalog/episodes/:id', () => {
  it('returns the episode with the parent labels a card needs', async () => {
    const { episode, season } = await seedEpisode();

    const res = await request(buildApp()).get(`${BASE}/episodes/${episode._id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBe(String(episode._id));
    expect(res.body.data.episodeNumber).toBe(3);
    expect(res.body.data.duration).toBe(2700);
    // Supplier decorations are stripped the same way movie titles are.
    expect(res.body.data.title).toBe('الحلقة الأولى');
    // The parent labels ride along so one call is enough to render the row.
    expect(res.body.data.seriesTitle).toBe('مسلسل الاختبار');
    expect(res.body.data.seriesPoster).toBe('https://cdn.example/poster.jpg');
    expect(res.body.data.seasonName).toBe('الموسم الثاني');
    expect(res.body.data.seasonNumber).toBe(season.seasonNumber);
  });

  it('never leaks the upstream stream URL', async () => {
    const { episode } = await seedEpisode();

    const res = await request(buildApp()).get(`${BASE}/episodes/${episode._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.streamUrl).toBeUndefined();
    // Guard the whole payload, not just the field name: a nested copy would be
    // just as usable as a credential.
    expect(JSON.stringify(res.body)).not.toContain('SECRETPASS');
  });

  it('rejects a malformed id with 400', async () => {
    const res = await request(buildApp()).get(`${BASE}/episodes/not-an-id`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 for an unknown episode id', async () => {
    const unknown = new mongoose.Types.ObjectId();

    const res = await request(buildApp()).get(`${BASE}/episodes/${unknown}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('refuses an episode whose series is no longer listed', async () => {
    const { episode } = await seedEpisode({ seriesActive: false });

    const res = await request(buildApp()).get(`${BASE}/episodes/${episode._id}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    // No parent labels either — a 404 must not carry the de-listed series name.
    expect(JSON.stringify(res.body)).not.toContain('مسلسل الاختبار');
  });

  it('survives a missing season row instead of failing the request', async () => {
    const { episode, season } = await seedEpisode();
    await Season.deleteOne({ _id: season._id });

    const res = await request(buildApp()).get(`${BASE}/episodes/${episode._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.seasonName).toBe('');
    expect(res.body.data.seasonNumber).toBeNull();
  });
});
