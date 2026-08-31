import ChannelIdentity, { ChannelIdentityMatch } from '../models/ChannelIdentity';
import Channel from '../models/Channel';

export interface ChannelIdentityCandidate {
  identityKey: string;
  normalizedName: string;
  country: string | null;
  match: ChannelIdentityMatch;
  confidence: number;
}

export interface ChannelIdentityStats {
  total: number;
  multiSource: number;
  lowConfidence: number;
  lastReconciledAt: Date | null;
}

export function normalizeChannelName(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedCountry(channel: any): string | null {
  const explicit = normalizeChannelName(channel.metadata?.country);
  if (explicit) return explicit;

  const tvgId = String(channel.tvgId || '').trim();
  const suffix = tvgId.match(/\.([a-z]{2,3})$/i)?.[1];
  return suffix ? normalizeChannelName(suffix) : null;
}

function isSourceGeneratedId(value: string): boolean {
  return !value || value.startsWith('m3u:') || value.startsWith('xt:') || value.startsWith('channel_');
}

export function buildChannelIdentityCandidate(channel: any): ChannelIdentityCandidate | null {
  const normalizedName = normalizeChannelName(channel.channelName);
  if (!normalizedName) return null;

  const tvgId = String(channel.tvgId || '').trim();
  const country = normalizedCountry(channel);
  if (tvgId && !isSourceGeneratedId(tvgId)) {
    return {
      identityKey: `tvg:${normalizeChannelName(tvgId)}`,
      normalizedName,
      country,
      match: 'tvg-id',
      confidence: 0.99,
    };
  }

  if (country) {
    return {
      identityKey: `name-country:${normalizedName}:${country}`,
      normalizedName,
      country,
      match: 'name-country',
      confidence: 0.86,
    };
  }

  const sourceScopedId = normalizeChannelName(channel.channelId) || 'unknown';
  return {
    // Name-only matches are intentionally source-scoped to prevent false merges.
    // They remain visible as low-confidence identities for admin review.
    identityKey: `name:${normalizedName}:${sourceScopedId}`,
    normalizedName,
    country: null,
    match: 'name',
    confidence: 0.72,
  };
}

function sourceReference(channel: any): string {
  const metadata = channel.metadata || {};
  if (metadata.source === 'm3u' && metadata.m3uSourceId) return `m3u:${metadata.m3uSourceId}`;
  if (metadata.source === 'xtream' && metadata.xtreamSourceId) return `xtream:${metadata.xtreamSourceId}`;
  return String(metadata.source || 'unknown');
}

export async function reconcileChannelIdentities(): Promise<{
  identities: number;
  linkedChannels: number;
  multiSource: number;
  lowConfidence: number;
}> {
  const channels = await Channel.find({ ownerId: null, isActive: { $ne: false } })
    .select('channelName channelId tvgId metadata.source metadata.country metadata.language metadata.m3uSourceId metadata.xtreamSourceId')
    .lean();

  const groups = new Map<string, { candidate: ChannelIdentityCandidate; channels: any[] }>();
  for (const channel of channels) {
    const candidate = buildChannelIdentityCandidate(channel);
    if (!candidate) continue;
    const existing = groups.get(candidate.identityKey);
    if (existing) existing.channels.push(channel);
    else groups.set(candidate.identityKey, { candidate, channels: [channel] });
  }

  const now = new Date();
  const identityOps = [];
  const channelOps = [];
  let multiSource = 0;
  let lowConfidence = 0;

  for (const { candidate, channels: groupedChannels } of groups.values()) {
    const channelIds = groupedChannels.map((channel) => channel._id);
    const sourceRefs = [...new Set(groupedChannels.map(sourceReference))];
    const sourceKinds = [...new Set(sourceRefs.map((source) => source.split(':', 1)[0]))];
    const displayName = String(groupedChannels[0].channelName || candidate.normalizedName).trim();
    const language = groupedChannels.map((channel) => channel.metadata?.language).find(Boolean) || null;

    if (sourceRefs.length > 1) multiSource += 1;
    if (candidate.confidence < 0.85) lowConfidence += 1;

    identityOps.push({
      updateOne: {
        filter: { identityKey: candidate.identityKey },
        update: {
          $set: {
            displayName,
            normalizedName: candidate.normalizedName,
            country: candidate.country,
            language,
            channelIds,
            channelCount: channelIds.length,
            sourceKinds,
            sourceCount: sourceRefs.length,
            match: candidate.match,
            confidence: candidate.confidence,
            isActive: true,
            lastReconciledAt: now,
          },
        },
        upsert: true,
      },
    });

    for (const channel of groupedChannels) {
      channelOps.push({
        updateOne: {
          filter: { _id: channel._id },
          update: {
            $set: {
              identityKey: candidate.identityKey,
              identityConfidence: candidate.confidence,
              identityMatch: candidate.match,
            },
          },
        },
      });
    }
  }

  if (identityOps.length > 0) await ChannelIdentity.bulkWrite(identityOps, { ordered: false });
  if (channelOps.length > 0) await Channel.bulkWrite(channelOps, { ordered: false });

  const activeKeys = [...groups.keys()];
  await ChannelIdentity.updateMany(
    activeKeys.length ? { identityKey: { $nin: activeKeys } } : {},
    {
      $set: {
        isActive: false,
        channelIds: [],
        channelCount: 0,
        sourceCount: 0,
        lastReconciledAt: now,
      },
    },
  );

  return {
    identities: groups.size,
    linkedChannels: channelOps.length,
    multiSource,
    lowConfidence,
  };
}

export async function getChannelIdentityStats(): Promise<ChannelIdentityStats> {
  const [total, multiSource, lowConfidence, latest] = await Promise.all([
    ChannelIdentity.countDocuments({ isActive: true }),
    ChannelIdentity.countDocuments({ isActive: true, sourceCount: { $gt: 1 } }),
    ChannelIdentity.countDocuments({ isActive: true, confidence: { $lt: 0.85 } }),
    ChannelIdentity.findOne({ isActive: true }).sort({ lastReconciledAt: -1 }).select('lastReconciledAt').lean(),
  ]);

  return {
    total,
    multiSource,
    lowConfidence,
    lastReconciledAt: latest?.lastReconciledAt || null,
  };
}

module.exports = {
  normalizeChannelName,
  buildChannelIdentityCandidate,
  reconcileChannelIdentities,
  getChannelIdentityStats,
};
