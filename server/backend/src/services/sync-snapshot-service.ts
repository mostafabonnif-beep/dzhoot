import mongoose from 'mongoose';
import SyncSnapshot, { SyncSnapshotChannel, SyncSourceType } from '../models/SyncSnapshot';
import Channel from '../models/Channel';
import { decryptSecret, encryptSecret } from '../utils/crypto';

export interface SyncDiff {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  blocked: number;
  duplicate: number;
}

export interface SnapshotPreview {
  snapshotId: string;
  sourceType: SyncSourceType;
  sourceId: string;
  status: 'preview';
  channelCount: number;
  diff: SyncDiff;
}

function comparableChannel(channel: any): SyncSnapshotChannel {
  return {
    channelId: String(channel.channelId),
    channelName: String(channel.channelName || ''),
    channelUrlEncrypted: channel.channelUrlEncrypted || encryptSecret(String(channel.channelUrl || '')),
    channelImg: channel.channelImg || channel.tvgLogo || '',
    tvgId: channel.tvgId || '',
    tvgName: channel.tvgName || '',
    channelGroup: channel.channelGroup || 'Uncategorized',
    order: Number(channel.order || 0),
    isActive: channel.isActive !== false,
    metadata: channel.metadata || undefined,
    catchup: channel.catchup || undefined,
    alternateStreams: channel.alternateStreams || [],
  };
}

function channelFingerprint(channel: SyncSnapshotChannel): string {
  return JSON.stringify({
    channelName: channel.channelName,
    channelUrl: (channel as any).channelUrl || decryptSecret(channel.channelUrlEncrypted || ''),
    channelImg: channel.channelImg || '',
    tvgId: channel.tvgId || '',
    tvgName: channel.tvgName || '',
    channelGroup: channel.channelGroup || 'Uncategorized',
    order: channel.order || 0,
    catchup: channel.catchup || null,
    alternateStreams: channel.alternateStreams || [],
  });
}

export function calculateSyncDiff(
  before: SyncSnapshotChannel[],
  after: SyncSnapshotChannel[],
  blocked = 0,
  duplicate = 0,
): SyncDiff {
  const beforeMap = new Map(before.map((channel) => [channel.channelId, channel]));
  const afterMap = new Map(after.map((channel) => [channel.channelId, channel]));
  let changed = 0;
  let unchanged = 0;

  for (const [channelId, next] of afterMap) {
    const previous = beforeMap.get(channelId);
    if (!previous) continue;
    if (channelFingerprint(previous) === channelFingerprint(next)) unchanged += 1;
    else changed += 1;
  }

  return {
    added: [...afterMap.keys()].filter((channelId) => !beforeMap.has(channelId)).length,
    changed,
    removed: [...beforeMap.keys()].filter((channelId) => !afterMap.has(channelId)).length,
    unchanged,
    blocked,
    duplicate,
  };
}

export async function getCurrentSourceChannels(sourceType: SyncSourceType, sourceId: string) {
  const filter = sourceType === 'm3u'
    ? { ownerId: null, 'metadata.m3uSourceId': sourceId }
    : { ownerId: null, 'metadata.xtreamSourceId': sourceId };
  const channels = await Channel.find(filter).select(
    'channelId channelName channelUrl channelImg tvgLogo tvgId tvgName channelGroup order isActive metadata catchup alternateStreams',
  ).lean();
  return channels.map(comparableChannel);
}

export async function createSyncPreview(input: {
  sourceType: SyncSourceType;
  sourceId: string;
  nextChannels: any[];
  blocked?: number;
  duplicate?: number;
  createdBy?: string | null;
}): Promise<SnapshotPreview> {
  const before = await getCurrentSourceChannels(input.sourceType, input.sourceId);
  const after = input.nextChannels.map(comparableChannel);
  const diff = calculateSyncDiff(before, after, input.blocked, input.duplicate);
  const snapshot = await SyncSnapshot.create({
    sourceType: input.sourceType,
    sourceId: new mongoose.Types.ObjectId(input.sourceId),
    status: 'preview',
    channels: before,
    channelCount: before.length,
    diff,
    createdBy: input.createdBy && mongoose.Types.ObjectId.isValid(input.createdBy)
      ? new mongoose.Types.ObjectId(input.createdBy)
      : null,
  });

  return {
    snapshotId: String(snapshot._id),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    status: 'preview',
    channelCount: after.length,
    diff,
  };
}

export async function markSnapshotApplied(snapshotId: string) {
  return SyncSnapshot.findByIdAndUpdate(
    snapshotId,
    { $set: { status: 'applied', appliedAt: new Date() } },
    { new: true },
  ).lean();
}

export async function rollbackSyncSnapshot(snapshotId: string) {
  const snapshot = await SyncSnapshot.findOne({ _id: snapshotId, status: 'applied' }).lean();
  if (!snapshot) throw new Error('Applied sync snapshot not found');

  const sourceFilter = snapshot.sourceType === 'm3u'
    ? { ownerId: null, 'metadata.m3uSourceId': String(snapshot.sourceId) }
    : { ownerId: null, 'metadata.xtreamSourceId': String(snapshot.sourceId) };
  const channelIds = snapshot.channels.map((channel) => channel.channelId);

  await Channel.updateMany(sourceFilter, { $set: { isActive: false } }).exec();
  if (snapshot.channels.length > 0) {
    const restoreOperations = snapshot.channels.map((channel) => {
      const restored: any = { ...channel };
      delete restored.channelUrlEncrypted;
      const restoredMetadata = {
        ...(restored.metadata || {}),
        ...(snapshot.sourceType === 'm3u'
          ? { source: 'm3u', m3uSourceId: String(snapshot.sourceId) }
          : { source: 'xtream', xtreamSourceId: String(snapshot.sourceId) }),
      };
      delete restored.metadata;
      return {
        updateOne: {
          filter: { ownerId: null, channelId: channel.channelId },
          update: {
            $set: {
              ...restored,
              channelUrl: decryptSecret(channel.channelUrlEncrypted),
              ownerId: null,
              isActive: channel.isActive !== false,
              metadata: restoredMetadata,
            },
          },
          upsert: true,
        },
      };
    });
    await Channel.bulkWrite(restoreOperations as any, { ordered: false });
  }

  const updated = await SyncSnapshot.findByIdAndUpdate(
    snapshotId,
    { $set: { status: 'rolled_back', rolledBackAt: new Date() } },
    { new: true },
  ).lean();

  return {
    snapshotId,
    sourceType: snapshot.sourceType,
    sourceId: String(snapshot.sourceId),
    restoredChannels: channelIds.length,
    status: updated?.status || 'rolled_back',
  };
}

export async function listSyncSnapshots(sourceType: SyncSourceType, sourceId: string, limit = 10) {
  return SyncSnapshot.find({ sourceType, sourceId })
    .select('-channels')
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 50))
    .lean();
}

module.exports = {
  calculateSyncDiff,
  getCurrentSourceChannels,
  createSyncPreview,
  markSnapshotApplied,
  rollbackSyncSnapshot,
  listSyncSnapshots,
};
