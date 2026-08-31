import { iptvOrgCacheService } from './iptv-org-cache';
import { externalSourceCacheService } from './external-source-cache';
import { epgService } from './epg-service';
import { streamHealthService } from './stream-health-service';
import { ExternalSourceCacheMeta, ExternalSourceChannel } from '../models/ExternalSourceCache';
import { IptvOrgChannel } from '../models/IptvOrgCache';
import XtreamSource from '../models/XtreamSource';
import M3USource from '../models/M3USource';
import Notification from '../models/Notification';
import { syncXtreamSource, verifyXtreamSource } from './xtream-service';
import { syncM3USource } from './m3u-service';
import { sendDailyOpsReport, sendExpiryAlerts } from './ops-report-service';
import { expireStaleCodesAndReturnCredit } from './subscription-service';
import { runSourceWatchdog } from './source-failover-service';
import { sendNotificationToDevices, pushOutcome } from './fcm-service';
import { sendOperationalAlert } from './alert-notifier';

export interface SubtaskResult {
  name: string;
  status: 'completed' | 'failed';
  durationMs: number;
  result?: any;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TaskResult {
  summary: any;
  subtasks: SubtaskResult[];
}

export interface TaskDefinition {
  name: string;
  displayName: string;
  description: string;
  intervalMs: number;
  handler: () => Promise<TaskResult>;
}

// Parse an interval env var, falling back to the default if it's missing or
// non-finite/non-positive (a NaN would make setInterval fire ~every 1ms).
function intervalMs(envValue: string | undefined, defaultMs: number): number {
  const n = parseInt(envValue || '', 10);
  return Number.isFinite(n) && n > 0 ? n : defaultMs;
}

const LIVENESS_INTERVAL = intervalMs(process.env.LIVENESS_CHECK_INTERVAL_MS, 86400000);
const EPG_INTERVAL = intervalMs(process.env.EPG_REFRESH_INTERVAL_MS, 21600000);
const CACHE_INTERVAL = intervalMs(process.env.CACHE_REFRESH_INTERVAL_MS, 3600000);
const STREAM_HEALTH_INTERVAL = intervalMs(process.env.STREAM_HEALTH_CHECK_INTERVAL_MS, 14400000);
const YOUTUBE_REFRESH_INTERVAL = intervalMs(process.env.YOUTUBE_REFRESH_INTERVAL_MS, 14400000);
const XTREAM_SYNC_INTERVAL = intervalMs(process.env.XTREAM_SYNC_INTERVAL_MS, 21600000);
const M3U_SYNC_INTERVAL = intervalMs(process.env.M3U_SYNC_INTERVAL_MS, 21600000);
const OPS_REPORT_INTERVAL = intervalMs(process.env.OPS_REPORT_INTERVAL_MS, 86400000);
const EXPIRY_ALERT_INTERVAL = intervalMs(process.env.EXPIRY_ALERT_INTERVAL_MS, 86400000);
const CODE_EXPIRY_INTERVAL = intervalMs(process.env.CODE_EXPIRY_INTERVAL_MS, 86400000);
const NOTIFICATION_DISPATCH_INTERVAL = intervalMs(process.env.NOTIFICATION_DISPATCH_INTERVAL_MS, 60000);
const SOURCE_WATCHDOG_INTERVAL = intervalMs(process.env.SOURCE_WATCHDOG_INTERVAL_MS, 60000);
const DISK_WATCHDOG_INTERVAL = intervalMs(process.env.DISK_WATCHDOG_INTERVAL_MS, 600000); // 10 min
const SYNC_WATCHDOG_INTERVAL = intervalMs(process.env.SYNC_WATCHDOG_INTERVAL_MS, 1800000); // 30 min
// A sync is "stale" once its age passes 2× the sync interval (6h) plus margin.
const SYNC_STALENESS_THRESHOLD_MS = intervalMs(process.env.SYNC_STALENESS_THRESHOLD_MS, 13 * 3600000);
// At most one fast-retry per source within this window (avoids hammering a down upstream).
const SYNC_RETRY_BACKOFF_MS = intervalMs(process.env.SYNC_RETRY_BACKOFF_MS, 30 * 60000);

/** Daily operations report to admins (codes activated per reseller, new users, …). */
async function dailyReportHandler(): Promise<TaskResult> {
  const start = Date.now();
  const result = await sendDailyOpsReport();
  const subtasks: SubtaskResult[] = [
    {
      name: 'daily-report',
      status: result.ok ? 'completed' : 'failed',
      durationMs: Date.now() - start,
      result: { recipients: result.recipients },
      error: result.error || undefined,
    },
  ];
  return { summary: { ok: result.ok, recipients: result.recipients }, subtasks };
}

/** Subscription expiry reminders (ACTIVE subs expiring within 3 days). */
async function expiryAlertHandler(): Promise<TaskResult> {
  const start = Date.now();
  const result = await sendExpiryAlerts(3);
  const subtasks: SubtaskResult[] = [
    {
      name: 'subscription-expiry-alert',
      status: result.ok ? 'completed' : 'failed',
      durationMs: Date.now() - start,
      result: { sent: result.sent },
      error: result.error || undefined,
    },
  ];
  return { summary: { ok: result.ok, sent: result.sent }, subtasks };
}

/** Daily: expire UNUSED reseller codes past their window and return credit. */
async function codeExpiryHandler(): Promise<TaskResult> {
  const start = Date.now();
  try {
    const result = await expireStaleCodesAndReturnCredit();
    const subtasks: SubtaskResult[] = [
      {
        name: 'code-expiry-check',
        status: 'completed',
        durationMs: Date.now() - start,
        result: { expired: result.expired, creditReturned: result.creditReturned.length },
      },
    ];
    return {
      summary: { expired: result.expired, creditReturned: result.creditReturned.length },
      subtasks,
    };
  } catch (err: any) {
    const subtasks: SubtaskResult[] = [
      {
        name: 'code-expiry-check',
        status: 'failed',
        durationMs: Date.now() - start,
        error: err?.message || String(err),
      },
    ];
    return { summary: { ok: false, error: err?.message || String(err) }, subtasks };
  }
}

/** Every minute: send due SCHEDULED push notifications via FCM. */async function notificationDispatcherHandler(): Promise<TaskResult> {
  const startedAt = Date.now();
  const subtasks: SubtaskResult[] = [];
  let sent = 0;
  let failed = 0;
  let skippedNotConfigured = 0;

  let due: any[] = [];
  try {
    due = await Notification.find({
      status: 'SCHEDULED',
      scheduledAt: { $lte: new Date() },
    })
      .sort({ scheduledAt: 1 })
      .limit(50)
      .lean();
  } catch (err: any) {
    subtasks.push({
      name: 'notification-dispatcher-query',
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: err?.message || String(err),
    });
  }

  for (const notification of due) {
    const subStart = Date.now();
    const name = String(notification.title || notification._id);
    try {
      const fcm = await sendNotificationToDevices({
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl,
        deepLink: notification.deepLink,
        audience: notification.audience,
      });
      // The in-app channel always delivers, so status is SENT; push outcome
      // is recorded in deliveryStats. A throw leaves it SCHEDULED to retry.
      const outcome = pushOutcome(fcm);
      await Notification.updateOne(
        { _id: notification._id },
        {
          $set: {
            status: 'SENT',
            sentAt: new Date(),
            deliveryStats: { ...fcm, pushDelivered: outcome.pushDelivered, reason: outcome.reason },
          },
        },
      ).exec();
      if (fcm.configured === false) {
        skippedNotConfigured += 1;
      } else if (outcome.pushDelivered) {
        sent += 1;
      } else {
        failed += 1;
      }
      subtasks.push({
        name,
        status: 'completed',
        durationMs: Date.now() - subStart,
        result: { ...fcm, outcome },
      });
    } catch (err: any) {
      failed += 1;
      subtasks.push({
        name,
        status: 'failed',
        durationMs: Date.now() - subStart,
        error: err?.message || String(err),
      });
    }
  }

  return {
    summary: { sent, failed, skippedNotConfigured },
    subtasks,
  };
}

async function livenessHandler(): Promise<TaskResult> {
  const subtasks: SubtaskResult[] = [];

  // IPTV-org batch
  const iptvStart = Date.now();
  try {
    const result = await iptvOrgCacheService.runBatchLivenessCheck();
    subtasks.push({
      name: 'iptv-org',
      status: 'completed',
      durationMs: Date.now() - iptvStart,
      result,
    });
  } catch (err: any) {
    subtasks.push({
      name: 'iptv-org',
      status: 'failed',
      durationMs: Date.now() - iptvStart,
      error: err.message,
    });
  }

  // External sources — sequential per source+region
  try {
    const metas = await ExternalSourceCacheMeta.find({}, { source: 1, region: 1 }).lean();
    for (const { source, region } of metas) {
      const extStart = Date.now();
      try {
        const result = await externalSourceCacheService.runBatchLivenessCheck(source, region);
        subtasks.push({
          name: `${source}:${region}`,
          status: 'completed',
          durationMs: Date.now() - extStart,
          result,
        });
      } catch (err: any) {
        subtasks.push({
          name: `${source}:${region}`,
          status: 'failed',
          durationMs: Date.now() - extStart,
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    subtasks.push({
      name: 'external-sources-query',
      status: 'failed',
      durationMs: 0,
      error: err.message,
    });
  }

  // Prune stale dead cache rows right after the sweep re-confirmed their state.
  // Opt-in; caches are regenerable, so a still-listed stream re-imports on next refresh.
  if (process.env.DEAD_STREAM_PRUNE_ENABLED === 'true') {
    const pruneStart = Date.now();
    try {
      const parsedDays = Number(process.env.DEAD_STREAM_PRUNE_DAYS);
      const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 7;
      const cutoff = new Date(Date.now() - days * 86400000);
      const filter = { 'liveness.status': 'dead', 'liveness.lastCheckedAt': { $lt: cutoff } };
      const [iptv, ext] = await Promise.all([
        IptvOrgChannel.deleteMany(filter),
        ExternalSourceChannel.deleteMany(filter),
      ]);
      subtasks.push({
        name: 'prune-dead-streams',
        status: 'completed',
        durationMs: Date.now() - pruneStart,
        result: {
          iptvOrgDeleted: iptv.deletedCount || 0,
          externalDeleted: ext.deletedCount || 0,
          olderThanDays: days,
        },
      });
    } catch (err: any) {
      subtasks.push({
        name: 'prune-dead-streams',
        status: 'failed',
        durationMs: Date.now() - pruneStart,
        error: err.message,
      });
    }
  }

  const completed = subtasks.filter((s) => s.status === 'completed').length;
  const failed = subtasks.filter((s) => s.status === 'failed').length;

  return {
    summary: { totalSubtasks: subtasks.length, completed, failed },
    subtasks,
  };
}

async function epgHandler(): Promise<TaskResult> {
  const start = Date.now();
  try {
    await epgService.refreshEpg();
    return {
      summary: { refreshed: true },
      subtasks: [{ name: 'epg-refresh', status: 'completed', durationMs: Date.now() - start }],
    };
  } catch (err: any) {
    return {
      summary: { refreshed: false },
      subtasks: [
        {
          name: 'epg-refresh',
          status: 'failed',
          durationMs: Date.now() - start,
          error: err.message,
        },
      ],
    };
  }
}

async function cacheRefreshHandler(): Promise<TaskResult> {
  const start = Date.now();
  try {
    const result = await iptvOrgCacheService.refreshCache();
    return {
      summary: result,
      subtasks: [
        { name: 'iptv-org-cache', status: 'completed', durationMs: Date.now() - start, result },
      ],
    };
  } catch (err: any) {
    return {
      summary: { refreshed: false },
      subtasks: [
        {
          name: 'iptv-org-cache',
          status: 'failed',
          durationMs: Date.now() - start,
          error: err.message,
        },
      ],
    };
  }
}

async function streamHealthHandler(): Promise<TaskResult> {
  const start = Date.now();
  try {
    const result = await streamHealthService.runHealthCheck();
    return {
      summary: result,
      subtasks: [
        {
          name: 'stream-health-check',
          status: 'completed',
          durationMs: Date.now() - start,
          result,
        },
      ],
    };
  } catch (err: any) {
    return {
      summary: { error: err.message },
      subtasks: [
        {
          name: 'stream-health-check',
          status: 'failed',
          durationMs: Date.now() - start,
          error: err.message,
        },
      ],
    };
  }
}

async function catalogSourceSyncHandler(kind: 'xtream' | 'm3u'): Promise<TaskResult> {
  const startedAt = Date.now();
  const subtasks: SubtaskResult[] = [];
  const sources = kind === 'xtream'
    ? await XtreamSource.find({ status: 'Active' }, { _id: 1, name: 1 }).lean()
    : await M3USource.find({ status: 'Active' }, { _id: 1, name: 1 }).lean();

  for (const source of sources) {
    const sourceStartedAt = Date.now();
    try {
      let result;
      if (kind === 'xtream') {
        const verification = await verifyXtreamSource(String(source._id), 2);
        if (!verification.decision.verified) {
          throw new Error(`Source verification failed: ${verification.decision.reason || verification.decision.verificationStatus}`);
        }
        result = await syncXtreamSource(String(source._id));
      } else {
        result = await syncM3USource(String(source._id));
      }
      subtasks.push({
        name: `${kind}:${source.name}`,
        status: 'completed',
        durationMs: Date.now() - sourceStartedAt,
        result: result.stats,
      });
    } catch (err: any) {
      subtasks.push({
        name: `${kind}:${source.name}`,
        status: 'failed',
        durationMs: Date.now() - sourceStartedAt,
        error: err.message,
      });
    }
  }

  const completed = subtasks.filter((s) => s.status === 'completed').length;
  const failed = subtasks.filter((s) => s.status === 'failed').length;
  return {
    summary: {
      sourceType: kind,
      sources: sources.length,
      completed,
      failed,
      durationMs: Date.now() - startedAt,
    },
    subtasks,
  };
}

async function xtreamSyncHandler(): Promise<TaskResult> {
  return catalogSourceSyncHandler('xtream');
}

async function m3uSyncHandler(): Promise<TaskResult> {
  return catalogSourceSyncHandler('m3u');
}

async function youtubeUrlRefreshHandler(): Promise<TaskResult> {
  const start = Date.now();
  try {
    const result = await externalSourceCacheService.refreshYouTubeUrls();
    return {
      summary: result,
      subtasks: [
        {
          name: 'youtube-url-refresh',
          status: 'completed',
          durationMs: Date.now() - start,
          result,
        },
      ],
    };
  } catch (err: any) {
    return {
      summary: { error: err.message },
      subtasks: [
        {
          name: 'youtube-url-refresh',
          status: 'failed',
          durationMs: Date.now() - start,
          error: err.message,
        },
      ],
    };
  }
}

/** Every 60s: probe active Xtream sources and drive the auto-failover state. */
async function sourceWatchdogHandler(): Promise<TaskResult> {
  const start = Date.now();
  try {
    const result = await runSourceWatchdog();
    const subtasks: SubtaskResult[] = [
      {
        name: 'source-watchdog',
        status: 'completed',
        durationMs: Date.now() - start,
        result: result.states.map((s) => ({ name: s.name, health: s.health })),
      },
    ];
    return { summary: { checked: result.checked }, subtasks };
  } catch (err: any) {
    const subtasks: SubtaskResult[] = [
      {
        name: 'source-watchdog',
        status: 'failed',
        durationMs: Date.now() - start,
        error: err?.message || String(err),
      },
    ];
    return { summary: { ok: false, error: err?.message || String(err) }, subtasks };
  }
}

// ---------------------------------------------------------------------------
// System disk watchdog — alerts when the host disk is filling up.
// Uses fs.statfsSync (no exec): the API container shares the host overlay.
// Levels: warn >= 80%, critical >= 90%. Each level alerts once per drop below
// (threshold - 3%) so we don't spam. Delivered through the same webhook
// channel as source alerts (AppSetting 'alert_webhook_url' — Discord/Slack).
// ---------------------------------------------------------------------------
const fs = require('fs');

const DISK_WARN_PCT = 80;
const DISK_CRIT_PCT = 90;
const DISK_HYSTERESIS_PCT = 3;
let diskAlertedLevel = 0; // 0 = none, 1 = warn, 2 = crit

async function diskWatchdogHandler(): Promise<TaskResult> {
  const start = Date.now();
  let usedPct = -1;
  try {
    const st = fs.statfsSync('/');
    usedPct = Math.round((1 - st.bavail / st.blocks) * 100);
  } catch (err: any) {
    return {
      summary: { ok: false, error: `statfs failed: ${err?.message || err}` },
      subtasks: [{ name: 'system-disk-watchdog', status: 'failed', durationMs: Date.now() - start, error: err?.message }],
    };
  }

  const level = usedPct >= DISK_CRIT_PCT ? 2 : usedPct >= DISK_WARN_PCT ? 1 : 0;
  const threshold = level === 2 ? DISK_CRIT_PCT : DISK_WARN_PCT;

  if (level > 0 && level !== diskAlertedLevel) {
    const ok = await sendOperationalAlert({
      event: 'system.disk.high',
      severity: level === 2 ? 'critical' : 'warning',
      message: `Host disk usage reached ${usedPct}% (threshold ${threshold}%). Free space is running low — check backups, EPG data and docker images.`,
      details: { diskUsedPct: usedPct, threshold, path: '/' },
    }).catch((e: any) => {
      console.error('[disk-watchdog] alert failed:', e?.message);
      return false;
    });
    diskAlertedLevel = level;
    console.log(`[disk-watchdog] ${usedPct}% → alert ${ok ? 'sent' : 'queued (no webhook configured)'}`);
  } else if (level === 0 && diskAlertedLevel > 0) {
    console.log(`[disk-watchdog] ${usedPct}% → recovered, alerts re-armed`);
    diskAlertedLevel = 0;
  } else if (level > 0 && diskAlertedLevel === level && usedPct < threshold - DISK_HYSTERESIS_PCT) {
    diskAlertedLevel = 0; // dropped below hysteresis — allow a fresh alert later
  }

  return {
    summary: { diskUsedPct: usedPct },
    subtasks: [{ name: 'system-disk-watchdog', status: 'completed', durationMs: Date.now() - start, result: { diskUsedPct: usedPct } }],
  };
}


// ── Source sync watchdog ─────────────────────────────────────────────────────
// Closes two gaps in the interval-driven sync pipeline:
//   1. A source stuck in syncStatus:'error' would otherwise wait up to 6h for
//      the next scheduled attempt — retry it here on a short backoff instead.
//   2. If a sync silently stops (scheduler hiccup, upstream hangs, task crash),
//      the operator learns within ~30 minutes via webhook instead of finding a
//      stale catalog days later by opening the dashboard.
const syncAlerted = new Map<string, boolean>(); // sourceId -> staleness alert armed
const lastSyncRetryAt = new Map<string, number>(); // sourceId -> last fast-retry ts

async function sourceSyncWatchdogHandler(): Promise<TaskResult> {
  const start = Date.now();
  const subtasks: SubtaskResult[] = [];
  const now = Date.now();

  const syncModels: Array<{ kind: 'm3u' | 'xtream'; model: any }> = [
    { kind: 'm3u', model: M3USource },
    { kind: 'xtream', model: XtreamSource },
  ];

  for (const { kind, model } of syncModels) {
    const sources: Array<{
      _id: unknown;
      name?: string | null;
      syncStatus?: string;
      lastSyncAt?: Date | null;
      lastError?: string | null;
    }> = await model
      .find({ status: 'Active' }, { _id: 1, name: 1, syncStatus: 1, lastSyncAt: 1, lastError: 1 })
      .lean()
      .exec();

    for (const source of sources) {
      const id = String(source._id);
      const name = String(source.name || id);
      const lastSyncMs = source.lastSyncAt ? new Date(source.lastSyncAt).getTime() : 0;
      const stale = source.syncStatus === 'error' || lastSyncMs === 0 ||
        now - lastSyncMs >= SYNC_STALENESS_THRESHOLD_MS;

      // 1) Fast retry for sources whose last sync attempt failed.
      if (source.syncStatus === 'error') {
        const lastRetry = lastSyncRetryAt.get(id) || 0;
        if (now - lastRetry >= SYNC_RETRY_BACKOFF_MS) {
          lastSyncRetryAt.set(id, now);
          const retryStarted = Date.now();
          try {
            if (kind === 'xtream') {
              const verification = await verifyXtreamSource(id, 1);
              if (!verification.decision.verified) {
                throw new Error(verification.decision.reason || 'source verification failed');
              }
              await syncXtreamSource(id);
            } else {
              await syncM3USource(id);
            }
            subtasks.push({
              name: `${kind}:${name}`,
              status: 'completed',
              durationMs: Date.now() - retryStarted,
              result: { action: 'retry', outcome: 'synced' },
            });
            console.log(`[sync-watchdog] ${kind} «${name}» retried after failure → synced`);
          } catch (err: any) {
            subtasks.push({
              name: `${kind}:${name}`,
              status: 'failed',
              durationMs: Date.now() - retryStarted,
              error: String(err?.message || err).slice(0, 300),
            });
          }
        }
      }

      // 2) Staleness alert, re-armed when the source syncs again.
      const wasAlerted = syncAlerted.get(id) || false;
      if (stale && !wasAlerted) {
        const reason = source.syncStatus === 'error'
          ? `فشل آخر مزامنة (${String(source.lastError || 'خطأ غير معروف').slice(0, 100)})`
          : lastSyncMs === 0
            ? 'لم تتم أي مزامنة ناجحة بعد'
            : `آخر مزامنة ناجحة قبل ${Math.max(1, Math.round((now - lastSyncMs) / 3600000))} ساعة`;
        const ok = await sendOperationalAlert({
          event: 'source-sync-stale',
          severity: 'warning',
          message: `مزامنة مصدر ${kind.toUpperCase()} «${name}» متوقفة: ${reason}`,
          details: { sourceId: id, kind, lastSyncAt: source.lastSyncAt, syncStatus: source.syncStatus },
        }).catch((e: any) => {
          console.error(`[sync-watchdog] alert failed: ${e?.message}`);
          return false;
        });
        syncAlerted.set(id, true);
        console.log(`[sync-watchdog] ${kind} «${name}» stale → alert ${ok ? 'sent' : 'queued (no webhook configured)'}`);
      } else if (!stale && wasAlerted) {
        syncAlerted.set(id, false);
        console.log(`[sync-watchdog] ${kind} «${name}» recovered — staleness alert re-armed`);
      }
    }
  }

  const completed = subtasks.filter((s) => s.status === 'completed').length;
  const failed = subtasks.filter((s) => s.status === 'failed').length;
  return {
    summary: { checked: subtasks.length, completed, failed, durationMs: Date.now() - start },
    subtasks,
  };
}

const tasks: TaskDefinition[] = [
  {
    name: 'liveness-check',
    displayName: 'Channel Liveness Check',
    description: 'Probe all cached streams to check if they are alive or dead',
    intervalMs: LIVENESS_INTERVAL,
    handler: livenessHandler,
  },
  {
    name: 'epg-refresh',
    displayName: 'EPG Guide Refresh',
    description: 'Fetch and update electronic program guide data',
    intervalMs: EPG_INTERVAL,
    handler: epgHandler,
  },
  {
    name: 'cache-refresh',
    displayName: 'IPTV-org Cache Refresh',
    description: 'Refresh the IPTV-org channel and stream cache from upstream',
    intervalMs: CACHE_INTERVAL,
    handler: cacheRefreshHandler,
  },
  {
    name: 'stream-health-check',
    displayName: 'Stream Health Check & Auto-Promotion',
    description:
      'Check primary streams with alternates, auto-promote alive alternates when primary is dead/flagged',
    intervalMs: STREAM_HEALTH_INTERVAL,
    handler: streamHealthHandler,
  },
  {
    name: 'xtream-sync',
    displayName: 'Xtream Catalog Synchronization',
    description: 'Synchronize active Xtream sources into Live TV, VOD, series, seasons, and episodes',
    intervalMs: XTREAM_SYNC_INTERVAL,
    handler: xtreamSyncHandler,
  },
  {
    name: 'm3u-sync',
    displayName: 'M3U Playlist Synchronization',
    description: 'Download active M3U sources and synchronize their live channels securely',
    intervalMs: M3U_SYNC_INTERVAL,
    handler: m3uSyncHandler,
  },
  {
    name: 'youtube-url-refresh',
    displayName: 'YouTube Stream URL Refresh',
    description:
      'Resolve fresh HLS URLs for YouTube-based channels (YouTube Live + Prasar Bharati)',
    intervalMs: YOUTUBE_REFRESH_INTERVAL,
    handler: youtubeUrlRefreshHandler,
  },
  {
    name: 'daily-report',
    displayName: 'Daily Operations Report',
    description: 'Email admins a daily summary: codes activated per reseller, new users, active subscriptions',
    intervalMs: OPS_REPORT_INTERVAL,
    handler: dailyReportHandler,
  },
  {
    name: 'subscription-expiry-alert',
    displayName: 'Subscription Expiry Alerts',
    description: 'Email users whose ACTIVE subscription expires within 3 days',
    intervalMs: EXPIRY_ALERT_INTERVAL,
    handler: expiryAlertHandler,
  },
  {
    name: 'code-expiry-check',
    displayName: 'Code Expiry & Credit Return',
    description: 'Expire unused reseller codes past their validity window and return the credit to the reseller',
    intervalMs: CODE_EXPIRY_INTERVAL,
    handler: codeExpiryHandler,
  },
  {
    name: 'notification-dispatcher',
    displayName: 'Scheduled Notification Dispatcher',
    description: 'Send due SCHEDULED push notifications via FCM',
    intervalMs: NOTIFICATION_DISPATCH_INTERVAL,
    handler: notificationDispatcherHandler,
  },
  {
    name: 'system-disk-watchdog',
    displayName: 'System Disk Watchdog',
    description: 'Alert when host disk usage crosses 80%/90% (webhook + logs)',
    intervalMs: DISK_WATCHDOG_INTERVAL,
    handler: diskWatchdogHandler,
  },
  {
    name: 'source-watchdog',
    displayName: 'Source Health Watchdog (Auto-Failover)',
    description: 'Light-probe active Xtream sources and drive the backup-source failover state',
    intervalMs: SOURCE_WATCHDOG_INTERVAL,
    handler: sourceWatchdogHandler,
  },
  {
    name: 'source-sync-watchdog',
    displayName: 'Source Sync Watchdog (fast retry + staleness alert)',
    description:
      'Retry failed catalog syncs on a short backoff and alert when an active source sync stops entirely',
    intervalMs: SYNC_WATCHDOG_INTERVAL,
    handler: sourceSyncWatchdogHandler,
  },
];

export function getAllTasks(): TaskDefinition[] {
  return tasks;
}

export function getTask(name: string): TaskDefinition | undefined {
  return tasks.find((t) => t.name === name);
}

module.exports = { getAllTasks, getTask };
