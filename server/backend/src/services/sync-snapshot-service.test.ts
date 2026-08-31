import mongoose from 'mongoose';
import SyncSnapshot from '../models/SyncSnapshot';
import Channel from '../models/Channel';
import {
  calculateSyncDiff,
  createSyncPreview,
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

    expect(snapshot.channels[0].channelUrlEncrypted).toBeDefined();
    expect(JSON.stringify(snapshot)).not.toContain('before.example');

    await markSnapshotApplied(preview.snapshotId);
    await Channel.updateOne({ _id: created._id }, { $set: { channelUrl: 'https://after.example/live.m3u8' } });
    const result = await rollbackSyncSnapshot(preview.snapshotId);
    const restored: any = await Channel.findById(created._id).lean();

    expect(result.status).toBe('rolled_back');
    expect(restored.channelUrl).toBe('https://before.example/live.m3u8');
    expect(restored.channelName).toBe('Rollback One');
  });
});
