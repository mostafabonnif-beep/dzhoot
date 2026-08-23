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
import { reconcileChannelIdentities } from './channel-identity-service';
import { createSyncPreview, markSnapshotApplied } from './sync-snapshot-service';

const PLAYLIST_TIMEOUT_MS = 30000;
const MAX_PLAYLIST_BYTES = 50 * 1024 * 1024;
const MAX_PLAYLIST_LINES = 100000;
const SSRF_CONCURRENCY = 20;
const PLAYBACK_PROBE_COUNT = 5;
const PLAYBACK_PROBE_BYTES = 64 * 1024;

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

async function probeStream(url: string): Promise<{ ok: boolean; format: 'hls' | 'ts' | null; httpStatus: number | null; bytes: number; latencyMs: number; reason?: string }> {
  const startedAt = Date.now();
  try {
    const validation = await validateUrlForSSRF(url);
    if (!validation.safe || !validation.resolvedAddresses?.length) {
      return { ok: false, format: null, httpStatus: null, bytes: 0, latencyMs: Date.now() - startedAt, reason: validation.reason || 'unsafe URL' };
    }
    const parsed = new URL(url);
    const lookup = createPinnedLookup(validation.resolvedAddresses);
    const agent = parsed.protocol === 'https:'
      ? new https.Agent({ lookup: lookup as any })
      : new http.Agent({ lookup: lookup as any });
    const response = await axios.get<ArrayBuffer>(url, {
      timeout: 12000,
      responseType: 'arraybuffer',
      maxContentLength: PLAYBACK_PROBE_BYTES,
      maxBodyLength: PLAYBACK_PROBE_BYTES,
      maxRedirects: 0,
      headers: { Range: `bytes=0-${PLAYBACK_PROBE_BYTES - 1}`, 'User-Agent': 'DZ-HOOF/1.0' },
      httpAgent: parsed.protocol === 'http:' ? agent : undefined,
      httpsAgent: parsed.protocol === 'https:' ? agent : undefined,
      validateStatus: () => true,
    });
    const bytes = Buffer.from(response.data || new ArrayBuffer(0));
    const text = bytes.toString('utf8', 0, Math.min(bytes.length, 256)).trimStart();
    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
    const isHls = text.startsWith('#EXTM3U') || contentType.includes('mpegurl');
    const isTs = bytes.length > 0 && bytes[0] === 0x47;
    return {
      ok: response.status >= 200 && response.status < 300 && (isHls || isTs),
      format: isHls ? 'hls' : isTs ? 'ts' : null,
      httpStatus: response.status,
      bytes: bytes.length,
      latencyMs: Date.now() - startedAt,
      reason: response.status >= 300 ? `HTTP ${response.status}` : (!isHls && !isTs ? 'response is not HLS or MPEG-TS' : undefined),
    };
  } catch (error: any) {
    return { ok: false, format: null, httpStatus: null, bytes: 0, latencyMs: Date.now() - startedAt, reason: redactSensitiveText(error?.message || 'probe failed') };
  }
}

export function classifyPlaybackHealth(results: Array<{ ok: boolean; httpStatus: number | null }>) {
  const playable = results.filter((result) => result.ok).length;
  const blocked = results.filter((result) => result.httpStatus === 401 || result.httpStatus === 403).length;
  return playable > 0
    ? (playable < results.length ? 'DEGRADED' : 'ONLINE')
    : blocked > 0
      ? 'BLOCKED'
      : results.some((result) => result.httpStatus === 408 || result.httpStatus === 504)
        ? 'TIMEOUT'
        : results.some((result) => result.httpStatus && result.httpStatus >= 500)
          ? 'OFFLINE'
          : 'INVALID_STREAM';
}

async function probeChannels(channels: any[]) {
  const samples = channels.slice(0, PLAYBACK_PROBE_COUNT);
  const results = await Promise.all(samples.map((channel) => probeStream(channel.channelUrl)));
  const statuses = results.map((result) => result.httpStatus).filter((status): status is number => Number.isFinite(status));
  const playable = results.filter((result) => result.ok).length;
  const healthStatus = classifyPlaybackHealth(results);
  return {
    checked: results.length,
    playable,
    formats: results.filter((result) => result.ok).map((result) => result.format),
    healthStatus,
    httpStatus: statuses[0] ?? null,
    latencyMs: results.length ? Math.max(...results.map((result) => result.latencyMs)) : null,
    results,
  };
}

async function upsertChannel(sourceId: mongoose.Types.ObjectId, channel: any) {
  const fields: Record<string, any> = {
    ...channel,
    isActive: true,
    'metadata.source': 'm3u',
    'metadata.m3uSourceId': String(sourceId),
  };
  // Preserve an operator-assigned tvgId when the playlist omits/empties one:
  // a playlist without a tvg-id attribute (or with tvg-id="") must not wipe
  // manual EPG mappings on every scheduled sync.
  if (!fields.tvgId) delete fields.tvgId;
  return Channel.findOneAndUpdate(
    { ownerId: null, channelId: channel.channelId },
    { $set: fields },
    { upsert: true, setDefaultsOnInsert: true, new: true },
  ).exec();
}

export async function testM3UConnection(url: string) {
  try {
    const { content } = await downloadText(url);
    const channels = parseM3U(content, 'test');
    if (!channels.length) return { ok: false, channelCount: 0, playableSampleCount: 0, error: 'No valid channels found' };
    const playback = await probeChannels(channels);
    const ok = playback.playable > 0;
    return {
      ok,
      channelCount: channels.length,
      playableSampleCount: playback.playable,
      playback,
      error: ok ? null : 'No tested M3U stream is playable from the server',
    };
  } catch (error: any) {
    return { ok: false, channelCount: 0, playableSampleCount: 0, error: error.message || 'M3U connection failed' };
  }
}

async function prepareM3USync(source: any) {
  const playlistUrl = decryptSecret(source.playlistUrlEncrypted);
  const { content } = await downloadText(playlistUrl);
  const parsed = parseM3U(content, String(source._id));
  const validation = await validateUrls(parsed.map((channel) => channel.channelUrl));
  const safeIndexes = new Set(validation.safe.map((entry) => entry.index));
  const safeChannels = parsed.filter((_, index) => safeIndexes.has(index));
  const playback = await probeChannels(safeChannels);
  const clubbed = clubByChannelId(safeChannels);
  await resolveChannelGroups(clubbed);
  return {
    clubbed,
    blocked: validation.blocked,
    duplicates: Math.max(0, safeChannels.length - clubbed.length),
    playback,
  };
}

export async function previewM3USource(sourceId: string, createdBy?: string | null) {
  const source = await M3USource.findById(sourceId).exec();
  if (!source) throw new Error('M3U source not found');
  if (source.status !== 'Active') throw new Error('M3U source is inactive');
  if (source.syncStatus === 'syncing') throw new Error('Sync already in progress');
  const prepared = await prepareM3USync(source);
  const preview = await createSyncPreview({
    sourceType: 'm3u',
    sourceId: String(source._id),
    nextChannels: prepared.clubbed,
    blocked: prepared.blocked,
    duplicate: prepared.duplicates,
    createdBy,
  });
  return {
    ...preview,
    stats: {
      channels: prepared.clubbed.length,
      blocked: prepared.blocked,
      duplicates: prepared.duplicates,
      playback: prepared.playback,
    },
  };
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
    const prepared = await prepareM3USync(source);
    if (!prepared.playback.playable) {
      throw new Error('No tested M3U stream is playable from the server');
    }
    const clubbed = prepared.clubbed;
    const preview = await createSyncPreview({
      sourceType: 'm3u',
      sourceId: String(source._id),
      nextChannels: clubbed,
      blocked: prepared.blocked,
      duplicate: prepared.duplicates,
    });

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
      {
        $set: {
          isActive: false,
          identityKey: null,
          identityConfidence: null,
          identityMatch: null,
        },
      },
    ).exec();

    const identity = await reconcileChannelIdentities();
    await markSnapshotApplied(preview.snapshotId);
    const stats = {
      channels: clubbed.length,
      blocked: prepared.blocked,
      duplicates: prepared.duplicates,
      playback: prepared.playback,
    };
    source.stats = stats;
    source.syncStatus = 'idle';
    source.lastSyncAt = new Date();
    await source.save();

    return { ok: true, stats, identity };
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
  previewM3USource,
  probeStream,
  classifyPlaybackHealth,
  createM3USourceSecrets,
  decryptSecret,
};
