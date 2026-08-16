export type ChannelHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export interface ChannelHealthInput {
  metadata?: {
    isWorking?: boolean | null;
    lastTested?: Date | string | null;
    responseTime?: number | null;
  } | null;
  metrics?: {
    aliveCount?: number | null;
    deadCount?: number | null;
    unresponsiveCount?: number | null;
    lastAliveAt?: Date | string | null;
  } | null;
  alternateStreams?: Array<{
    flaggedBad?: { isFlagged?: boolean | null } | null;
    liveness?: {
      status?: 'alive' | 'dead' | 'unknown' | null;
      lastCheckedAt?: Date | string | null;
      responseTimeMs?: number | null;
    } | null;
  }> | null;
}

export interface ChannelHealthSummary {
  status: ChannelHealthStatus;
  score: number;
  primaryStatus: 'alive' | 'dead' | 'unknown';
  fallbackCount: number;
  successRate: number | null;
  responseTimeMs: number | null;
  lastCheckedAt: string | null;
  recommendation: 'primary' | 'fallback' | 'probe' | 'offline';
}

function validDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Converts primary probe, client reports, and alternate liveness into a small,
 * non-sensitive summary. Stream URLs are intentionally never returned.
 */
export function buildChannelHealth(
  channel: ChannelHealthInput,
  now: Date = new Date(),
): ChannelHealthSummary {
  const primaryStatus: ChannelHealthSummary['primaryStatus'] =
    channel.metadata?.isWorking === true
      ? 'alive'
      : channel.metadata?.isWorking === false
        ? 'dead'
        : 'unknown';

  const viableAlternates = (channel.alternateStreams || []).filter(
    (alternate) =>
      alternate.flaggedBad?.isFlagged !== true && alternate.liveness?.status === 'alive',
  );
  const fallbackCount = viableAlternates.length;

  const aliveCount = Math.max(0, Number(channel.metrics?.aliveCount || 0));
  const deadCount = Math.max(0, Number(channel.metrics?.deadCount || 0));
  const unresponsiveCount = Math.max(0, Number(channel.metrics?.unresponsiveCount || 0));
  const totalReports = aliveCount + deadCount + unresponsiveCount;
  const successRate = totalReports > 0 ? clamp(aliveCount / totalReports, 0, 1) : null;

  const primaryCheckedAt = validDate(channel.metadata?.lastTested);
  const alternateCheckedAt = viableAlternates
    .map((alternate) => validDate(alternate.liveness?.lastCheckedAt))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;
  const lastCheckedAt = [primaryCheckedAt, alternateCheckedAt]
    .filter((date): date is Date => date !== null)
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;

  const ageHours = lastCheckedAt
    ? Math.max(0, (now.getTime() - lastCheckedAt.getTime()) / 3600000)
    : null;
  const freshnessScore = ageHours === null ? 0 : ageHours <= 1 ? 10 : ageHours <= 6 ? 6 : 2;
  const primaryScore = primaryStatus === 'alive' ? 60 : 0;
  const fallbackScore = fallbackCount > 0 ? 20 : 0;
  const reportScore = successRate === null ? 0 : Math.round(successRate * 10);
  const score = clamp(Math.round(primaryScore + fallbackScore + reportScore + freshnessScore), 0, 100);

  // A confirmed live primary remains healthy while its liveness result is
  // reasonably fresh. The old 70-point gate made a working channel appear
  // degraded after one hour when it had no alternates or client reports: the
  // score fell from 70 to 66 even though the stream was still known alive.
  const status: ChannelHealthStatus =
    primaryStatus === 'alive' && score >= 60
      ? 'healthy'
      : primaryStatus === 'dead' && fallbackCount === 0
        ? 'unavailable'
        : primaryStatus === 'unknown' && fallbackCount === 0
          ? 'unknown'
          : 'degraded';

  return {
    status,
    score,
    primaryStatus,
    fallbackCount,
    successRate,
    responseTimeMs: channel.metadata?.responseTime ?? null,
    lastCheckedAt: lastCheckedAt?.toISOString() || null,
    recommendation:
      primaryStatus === 'alive'
        ? 'primary'
        : fallbackCount > 0
          ? 'fallback'
          : primaryStatus === 'unknown'
            ? 'probe'
            : 'offline',
  };
}
