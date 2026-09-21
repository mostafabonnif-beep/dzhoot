import mongoose from 'mongoose';
import SyncSnapshot from '../models/SyncSnapshot';
import Channel from '../models/Channel';
import SyncSnapshotChunk from '../models/SyncSnapshotChunk';
import {
  calculateSyncDiff,
  createSyncPreview,
  loadSnapshotChannels,
  markSnapshotApplied,
  rollbackSyncSnapshot,
} from './sync-snapshot-service';

describe('sync snapshot service', () => {
  const before = [
    {
      channelId: 'one',
      channelName: 'One',
      channelUrl: 'https://one.example/live.m3u8',
      channelGroup: 'News',
    },
    {
      channelId: 'removed',
      channelName: 'Removed',
      channelUrl: 'https://removed.example/live.m3u8',
      channelGroup: 'News',
    },
  ];

  it('calculates added, changed, removed and unchanged channels', () => {
    const diff = calculateSyncDiff(
      before as any,
      [
        { ...before[0], channelUrl: 'https://changed.example/live.m3u8' },
        { channelId: 'added', channelName: 'Added', channelUrl: 'https://added.example/live.m3u8' },
      ] as any,
    );

    expect(diff).toMatchObject({ added: 1, changed: 1, removed: 1, unchanged: 0 });
  });

  it('creates an encrypted snapshot and restores channels on rollback', async () => {
    const sourceId = new mongoose.Types.ObjectId();
    const created = await Channel.create({
      channelId: 'rollback-one',
      channelName: 'Rollback One',
      channelUrl: 'https://before.example/live.m3u8',
      ownerId: null,
      metadata: { source: 'm3u', m3uSourceId: String(sourceId) },
    });

    const preview = await createSyncPreview({
      sourceType: 'm3u',
      sourceId: String(sourceId),
      nextChannels: [{
        channelId: 'rollback-one',
        channelName: 'Rollback One New',
        channelUrl: 'https://after.example/live.m3u8',
        metadata: { source: 'm3u', m3uSourceId: String(sourceId) },
      }],
    });
    const snapshot: any = await SyncSnapshot.findById(preview.snapshotId).lean();
    // The channel list lives in chunk documents (see SyncSnapshotChunk): one document per
    // snapshot cannot hold a real catalog, and that is what made every sync of a large source
    // fail with "BSONObj size ... is invalid".
    const stored = await loadSnapshotChannels(snapshot);

    expect(snapshot.channels).toEqual([]);
    expect(stored[0].channelUrlEncrypted).toBeDefined();
    expect(JSON.stringify(snapshot)).not.toContain('before.example');

    await markSnapshotApplied(preview.snapshotId);
    await Channel.updateOne({ _id: created._id }, { $set: { channelUrl: 'https://after.example/live.m3u8' } });
    const result = await rollbackSyncSnapshot(preview.snapshotId);
    const restored: any = await Channel.findById(created._id).lean();

    expect(result.status).toBe('rolled_back');
    expect(restored.channelUrl).toBe('https://before.example/live.m3u8');
    expect(restored.channelName).toBe('Rollback One');
  });

  it('chunks a catalog too large for one document, and rolls it back from the chunks', async () => {
    const sourceId = new mongoose.Types.ObjectId();
    // 4,500 channels is past the chunk size and stands in for the production case (16k
    // channels / ~17MB) that MongoDB refused. Seeded through the raw collection: this test is
    // about snapshot mechanics, not schema defaults.
    const docs = Array.from({ length: 4500 }, (_, i) => ({
      channelId: `bulk-${i}`,
      channelName: `Bulk ${i}`,
      channelUrl: `https://bulk.example/${i}.m3u8`,
      ownerId: null,
      isActive: true,
      metadata: { source: 'm3u', m3uSourceId: String(sourceId) },
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await Channel.collection.insertMany(docs);

    const preview = await createSyncPreview({
      sourceType: 'm3u',
      sourceId: String(sourceId),
      nextChannels: docs.slice(0, 10),
    });

    const chunks = await SyncSnapshotChunk.find({ snapshotId: preview.snapshotId }).sort({ index: 1 }).lean();
    expect(chunks.length).toBe(3);
    const snapshot: any = await SyncSnapshot.findById(preview.snapshotId).lean();
    expect(snapshot.channelCount).toBe(4500);
    // The reason for chunking: no single document may approach the 16MB cap.
    expect(Buffer.byteLength(JSON.stringify(chunks[0]))).toBeLessThan(8 * 1024 * 1024);

    const restored = await loadSnapshotChannels(snapshot);
    expect(restored.length).toBe(4500);

    await markSnapshotApplied(preview.snapshotId);
    const result = await rollbackSyncSnapshot(preview.snapshotId);
    expect(result.restoredChannels).toBe(4500);
    expect(await Channel.countDocuments({ 'metadata.m3uSourceId': String(sourceId), isActive: true })).toBe(4500);
  });
});
