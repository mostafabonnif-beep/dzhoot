/**
 * GET /api/v1/catalog/movies/categories and .../series/categories.
 *
 * The invariant these cover: **one response must never carry the same category name
 * twice.** The Android catalog rail keys its lazy list by name
 * (`items(items = ordered, key = { it.name })` in `CatalogScreen.kt`), so two buckets that
 * map onto one name do not merely duplicate a row — they throw
 * `IllegalArgumentException: Key "Uncategorized" was already used` while composing, and take
 * the whole screen down with them.
 *
 * Two raw group keys collapse onto the served name "Uncategorized": a document whose
 * `category` is null/empty/absent, and one whose stored value is the literal
 * 'Uncategorized'. Both shapes exist in production (the literal is the schema default and
 * the ingest fallback; a missing value is what an import with no group title writes).
 * Grouping on `'$category'` bucketed them separately, so the response could carry two
 * entries with the same name.
 *
 * The seeding here goes through the raw collection on purpose: `create()` would let the
 * schema default rewrite `null` into 'Uncategorized', which would make the case pass
 * without ever exercising the collapse.
 *
 * Mongo is provided by the global src/test/setup.ts (mongodb-memory-server).
 */
import request from 'supertest';
import express from 'express';

// The route modules are CommonJS, so they are required rather than imported — but the two
// ES imports above are load-bearing beyond ergonomics: they are what makes this file a
// module. Without them every top-level `const` here lands in the global scope and collides
// with the other script-scoped test files, and `tsc --noEmit` (CI runs it) fails with TS2451
// reported against *their* lines.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mongoose = require('mongoose');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Movie = require('../models/Movie');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Series = require('../models/Series');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const router = require('../routes/catalog');

const app = express();
app.use('/api/v1/catalog', router);

const sourceId = new mongoose.Types.ObjectId();
const BASE = { sourceId, isActive: true, streamUrl: 'https://example.invalid/x.mp4' };

/** A row of the category response. */
type CategoryRow = { name: string; count: number };

/** The property the Android rail depends on: no name appears twice. */
function expectUniqueNames(data: CategoryRow[]): string[] {
  const names = data.map((c) => c.name);
  expect(new Set(names).size).toBe(names.length);
  return names;
}

describe('catalog category endpoints', () => {
  beforeEach(async () => {
    await Movie.collection.deleteMany({});
    await Series.collection.deleteMany({});
  });

  describe('GET /movies/categories', () => {
    it('serves ONE entry however many raw shapes reach the same name', async () => {
      await Movie.collection.insertMany([
        { ...BASE, externalId: 'm1', title: 'A', category: 'Uncategorized' },
        { ...BASE, externalId: 'm2', title: 'B', category: null },
        { ...BASE, externalId: 'm3', title: 'C', category: '' },
        { ...BASE, externalId: 'm4', title: 'D' }, // no `category` key at all
      ]);

      // Guard the premise: the four documents must really be stored as four different raw
      // values, otherwise this case would prove nothing about the collapse.
      const rawValues = (
        await Movie.collection.find({}, { projection: { category: 1 } }).toArray()
      ).map((d: { category?: unknown }) => String(d.category));
      expect(new Set(rawValues).size).toBe(4);

      const res = await request(app).get('/api/v1/catalog/movies/categories');

      expect(res.status).toBe(200);
      expect(expectUniqueNames(res.body.data)).toEqual(['Uncategorized']);
      expect(res.body.data[0].count).toBe(4);
    });

    it('keeps genuinely different names apart and never duplicates a name', async () => {
      await Movie.collection.insertMany([
        { ...BASE, externalId: 'm1', title: 'A', category: 'رياضة' },
        { ...BASE, externalId: 'm2', title: 'B', category: 'رياضة' },
        { ...BASE, externalId: 'm3', title: 'C', category: 'أفلام' },
        { ...BASE, externalId: 'm4', title: 'D', category: null },
      ]);

      const res = await request(app).get('/api/v1/catalog/movies/categories');

      expect(res.status).toBe(200);
      const names = expectUniqueNames(res.body.data);
      expect(names).toContain('رياضة');
      expect(names).toContain('أفلام');
      expect(names).toContain('Uncategorized');
      const byName = Object.fromEntries(
        (res.body.data as CategoryRow[]).map((c) => [c.name, c.count]),
      );
      expect(byName['رياضة']).toBe(2);
      expect(byName['Uncategorized']).toBe(1);
    });

    it('ignores inactive titles', async () => {
      await Movie.collection.insertMany([
        { ...BASE, externalId: 'm1', title: 'A', category: 'رياضة' },
        { ...BASE, externalId: 'm2', title: 'B', category: 'رياضة', isActive: false },
      ]);

      const res = await request(app).get('/api/v1/catalog/movies/categories');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ name: 'رياضة', count: 1 }]);
    });
  });

  describe('GET /series/categories', () => {
    it('serves ONE entry however many raw shapes reach the same name', async () => {
      await Series.collection.insertMany([
        { ...BASE, externalId: 's1', title: 'A', category: 'Uncategorized' },
        { ...BASE, externalId: 's2', title: 'B', category: null },
        { ...BASE, externalId: 's3', title: 'C', category: '' },
      ]);

      const res = await request(app).get('/api/v1/catalog/series/categories');

      expect(res.status).toBe(200);
      expect(expectUniqueNames(res.body.data)).toEqual(['Uncategorized']);
      expect(res.body.data[0].count).toBe(3);
    });

    it('keeps genuinely different names apart and never duplicates a name', async () => {
      await Series.collection.insertMany([
        { ...BASE, externalId: 's1', title: 'A', category: 'دراما' },
        { ...BASE, externalId: 's2', title: 'B', category: 'دراما' },
        { ...BASE, externalId: 's3', title: 'C', category: null },
      ]);

      const res = await request(app).get('/api/v1/catalog/series/categories');

      expect(res.status).toBe(200);
      const names = expectUniqueNames(res.body.data);
      expect(names.length).toBe(2);
      const byName = Object.fromEntries(
        (res.body.data as CategoryRow[]).map((c) => [c.name, c.count]),
      );
      expect(byName['دراما']).toBe(2);
      expect(byName['Uncategorized']).toBe(1);
    });
  });
});

