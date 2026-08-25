import axios from 'axios';
import mongoose from 'mongoose';
import XtreamSource from '../models/XtreamSource';
import ChannelFailoverMap from '../models/ChannelFailoverMap';
import Channel from '../models/Channel';
import { decryptSecret } from '../utils/crypto';
import { testXtreamConnection, buildXtreamApiUrl } from './xtream-service';
import { probeStream } from './stream-prober';
import { sendOperationalAlert } from './alert-notifier';
import { normalizeChannelName } from './channel-identity-service';

/**
 * Source auto-failover (بطاقة «مصدر احتياطي تلقائي»):
 *
 * The catalog lives on a primary Xtream source (Business Cloud NEO). When that
 * source goes down, EVERY channel dies because they all share it. This service
 * adds a watchdog that light-probes the active sources, and a side map
 * (ChannelFailoverMap) that lets the playback-token flow re-point a channel to
 * a verified backup source (ottstreambox) within seconds — no app update.
 *
 * Rules (from the feasibility report):
 *  - Catch-up NEVER fails over (the backup has no catch-up).
 *  - Only channels WITH a mapping switch; unmapped channels stay on NEO.
 *  - Sessions in flight are untouched; only NEW playback-token requests switch
 *    (that is what makes the return to NEO gradual — no flapping).
 *  - The watchdog probes the API every 60s and a live stream at most every 5min.
 */

export type SourceHealth = 'verified' | 'degraded' | 'blocked' | 'unknown';

interface HealthCacheEntry {
  health: SourceHealth;
  checkedAt: number;
}

const HEALTH_CACHE_TTL_MS = 60 * 1000;

const healthCache = new Map<string, HealthCacheEntry>();
const lastAlertedHealth = new Map<string, SourceHealth>();

/** Build the HLS live URL for a stream on a given Xtream source. */
export function buildFailoverStreamUrl(
  creds: { serverUrl: string; username: string; password: string },
  streamId: string | number,
): string {
  return `${creds.serverUrl.replace(/\/+$/, '')}/live/${creds.username}/${creds.password}/${streamId}.m3u8`;
}

function mapDbStatusToHealth(status: string | undefined | null): SourceHealth {
  if (status === 'verified') return 'verified';
  if (status === 'degraded') return 'degraded';
  if (status === 'blocked') return 'blocked';
  return 'unknown';
}

/** Cached health of a source (falls back to the persisted verificationStatus). */
export async function getSourceHealth(sourceId: string): Promise<SourceHealth> {
  const key = String(sourceId);
  const cached = healthCache.get(key);
  if (cached && Date.now() - cached.checkedAt < HEALTH_CACHE_TTL_MS) {
    return cached.health;
  }
  const source = await XtreamSource.findById(sourceId).select('verificationStatus').lean().exec();
  const health = mapDbStatusToHealth(source?.verificationStatus);
  healthCache.set(key, { health, checkedAt: Date.now() });
  return health;
}

/** True only when the source is explicitly DOWN (degraded or blocked). */
export async function isSourceDown(sourceId: string): Promise<boolean> {
  const health = await getSourceHealth(sourceId);
  return health === 'degraded' || health === 'blocked';
}

/**
 * Resolve a failover target for a channel, or null.
 * Returns the backup stream URL + the backup source (for the direct flag).
 */
export async function getFailoverTarget(
  channel: { _id: mongoose.Types.ObjectId | string; channelId?: string; metadata?: any },
  primarySourceId?: string | mongoose.Types.ObjectId | null,
): Promise<{ streamUrl: string; source: any } | null> {
  const mapFilter: Record<string, unknown> = { enabled: true };
  const orClauses: Record<string, unknown>[] = [];
  if (channel.channelId) orClauses.push({ channelRef: String(channel.channelId) });
  if (channel._id) orClauses.push({ channelId: channel._id });
  if (orClauses.length === 0) return null;
  mapFilter.$or = orClauses;
  if (primarySourceId) mapFilter.backupSourceId = { $ne: primarySourceId };

  const map = await ChannelFailoverMap.findOne(mapFilter).sort({ updatedAt: -1 }).lean().exec();
  if (!map) return null;

  // Backup sources are added with status Inactive + directPlayback true (so the
  // setup never disturbs live streams) — eligible via the same rule as above.
  const source = await XtreamSource.findOne({
    _id: map.backupSourceId,
    $or: [{ status: 'Active' }, { directPlayback: true }],
  }).lean().exec();
  if (!source) return null;

  // Never fail over to a backup that is itself down.
  const health = await getSourceHealth(String(source._id));
  if (health !== 'verified') return null;

  return {
    streamUrl: buildFailoverStreamUrl(getSourceCreds(source), map.backupStreamId),
    source,
  };
}

/**
 * Light probe for one source.
 *
 * Direct-playback sources (NEO primary, ottstreambox backup) are judged by the
 * STREAM customers actually use — the primary probes one of its own catalog
 * channels, the backup probes a mapped stream. The server-side API reachability
 * is NOT customer-relevant for direct playback (NEO's API is unreachable from
 * this server while its CDN streams work fine — a TLS block on the API domain).
 *
 * Proxy-mode sources relay playback through the server, so their API
 * reachability IS the customer-relevant signal and is probed directly.
 */
async function probeSource(source: any): Promise<{ health: SourceHealth; error: string | null; latencyMs: number }> {
  const started = Date.now();

  if (source.directPlayback === true) {
    let probeUrl: string | null = null;
    const map = await ChannelFailoverMap.findOne({ backupSourceId: source._id, enabled: true }).lean().exec();
    if (map) {
      const creds = getSourceCreds(source);
      probeUrl = buildFailoverStreamUrl(creds, map.backupStreamId);
    } else {
      const ch = await Channel.findOne({
        isActive: { $ne: false },
        'metadata.source': 'xtream',
        'metadata.xtreamSourceId': source._id,
        channelUrl: { $exists: true, $ne: '' },
      })
        .select('channelUrl')
        .lean()
        .exec();
      probeUrl = ch?.channelUrl || null;
    }

    if (!probeUrl) {
      // No stream to probe yet (backup before any maps) — API check as a
      // fallback so the source at least reports auth health.
      return probeApiOnly(source, started);
    }

    try {
      const probe = await probeStream(probeUrl, { timeout: 5000 });
      if (probe.status === 'alive') {
        return { health: 'verified', error: null, latencyMs: Date.now() - started };
      }
      return {
        health: 'degraded',
        error: probe.error || 'Direct stream probe failed',
        latencyMs: Date.now() - started,
      };
    } catch (err: any) {
      return {
        health: 'degraded',
        error: String(err?.message || 'Direct stream probe failed'),
        latencyMs: Date.now() - started,
      };
    }
  }

  return probeApiOnly(source, started);
}

function getSourceCreds(source: any): { serverUrl: string; username: string; password: string } {
  return {
    serverUrl: source.serverUrl,
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  };
}

async function probeApiOnly(source: any, started: number): Promise<{ health: SourceHealth; error: string | null; latencyMs: number }> {
  try {
    const auth = await testXtreamConnection(getSourceCreds(source));
    if (!auth.ok) {
      return { health: 'blocked', error: auth.error || 'Authentication failed', latencyMs: Date.now() - started };
    }
    return { health: 'verified', error: null, latencyMs: Date.now() - started };
  } catch (err: any) {
    return {
      health: 'blocked',
      error: err?.response?.status ? `HTTP ${err.response.status}` : String(err?.message || 'API probe failed'),
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Watchdog entry point (task-registry): probe every Active Xtream source,
 * persist the health, refresh the cache and alert on transitions.
 */
export async function runSourceWatchdog(): Promise<{
  checked: number;
  states: Array<{ sourceId: string; name: string; health: SourceHealth }>;
}> {
  // Probe every source that can serve playback: Active ones AND direct-playback
  // ones. The backup source is deliberately added with status Inactive +
  // directPlayback true (no impact on current streams while it is set up), so
  // an Active-only query would never probe it — and NEO itself may be Inactive
  // while its direct URLs still work.
  const sources = await XtreamSource.find({ $or: [{ status: 'Active' }, { directPlayback: true }] })
    .select('name serverUrl usernameEncrypted passwordEncrypted verificationStatus directPlayback')
    .lean()
    .exec();
  const states: Array<{ sourceId: string; name: string; health: SourceHealth }> = [];

  for (const source of sources) {
    const key = String(source._id);
    const prev = mapDbStatusToHealth(source.verificationStatus);
    let next: SourceHealth;
    let error: string | null = null;

    try {
      const probe = await probeSource(source);
      next = probe.health;
      error = probe.error;
    } catch (err: any) {
      next = 'blocked';
      error = String(err?.message || 'Watchdog probe failed');
    }

    // Persist only when something actually changed (avoid write churn every 60s).
    const errorChanged = error !== null && String(source.lastError || '') !== error;
    if (next !== prev || errorChanged || source.verificationStatus === 'pending') {
      await XtreamSource.updateOne(
        { _id: source._id },
        {
          $set: {
            verificationStatus: next,
            ...(errorChanged || next !== prev ? { lastError: error } : {}),
            lastDiagnosticsAt: new Date(),
          },
        },
      ).exec();
    }

    healthCache.set(key, { health: next, checkedAt: Date.now() });
    states.push({ sourceId: key, name: String(source.name || ''), health: next });

    // Alert on transitions only (no alert spam every 60s while down).
    const lastAlerted = lastAlertedHealth.get(key);
    if (next !== lastAlerted && next !== prev) {
      lastAlertedHealth.set(key, next);
      const name = String(source.name || key);
      if (next === 'blocked') {
        await sendOperationalAlert({
          event: 'xtream-source-down',
          severity: 'critical',
          message: `مصدر ${name} متوقف — ستفشل القنوات المرتبطة به؛ التبديل الاحتياطي نشط للمطابَقة`,
        }).catch(() => {});
      } else if (next === 'degraded') {
        await sendOperationalAlert({
          event: 'xtream-source-degraded',
          severity: 'warning',
          message: `مصدر ${name} متدهور (البث المباشر لا يستجيب)`,
        }).catch(() => {});
      } else if (next === 'verified' && prev !== 'verified') {
        await sendOperationalAlert({
          event: 'xtream-source-recovered',
          severity: 'warning',
          message: `مصدر ${name} عاد للعمل — الجلسات الجديدة ستستخدمه من جديد`,
        }).catch(() => {});
      }
    } else if (next === lastAlerted && next === prev) {
      // keep the alerted state so a recovery after silence still fires
    }
  }

  return { checked: sources.length, states };
}

/**
 * Auto-match helper (admin action): pull the backup source's live streams and
 * match them to catalog channels by normalized name. Returns the created maps.
 */
export async function autoMatchFailoverMaps(
  backupSourceId: string,
  opts: { limit?: number; nameContains?: string; categories?: string[] } = {},
): Promise<{ created: number; skipped: number; errors: number }> {
  const source = await XtreamSource.findById(backupSourceId).lean().exec();
  if (!source) throw new Error('Source not found');

  const creds = {
    serverUrl: source.serverUrl,
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  };

  // A Maghreb panel can list 100k+ streams — fetching them all in one call is
  // slow and wasteful. When category names are given, resolve them to ids and
  // fetch only those categories' streams (the feasibility report's own plan:
  // «لا تستورد 115k كما هي — فلتر الفئات المغاربية أولًا»).
  let streams: any[] = [];
  const wantedCategories = (opts.categories || []).map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  if (wantedCategories.length > 0) {
    const catRes = await axios.get(buildXtreamApiUrl(creds, 'get_live_categories'), { timeout: 60000 });
    const cats = Array.isArray(catRes.data) ? catRes.data : [];
    const catIds = cats
      .filter((c: any) => wantedCategories.some((w) => String(c?.category_name || '').toLowerCase().includes(w)))
      .map((c: any) => String(c?.category_id || ''))
      .filter(Boolean);
    for (const catId of catIds) {
      const sRes = await axios.get(buildXtreamApiUrl(creds, 'get_live_streams', { category_id: catId }), { timeout: 90000 });
      if (Array.isArray(sRes.data)) streams.push(...sRes.data);
    }
  } else {
    const res = await axios.get(buildXtreamApiUrl(creds, 'get_live_streams'), { timeout: 120000 });
    streams = Array.isArray(res.data) ? res.data : [];
  }
  const limit = Math.min(Math.max(opts.limit || 500, 1), 2000);

  const catalog = await Channel.find({ isActive: { $ne: false } })
    .select('channelId channelName channelGroup')
    .limit(20000)
    .lean()
    .exec();
  const byName = new Map<string, any[]>();
  for (const ch of catalog) {
    const key = normalizeChannelName(ch.channelName || '');
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(ch);
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;
  const seen = new Set<string>();
  for (const item of streams) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    if (opts.nameContains && !name.toLowerCase().includes(String(opts.nameContains).toLowerCase())) continue;
    const key = normalizeChannelName(name);
    const matches = key ? byName.get(key) : undefined;
    if (!matches || matches.length === 0) {
      skipped += 1;
      continue;
    }
    const ch = matches[0];
    const mapKey = `${String(ch.channelId)}:${backupSourceId}`;
    if (seen.has(mapKey)) continue;
    seen.add(mapKey);
    try {
      await ChannelFailoverMap.findOneAndUpdate(
        { channelRef: String(ch.channelId), backupSourceId },
        {
          $set: {
            channelId: ch._id,
            backupChannelName: name,
            backupStreamId: String(item.stream_id ?? ''),
            matchedBy: 'name',
            enabled: true,
          },
        },
        { upsert: true, new: true },
      ).exec();
      created += 1;
      if (created >= limit) break;
    } catch {
      errors += 1;
    }
  }
  return { created, skipped, errors };
}

module.exports = {
  buildFailoverStreamUrl,
  getSourceHealth,
  isSourceDown,
  getFailoverTarget,
  runSourceWatchdog,
  autoMatchFailoverMaps,
};
