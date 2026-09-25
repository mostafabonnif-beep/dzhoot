/**
 * Unified search must answer fast; the EPG branch is the only slow part of it.
 *
 * Measured in production on 2026-09-25: the programme branch cost 3.1s of the
 * endpoint's 4.2s (985k `epgprograms` rows, three-field unanchored regex, no index
 * that can serve it), while movies, series and channels together answered in under
 * 0.5s. The app's search screen calls this endpoint directly, so the delay was
 * user-visible on every keystroke-driven request.
 *
 * The tests pin the contract: programmes are omitted by default and returned when
 * asked for, with the same response shape either way.
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Movie from '../models/Movie';
import EpgProgram from '../models/EpgProgram';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalogRouter = require('../routes/catalog');

const BASE = '/api/v1/catalog';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(BASE, catalogRouter);
  return app;
}

async function seed() {
  await Movie.create({
    sourceId: new mongoose.Types.ObjectId(),
    externalId: 'ext-search-1',
    title: 'اسد الصحراء',
    isActive: true,
    streamUrl: 'http://panel.test/movie/u/p/1.mkv',
  });
  await EpgProgram.create({
    channelEpgId: 'CH1.epg',
    title: 'اسد الليل',
    description: 'برنامج اختباري',
    startTime: new Date(),
    endTime: new Date(Date.now() + 60 * 60 * 1000),
  });
}

const search = (query: Record<string, string>) =>
  request(buildApp()).get(`${BASE}/search`).query(query);

describe('unified catalog search', () => {
  beforeEach(async () => {
    await seed();
  });

  it('answers without the programme branch by default', async () => {
    const res = await search({ q: 'اسد' });

    expect(res.status).toBe(200);
    // The fast branches still work...
    expect(res.body.data.movies.length).toBeGreaterThan(0);
    // ...and the slow one is not on the critical path.
    expect(res.body.data.programs).toEqual([]);
  });

  it('returns programmes when the caller opts in', async () => {
    const res = await search({ q: 'اسد', includePrograms: '1' });

    expect(res.status).toBe(200);
    expect(res.body.data.programs.length).toBeGreaterThan(0);
    expect(res.body.data.programs[0].type).toBe('PROGRAM');
  });

  it('keeps the response shape identical either way', async () => {
    const without = await search({ q: 'اسد' });
    const withPrograms = await search({ q: 'اسد', includePrograms: '1' });

    expect(Object.keys(without.body.data).sort()).toEqual(
      Object.keys(withPrograms.body.data).sort(),
    );
  });
});
