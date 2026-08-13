import axios from 'axios';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import mongoose from 'mongoose';
import M3USource from '../models/M3USource';
import Channel from '../models/Channel';
import { clubByChannelId, extractExtinfTitle, resolveChannelGroups } from './import-helpers';
import { decryptSecret, encryptSecret } from '../utils/crypto';
import { createPinnedLookup, validateUrlForSSRF } from '../utils/ssrf-guard';
import { redactSensitiveText } from './audit-log';

const PLAYLIST_TIMEOUT_MS = 30000;
const MAX_PLAYLIST_BYTES = 50 * 1024 * 1024;
const MAX_PLAYLIST_LINES = 100000;
const SSRF_CONCURRENCY = 20;

export interface M3UCredentials {
  playlistUrl: string;
  epgUrl?: string | null;
}

function readAttribute(line: string, attribute: string): string {
  const match = line.match(new RegExp(`${attribute}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return String(match?.[1] ?? match?.[2] ?? '').trim();
}

function stableId(sourceId: string, value: string): string {
  return crypto.createHash('sha256').update(`${sourceId}:${value}`).digest('hex').slice(0, 32);
}

export function parseM3U(content: string, sourceId: string): any[] {
  if (Buffer.byteLength(content, 'utf8') > MAX_PLAYLIST_BYTES) {
    throw new Error('M3U playlist exceeds the 50MB limit');
  }

  const lines = content.split(/\r?\n/);
  if (lines.length > MAX_PLAYLIST_LINES) {
    throw new Error('M3U playlist has too many lines');
  }

  const channels: any[] = [];
  let pending: any | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const tvgId = readAttribute(line, 'tvg-id');
      const tvgName = readAttribute(line, 'tvg-name');
      const tvgLogo = readAttribute(line, 'tvg-logo');
      const groupTitle = readAttribute(line, 'group-title');
      const displayName = extractExtinfTitle(line);
      // Catch-up / timeshift attributes (IPTV catchup spec).
      // catchup-source may embed credentials — stored server-side only, never
      // exposed through the API (see routes/channels.js slimAlternates).
      const catchupType = readAttribute(line, 'catchup');
      const catchupDaysRaw = readAttribute(line, 'catchup-days');
      const catchupDays = catchupDaysRaw ? Number.parseInt(catchupDaysRaw, 10) : NaN;

      pending = {
        channelId: tvgId ? `m3u:${sourceId}:${stableId(sourceId, `tvg:${tvgId}`)}` : '',
        tvgId,
        tvgName,
        channelImg: tvgLogo,
        tvgLogo,
        channelGroup: groupTitle || 'Uncategorized',
        channelName: displayName || tvgName || 'Unknown',
        order: channels.length,
      };
      if (catchupType) {
        pending.catchup = {
          type: catchupType,
          source: readAttribute(line, 'catchup-source') || null,
          days: Number.isFinite(catchupDays) && catchupDays > 0 ? catchupDays : null,
        };
      }
      continue;
    }

    if (pending && !line.startsWith('#')) {
      pending.channelUrl = line;
      if (!pending.channelId) {
        pending.channelId = `m3u:${sourceId}:${stableId(sourceId, `url:${line}`)}`;
      }
      channels.push(pending);
      pending = null;
    }
  }

  return channels;
}

async function validateUrls(urls: string[]): Promise<{ safe: any[]; blocked: number }> {
  const safe: any[] = [];
  let blocked = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      const result = await validateUrlForSSRF(urls[index]);
      if (result.safe) safe.push({ index, resolvedAddresses: result.resolvedAddresses });
      else blocked += 1;
    }
  };

  await Promise.all(Array.from({ length: Math.min(SSRF_CONCURRENCY, Math.max(urls.length, 1)) }, () => worker()));
  return { safe, blocked };
}

async function downloadText(url: string): Promise<{ content: string; resolvedAddresses: string[] }> {
  const validation = await validateUrlForSSRF(url);
  if (!validation.safe || !validation.resolvedAddresses?.length) {
    throw new Error(`Playlist URL rejected: ${validation.reason || 'unsafe URL'}`);
  }

  const parsed = new URL(url);
  const lookup = createPinnedLookup(validation.resolvedAddresses);
  const agent = parsed.protocol === 'https:'
    ? new https.Agent({ lookup: lookup as any })
    : new http.Agent({ lookup: lookup as any });

  const response = await axios.get<string>(url, {
    timeout: PLAYLIST_TIMEOUT_MS,
    responseType: 'text',
    maxContentLength: MAX_PLAYLIST_BYTES,
    maxBodyLength: MAX_PLAYLIST_BYTES,
    maxRedirects: 0,
    httpAgent: parsed.protocol === 'http:' ? agent : undefined,
    httpsAgent: parsed.protocol === 'https:' ? agent : undefined,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  return { content: response.data, resolvedAddresses: validation.resolvedAddresses };
}

async function upsertChannel(sourceId: mongoose.Types.ObjectId, channel: any) {
  return Channel.findOneAndUpdate(
    { ownerId: null, channelId: channel.channelId },
    {
      $set: {
        ...channel,
        isActive: true,
        'metadata.source': 'm3u',
        'metadata.m3uSourceId': String(sourceId),
      },
    },
    { upsert: true, setDefaultsOnInsert: true, new: true },
  ).exec();
}

export async function testM3UConnection(url: string) {
  try {
    const { content } = await downloadText(url);
    const channels = parseM3U(content, 'test');
    return { ok: channels.length > 0, channelCount: channels.length, error: channels.length ? null : 'No valid channels found' };
  } catch (error: any) {
    return { ok: false, channelCount: 0, error: error.message || 'M3U connection failed' };
  }
}

export async function syncM3USource(sourceId: string) {
  const source = await M3USource.findById(sourceId).exec();
  if (!source) throw new Error('M3U source not found');
  if (source.status !== 'Active') throw new Error('M3U source is inactive');
  if (source.syncStatus === 'syncing') throw new Error('Sync already in progress');

  source.syncStatus = 'syncing';
  source.lastError = null;
  await source.save();

  try {
    const playlistUrl = decryptSecret(source.playlistUrlEncrypted);
    const { content } = await downloadText(playlistUrl);
    const parsed = parseM3U(content, String(source._id));
    const validation = await validateUrls(parsed.map((channel) => channel.channelUrl));
    const safeIndexes = new Set(validation.safe.map((entry) => entry.index));
    const safeChannels = parsed.filter((_, index) => safeIndexes.has(index));

    const clubbed = clubByChannelId(safeChannels);
    await resolveChannelGroups(clubbed);

    for (const channel of clubbed) {
      await upsertChannel(source._id, channel);
    }

    const activeIds = clubbed.map((channel) => channel.channelId);
    await Channel.updateMany(
      {
        ownerId: null,
        'metadata.m3uSourceId': String(source._id),
        channelId: { $nin: activeIds },
      },
      { $set: { isActive: false } },
    ).exec();

    const stats = {
      channels: clubbed.length,
      blocked: validation.blocked,
      duplicates: Math.max(0, safeChannels.length - clubbed.length),
    };
    source.stats = stats;
    source.syncStatus = 'idle';
    source.lastSyncAt = new Date();
    await source.save();

    return { ok: true, stats };
  } catch (error: any) {
    source.syncStatus = 'error';
    source.lastError = redactSensitiveText(error);
    await source.save();
    throw error;
  }
}

export function createM3USourceSecrets(playlistUrl: string, epgUrl?: string | null) {
  return {
    playlistUrlEncrypted: encryptSecret(playlistUrl),
    epgUrlEncrypted: epgUrl ? encryptSecret(epgUrl) : null,
  };
}

export { decryptSecret };

module.exports = {
  parseM3U,
  testM3UConnection,
  syncM3USource,
  createM3USourceSecrets,
  decryptSecret,
};
