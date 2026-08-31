import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';
import { probeStream } from './stream-prober';
import { channelCache } from './cache';
import { redactSensitiveText } from './audit-log';
import type { IChannelDocument } from '@dzhoof/shared';

const BATCH_SIZE = 200;
const CONCURRENCY = parseInt(process.env.STREAM_HEALTH_CONCURRENCY || '10', 10);
// Probe timeout for primary/alternate liveness checks. Some legal M3U streams
// answer in 10-15s (slow CDNs); a hard 10s probe marked them dead while they
// actually work. Configurable via STREAM_PROBE_TIMEOUT_MS (ms).
const PROBE_TIMEOUT_MS = parseInt(process.env.STREAM_PROBE_TIMEOUT_MS || '15000', 10);
// A channel already marked dead is re-probed after this cooldown so it can
// recover automatically when the upstream comes back. Previously a dead
// primary was never re-checked (only alternates were considered) and stayed
// dead forever unless manually tested. Configurable via
// STREAM_DEAD_RECHECK_HOURS.
const DEAD_RECHECK_MS = parseInt(process.env.STREAM_DEAD_RECHECK_HOURS || '6', 10) * 3600000;

interface HealthCheckResult {
  checked: number;
  promoted: number;
  allDead: number;
  flaggedSkipped: number;
}

export class StreamHealthService {
  async runHealthCheck(): Promise<HealthCheckResult> {
    const stats: HealthCheckResult = {
      checked: 0,
      promoted: 0,
      allDead: 0,
      flaggedSkipped: 0,
    };

    // Check every shared catalog channel with a primary URL. Primary-only dead
    // channels must not remain `unknown` forever and stay visible to customers.
    const healthQuery = {
      ownerId: null,
      channelUrl: { $exists: true, $nin: ['', null] },
    };
    const totalCount = await Channel.countDocuments(healthQuery);

    if (totalCount === 0) {
      console.log('[stream-health] No catalog channels with a primary URL, skipping');
      return stats;
    }

    // Direct-playback sources cannot be judged from the server's datacenter IP
    // (the upstream blocks it — clients fetch from their own networks). Probing
    // them here would mark every such channel "dead" on every run. Load their
    // ids once and skip them.
    const directSourceIds = new Set(
      (await XtreamSource.find({ directPlayback: true }).distinct('_id')).map((id) => String(id)),
    );

    console.log(
      `[stream-health] Starting health check for ${totalCount} catalog channels (concurrency: ${CONCURRENCY}, direct-playback exempt: ${directSourceIds.size})`,
    );

    let lastId: unknown = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const query: Record<string, unknown> = { ...healthQuery };
      if (lastId) query._id = { $gt: lastId };

      const batch = await Channel.find(query).sort({ _id: 1 }).limit(BATCH_SIZE);

      if (batch.length === 0) break;
      lastId = batch[batch.length - 1]._id;

      // Process batch with concurrency limit
      await this.parallelMap(
        batch,
        async (channel: IChannelDocument) => {
          try {
            const result = await this.checkAndPromote(channel, directSourceIds);
            stats.checked++;
            if (result === 'promoted') stats.promoted++;
            else if (result === 'all-dead') stats.allDead++;
            else if (result === 'flagged-skipped') stats.flaggedSkipped++;
          } catch (err: unknown) {
            const message = redactSensitiveText(err);
            console.error(`[stream-health] Error checking channel ${channel.channelId}:`, message);
            stats.checked++;
          }
        },
        CONCURRENCY,
      );

      console.log(
        `[stream-health] Progress: ${stats.checked}/${totalCount} (${stats.promoted} promoted, ${stats.allDead} all-dead)`,
      );
    }

    console.log(
      `[stream-health] Complete: ${stats.checked} checked, ${stats.promoted} promoted, ${stats.allDead} all-dead, ${stats.flaggedSkipped} flagged-skipped`,
    );

    // Promotions swap channelUrl / mutate liveness in the cached catalog payload —
    // bust it so clients pick up the promoted streams (shared Redis with the API).
    if (stats.promoted > 0) {
      await channelCache.deletePattern('catalog:*');
    }

    return stats;
  }

  private async checkAndPromote(
    channel: IChannelDocument,
    directSourceIds: Set<string> = new Set(),
  ): Promise<'ok' | 'promoted' | 'all-dead' | 'flagged-skipped'> {
    // Direct-playback sources: the datacenter probe is meaningless (upstream
    // blocks the server IP) — liveness can only be judged from real client
    // playback events, not from a server probe. Normalize any stale
    // `isWorking=false` left over from an earlier server-probed era so these
    // channels are no longer reported dead to the admin dashboard (they ARE
    // served to clients directly; a false "dead" label makes the whole
    // catalog look broken).
    if (directSourceIds.has(String(channel.metadata?.xtreamSourceId || ''))) {
      if (channel.metadata?.isWorking === false) {
        channel.metadata = channel.metadata || {};
        channel.metadata.isWorking = true;
        channel.metadata.lastTested = new Date();
        await channel.save();
      }
      return 'ok';
    }

    // Check if primary is dead or flagged
    const primaryDead = channel.metadata?.isWorking === false;
    const primaryFlagged = channel.flaggedBad?.isFlagged === true;
    // Dead primaries get one more probe after a cooldown (DEAD_RECHECK_MS) so
    // recovered upstreams are promoted back automatically instead of staying
    // dead forever. Never re-probe a flagged channel.
    const lastTested = channel.metadata?.lastTested
      ? new Date(channel.metadata.lastTested).getTime()
      : 0;
    const staleDeadPrimary =
      primaryDead && !primaryFlagged && Date.now() - lastTested > DEAD_RECHECK_MS;

    if ((!primaryDead && !primaryFlagged) || staleDeadPrimary) {
      // Primary seems fine (or is a stale-dead candidate) — probe to confirm
      try {
        const probeResult = await probeStream(channel.channelUrl, { timeout: PROBE_TIMEOUT_MS });
        // Update primary liveness
        channel.metadata = channel.metadata || {};
        channel.metadata.isWorking = probeResult.status === 'alive';
        channel.metadata.lastTested = new Date();
        channel.metadata.responseTime = probeResult.responseTimeMs;
        await channel.save();

        if (probeResult.status === 'alive') return 'ok';
      } catch (error: unknown) {
        // A transport/probe exception is also a failed primary. Persist it so
        // customer endpoints can hide the channel immediately.
        channel.metadata = channel.metadata || {};
        channel.metadata.isWorking = false;
        channel.metadata.lastTested = new Date();
        (channel.metadata as Record<string, unknown>).testError = redactSensitiveText(error) || 'Probe failed';
        await channel.save();
      }
    }

    // Primary is dead/flagged — find best alive, non-flagged alternate
    const alternates = channel.alternateStreams || [];
    if (alternates.length === 0) return 'all-dead';

    // Probe alternates to find a viable one
    let bestAlternate: { index: number; responseTimeMs: number } | null = null;

    for (let i = 0; i < alternates.length; i++) {
      const alt = alternates[i];

      // Skip flagged alternates
      if (alt.flaggedBad?.isFlagged) continue;

      try {
        const result = await probeStream(alt.streamUrl, {
          timeout: PROBE_TIMEOUT_MS,
          userAgent: alt.userAgent || undefined,
          referrer: alt.referrer || undefined,
        });

        // Update alternate liveness
        alt.liveness = {
          status: result.status,
          lastCheckedAt: new Date(),
          responseTimeMs: result.responseTimeMs,
          error: result.error,
        };

        if (result.status === 'alive') {
          if (!bestAlternate || result.responseTimeMs < bestAlternate.responseTimeMs) {
            bestAlternate = { index: i, responseTimeMs: result.responseTimeMs };
          }
        }
      } catch {
        alt.liveness = {
          status: 'dead',
          lastCheckedAt: new Date(),
          responseTimeMs: null,
          error: 'Probe failed',
        };
      }
    }

    if (!bestAlternate) {
      // All alternates are dead or flagged — save updated liveness and return
      await channel.save();
      const allFlagged = alternates.every((a) => a.flaggedBad?.isFlagged);
      return allFlagged ? 'flagged-skipped' : 'all-dead';
    }

    // Promote: swap primary URL with best alternate.
    const promotedAlt = alternates[bestAlternate.index];
    const oldPrimaryUrl = channel.channelUrl;

    // Move current primary into the vacated alternate slot, carrying the PRIMARY's
    // own header/quality context (not the promoted alternate's) so the demoted URL
    // keeps the metadata it actually needs. The old code spread the alternate's
    // fields onto the old-primary URL, mismatching its headers.
    alternates[bestAlternate.index] = {
      ...alternates[bestAlternate.index],
      streamUrl: oldPrimaryUrl,
      userAgent: null,
      referrer: null,
      quality: channel.metadata?.quality ?? null,
      demotedAt: new Date(),
      liveness: {
        status: 'dead',
        lastCheckedAt: new Date(),
        responseTimeMs: null,
        error: 'Demoted from primary',
      },
    };

    // Set new primary — carry the promoted alternate's quality onto the primary.
    // NOTE: the Channel schema has no top-level userAgent/referrer fields, so the
    // promoted alternate's custom headers cannot be persisted at the primary level
    // (see limitation note in the report).
    channel.channelUrl = promotedAlt.streamUrl;
    channel.metadata = channel.metadata || {};
    channel.metadata.isWorking = true;
    channel.metadata.lastTested = new Date();
    channel.metadata.responseTime = bestAlternate.responseTimeMs;
    if (promotedAlt.quality) channel.metadata.quality = promotedAlt.quality;
    channel.activeUserAgent = promotedAlt.userAgent || null;
    channel.activeReferrer = promotedAlt.referrer || null;

    // Clear primary flaggedBad since this is a new URL
    channel.flaggedBad = {
      isFlagged: false,
      reason: null,
      flaggedBy: null,
      flaggedAt: null,
    };

    await channel.save();

    console.log(`[stream-health] Promoted alternate for ${channel.channelId}`);

    return 'promoted';
  }

  private async parallelMap<T>(
    items: T[],
    fn: (item: T) => Promise<void>,
    concurrency: number,
  ): Promise<void> {
    let index = 0;

    async function worker() {
      while (index < items.length) {
        const i = index++;
        await fn(items[i]);
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
  }
}

export const streamHealthService = new StreamHealthService();

module.exports = { streamHealthService, StreamHealthService };
