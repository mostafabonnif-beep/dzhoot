/**
 * The home screen must never show an empty featured rail.
 *
 * Measured in production on 2026-09-25: there was no `home` AppSetting at all, so
 * `featuredChannels`, `featuredMovies` and `featuredSeries` all came back empty while
 * the catalog held 84,545 movies and 25,968 channels. Three of the five sections a
 * customer sees first were holes, and nothing in the response said why.
 *
 * The tests pin both halves: a configured list still wins, and an absent or stale
 * configuration is filled with the newest eligible titles instead of nothing.
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import AppSetting from '../models/AppSetting';
import Movie from '../models/Movie';
import Series from '../models/Series';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const homeRouter = require('../routes/home');

const BASE = '/api/v1/home';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(BASE, homeRouter);
  return app;
}

async function seedCatalog() {
  const sourceId = new mongoose.Types.ObjectId();
  const movies = await Movie.create([
    { sourceId, externalId: 'm1', title: 'فيلم أول', isActive: true, poster: 'http://cdn/p1.jpg', streamUrl: 'http://panel/m/1.mkv' },
    { sourceId, externalId: 'm2', title: 'فيلم ثانٍ', isActive: true, poster: 'http://cdn/p2.jpg', streamUrl: 'http://panel/m/2.mkv' },
  ]);
  const series = await Series.create([
    { sourceId, externalId: 's1', title: 'مسلسل أول', isActive: true, poster: 'http://cdn/s1.jpg' },
  ]);
  return { movies, series };
}

describe('home rails', () => {
  it('fills the featured rails from the newest titles when no configuration exists', async () => {
    const { movies } = await seedCatalog();

    const res = await request(buildApp()).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body.data.featuredMovies.length).toBe(movies.length);
    expect(res.body.data.featuredSeries.length).toBeGreaterThan(0);
    // The payload keeps the same shape consumers already parse.
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['featuredChannels', 'featuredMovies', 'featuredSeries', 'latestMovies', 'latestSeries'].sort(),
    );
  });

  it('still honours an operator-selected featured list', async () => {
    const { movies } = await seedCatalog();
    await AppSetting.create({
      key: 'home',
      value: { featuredMovieIds: [String(movies[1]._id)] },
    });

    const res = await request(buildApp()).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body.data.featuredMovies).toHaveLength(1);
    expect(res.body.data.featuredMovies[0]._id).toBe(String(movies[1]._id));
  });

  it('falls back when the configured ids no longer resolve', async () => {
    await seedCatalog();
    await AppSetting.create({
      key: 'home',
      value: { featuredMovieIds: [String(new mongoose.Types.ObjectId())] },
    });

    const res = await request(buildApp()).get(BASE);

    expect(res.status).toBe(200);
    // Stale configuration must not empty the screen, and the rail reports what it holds.
    expect(res.body.data.featuredMovies.length).toBeGreaterThan(0);
  });
});
