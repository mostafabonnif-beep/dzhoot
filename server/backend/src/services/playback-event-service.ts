import PlaybackEvent, { PlaybackEventType } from '../models/PlaybackEvent';

export interface RecordPlaybackEventInput {
  channelId: string;
  eventType: PlaybackEventType;
  startupMs?: number | null;
  rebufferCount?: number;
  fallbackUsed?: boolean;
  fallbackSucceeded?: boolean | null;
  errorCode?: string | null;
  platform?: string | null;
  appVersion?: string | null;
}

function nullableText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  const cleaned = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, maxLength);
  return cleaned || null;
}

export async function recordPlaybackEvent(input: RecordPlaybackEventInput) {
  return PlaybackEvent.create({
    channelId: input.channelId,
    eventType: input.eventType,
    startupMs: input.startupMs ?? null,
    rebufferCount: input.rebufferCount ?? 0,
    fallbackUsed: input.fallbackUsed === true,
    fallbackSucceeded: input.fallbackUsed === true ? input.fallbackSucceeded ?? null : null,
    errorCode: nullableText(input.errorCode, 100),
    platform: nullableText(input.platform, 30),
    appVersion: nullableText(input.appVersion, 40),
  });
}

export async function getPlaybackQualityStats(days = 7) {
  const safeDays = Math.min(30, Math.max(1, Math.floor(days)));
  const startDate = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

  const [daily, summary, errors] = await Promise.all([
    PlaybackEvent.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalEvents: { $sum: 1 },
          startupSuccesses: { $sum: { $cond: [{ $eq: ['$eventType', 'startup_success'] }, 1, 0] } },
          startupFailures: { $sum: { $cond: [{ $eq: ['$eventType', 'startup_failure'] }, 1, 0] } },
          avgStartupMs: { $avg: '$startupMs' },
          avgRebufferCount: { $avg: '$rebufferCount' },
          fallbackAttempts: { $sum: { $cond: ['$fallbackUsed', 1, 0] } },
          fallbackSuccesses: { $sum: { $cond: [{ $eq: ['$fallbackSucceeded', true] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    PlaybackEvent.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          startupSuccesses: { $sum: { $cond: [{ $eq: ['$eventType', 'startup_success'] }, 1, 0] } },
          startupFailures: { $sum: { $cond: [{ $eq: ['$eventType', 'startup_failure'] }, 1, 0] } },
          avgStartupMs: { $avg: '$startupMs' },
          avgRebufferCount: { $avg: '$rebufferCount' },
          fallbackAttempts: { $sum: { $cond: ['$fallbackUsed', 1, 0] } },
          fallbackSuccesses: { $sum: { $cond: [{ $eq: ['$fallbackSucceeded', true] }, 1, 0] } },
        },
      },
    ]),
    PlaybackEvent.aggregate([
      { $match: { createdAt: { $gte: startDate }, eventType: 'startup_failure', errorCode: { $ne: null } } },
      { $group: { _id: '$errorCode', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const totals = summary[0] || {
    totalEvents: 0,
    startupSuccesses: 0,
    startupFailures: 0,
    avgStartupMs: null,
    avgRebufferCount: 0,
    fallbackAttempts: 0,
    fallbackSuccesses: 0,
  };
  const startupAttempts = totals.startupSuccesses + totals.startupFailures;

  return {
    windowDays: safeDays,
    summary: {
      totalEvents: totals.totalEvents,
      startupSuccesses: totals.startupSuccesses,
      startupFailures: totals.startupFailures,
      startupSuccessRate: startupAttempts > 0 ? Math.round((totals.startupSuccesses / startupAttempts) * 100) : null,
      avgStartupMs: totals.avgStartupMs === null ? null : Math.round(totals.avgStartupMs),
      avgRebufferCount: Math.round((totals.avgRebufferCount || 0) * 100) / 100,
      fallbackAttempts: totals.fallbackAttempts,
      fallbackSuccesses: totals.fallbackSuccesses,
      fallbackSuccessRate: totals.fallbackAttempts > 0 ? Math.round((totals.fallbackSuccesses / totals.fallbackAttempts) * 100) : null,
    },
    daily: daily.map((row) => ({
      date: row._id,
      totalEvents: row.totalEvents,
      startupSuccesses: row.startupSuccesses,
      startupFailures: row.startupFailures,
      startupSuccessRate: row.startupSuccesses + row.startupFailures > 0
        ? Math.round((row.startupSuccesses / (row.startupSuccesses + row.startupFailures)) * 100)
        : null,
      avgStartupMs: row.avgStartupMs === null ? null : Math.round(row.avgStartupMs),
      avgRebufferCount: Math.round((row.avgRebufferCount || 0) * 100) / 100,
      fallbackAttempts: row.fallbackAttempts,
      fallbackSuccesses: row.fallbackSuccesses,
    })),
    topErrors: errors.map((row) => ({ errorCode: row._id, count: row.count })),
  };
}
