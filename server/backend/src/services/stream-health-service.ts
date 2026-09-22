import Channel from '../models/Channel';
import XtreamSource from '../models/XtreamSource';
import { probeStream } from './stream-prober';
import { channelCache } from './cache';
import { clearChannelGateCache } from './channel-gate-cache';
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
// The alternate array is capped by the Channel schema; keep the demoted primary from
// overflowing it when a format failover happens on a channel that is already full.
const MAX_ALTERNATE_STREAMS = 50;

/**
 * The provider's sibling container format for the same stream id.
 *
 * An Xtream panel serves one stream id in several containers, and a given id frequently works
 * in one and fails in the other. Measured 2026-09-21 on a live provider: `.../live/USER/PASS/
 * 297641.ts` answered `200` with an empty body (repeatedly, through the relay) while the same
 * id served a valid 169-byte manifest as `.m3u8`; the panel advertised `allowed_output_formats:
 * [m3u8, ts, rtmp]`. Swapping the extension is the whole trick, and the relay already knows how
 * to rewrite an HLS manifest, so an `.m3u8` primary needs no extra playback work.
 *
 * The string is rebuilt from the caller's URL with only the extension replaced so provider
 * credentials and tokens in the query string survive byte-for-byte. Returns null when the URL
 * carries no swappable `.ts`/`.m3u8` extension.
 */
export function siblingStreamUrl(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;

  const queryIndex = url.search(/[?#]/);
  const base = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const suffix = queryIndex === -1 ? '' : url.slice(queryIndex);

  const match = /\.(ts|m3u8)$/i.exec(base);
  if (!match) return null;

  const sibling = match[1].toLowerCase() === 'ts' ? 'm3u8' : 'ts';
  return `${base.slice(0, -match[0].length)}.${sibling}${suffix}`;
}

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
    // The visibility gate reads isWorking / flaggedBad, which this run rewrites on
    // every probed channel — once per run is enough (the memo recomputes on demand).
    if (stats.checked > 0) {
      clearChannelGateCache();
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

    // Tracks a primary that was probed and failed *in this run* — the only case where a
    // sibling-format probe is allowed (a channel skipped by the cooldown is left alone).
    let primaryProbeFailed = false;

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
        primaryProbeFailed = true;
      } catch (error: unknown) {
        // A transport/probe exception is also a failed primary. Persist it so
        // customer endpoints can hide the channel immediately.
        channel.metadata = channel.metadata || {};
        channel.metadata.isWorking = false;
        channel.metadata.lastTested = new Date();
        (channel.metadata as Record<string, unknown>).testError = redactSensitiveText(error) || 'Probe failed';
        await channel.save();
        primaryProbeFailed = true;
      }
    }

    // Primary is dead/flagged — find best alive, non-flagged alternate
    const alternates = channel.alternateStreams || [];

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
      // Last resort before declaring the channel dead: the provider may serve the same stream
      // id in the sibling container (`.ts` <-> `.m3u8`). The alternate scan above only ever
      // re-points the channel at a *different* URL; when the whole source is broken in one
      // container, every alternate fails and the channel would be hidden even though a working
      // rendition of the very same stream exists one extension away (issue #360, measured
      // 6/10 channels black-screen on production).
      if (primaryProbeFailed && (await this.promoteSiblingFormat(channel, alternates))) {
        return 'promoted';
      }

      // All alternates are dead or flagged — save updated liveness and return
      await channel.save();
      const allFlagged = alternates.length > 0 && alternates.every((a) => a.flaggedBad?.isFlagged);
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

  /**
   * Re-point the channel at its sibling container format when that one actually streams.
   *
   * Returns true when the URL was switched (and persisted), false when there is nothing to
   * try or the sibling is just as dead. The previous primary is kept as a demoted alternate so
   * the operator can see what was replaced — and so a later run can move back if the provider
   * fixes the original format.
   */
  private async promoteSiblingFormat(
    channel: IChannelDocument,
    alternates: IChannelDocument['alternateStreams'],
  ): Promise<boolean> {
    const sibling = siblingStreamUrl(channel.channelUrl);
    if (!sibling) return false;

    // Already probed as an alternate in this run — its liveness is fresh, don't pay twice.
    if ((alternates || []).some((alt) => alt?.streamUrl === sibling)) return false;

    let result;
    try {
      result = await probeStream(sibling, { timeout: PROBE_TIMEOUT_MS });
    } catch {
      return false;
    }

    if (result.status !== 'alive') return false;

    const oldPrimaryUrl = channel.channelUrl;
    channel.channelUrl = sibling;
    channel.metadata = channel.metadata || {};
    channel.metadata.isWorking = true;
    channel.metadata.lastTested = new Date();
    channel.metadata.responseTime = result.responseTimeMs;
    // The switch is a new URL: any prior bad flag belonged to the old one.
    channel.flaggedBad = {
      isFlagged: false,
      reason: null,
      flaggedBy: null,
      flaggedAt: null,
    };

    const list = [...(alternates || [])];
    if (list.length < MAX_ALTERNATE_STREAMS) {
      list.push({
        streamUrl: oldPrimaryUrl,
        quality: channel.metadata?.quality ?? null,
        liveness: {
          status: 'dead',
          lastCheckedAt: new Date(),
          responseTimeMs: null,
          error: `Demoted: sibling format .${sibling.endsWith('.m3u8') ? 'm3u8' : 'ts'} served the stream`,
        },
        flaggedBad: { isFlagged: false, reason: null, flaggedBy: null, flaggedAt: null },
        userAgent: null,
        referrer: null,
        source: null,
        promotedAt: null,
        demotedAt: new Date(),
      } as (typeof list)[number]);
    }
    channel.alternateStreams = list;

    await channel.save();

    console.log(
      `[stream-health] Switched ${channel.channelId} to the sibling stream format (${oldPrimaryUrl} -> ${sibling})`,
    );

    return true;
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

// CommonJS consumers (`require('../services/stream-health-service')`) replace the module
// exports object wholesale, so every named export has to be listed here too.
module.exports = { streamHealthService, StreamHealthService, siblingStreamUrl };
