import mongoose from 'mongoose';
import WatchProgress from '../models/WatchProgress';
import {
  upsertProgress,
  listContinueWatching,
  getProgress,
  removeProgress,
  clearProgress,
} from '../services/watch-progress-service';

const USER = new (require('mongoose').Types.ObjectId)().toString();

beforeEach(async () => {
  await WatchProgress.deleteMany({});
});

afterAll(async () => {
  await WatchProgress.deleteMany({});
});

describe('watch-progress-service', () => {
  it('ignores positions below the resume threshold', async () => {
    const doc = await upsertProgress({ userId: USER, contentId: 'm1', contentType: 'movie', positionSec: 5 });
    expect(doc).toBeNull();
    expect(await WatchProgress.countDocuments({})).toBe(0);
  });

  it('upserts and returns the latest position for the same content', async () => {
    await upsertProgress({ userId: USER, contentId: 'm1', contentType: 'movie', positionSec: 120, durationSec: 600 });
    await upsertProgress({ userId: USER, contentId: 'm1', contentType: 'movie', positionSec: 300, durationSec: 600 });
    const rows = await WatchProgress.find({ userId: USER, contentId: 'm1' });
    expect(rows).toHaveLength(1);
    expect(rows[0].positionSec).toBe(300);
  });

  it('marks completed when position reaches 95% of duration', async () => {
    await upsertProgress({ userId: USER, contentId: 'm1', contentType: 'movie', positionSec: 580, durationSec: 600 });
    const row = await WatchProgress.findOne({ userId: USER, contentId: 'm1' });
    expect(row?.completed).toBe(true);
    const list = await listContinueWatching(USER);
    expect(list).toHaveLength(0);
  });

  it('lists active items most-recently-updated first', async () => {
    await upsertProgress({ userId: USER, contentId: 'a', contentType: 'movie', positionSec: 100, durationSec: 600 });
    await new Promise((r) => setTimeout(r, 5));
    await upsertProgress({ userId: USER, contentId: 'b', contentType: 'series', positionSec: 200, durationSec: 600 });
    const list = await listContinueWatching(USER);
    expect(list.map((x) => x.contentId)).toEqual(['b', 'a']);
  });

  it('removes a single item and can clear the whole list', async () => {
    await upsertProgress({ userId: USER, contentId: 'a', contentType: 'movie', positionSec: 100, durationSec: 600 });
    await upsertProgress({ userId: USER, contentId: 'b', contentType: 'movie', positionSec: 100, durationSec: 600 });
    expect(await removeProgress(USER, 'a')).toBe(true);
    expect(await getProgress(USER, 'a')).toBeNull();
    expect(await clearProgress(USER)).toBe(1);
    expect(await WatchProgress.countDocuments({})).toBe(0);
  });
});


beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/dzhoof_test');
  }
});

afterAll(async () => {
  // Leave the connection open for other suites running in parallel.
});
