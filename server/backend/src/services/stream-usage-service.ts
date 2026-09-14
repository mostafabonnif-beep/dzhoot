/**
 * Stream usage — turns the active stream sessions into the business numbers the
 * operator actually asks for: how many people are watching right now, how many
 * of them are on the free tier, and which channels are carrying the load.
 *
 * Tier resolution is derived (not stamped into tokens): a code is "free" when it
 * is the shared demo/free code or its account has no active subscription. That
 * keeps the streaming hot path untouched — no token format change, no extra
 * lookup per chunk.
 */

import {
  listActiveStreamSessions,
  type ActiveStreamSession,
} from './stream-session-service';
import { getActiveSubscription } from './subscription-service';
import User from '../models/User';
import type { UsageConcurrency, UsageTier } from './usage-metrics';

const TIER_CACHE_TTL_MS = 60_000;
const tierCache = new Map<string, { tier: UsageTier; at: number }>();

function demoCode(): string {
  return String(process.env.DEMO_TV_CODE || '').trim().toUpperCase();
}

/** Test seam. */
export function clearTierCache(): void {
  tierCache.clear();
}

export async function resolveEgressTier(
  userId?: string,
  channelListCode?: string,
): Promise<UsageTier> {
  const key = `${userId || ''}|${channelListCode || ''}`;
  const hit = tierCache.get(key);
  if (hit && Date.now() - hit.at < TIER_CACHE_TTL_MS) return hit.tier;
  const tier = await computeTier(userId, channelListCode);
  tierCache.set(key, { tier, at: Date.now() });
  return tier;
}

async function computeTier(userId?: string, channelListCode?: string): Promise<UsageTier> {
  const code = String(channelListCode || '').trim().toUpperCase();
  const demo = demoCode();
  // The shared free/demo code has no paid subscription by definition.
  if ((demo && code === demo) || userId === 'demo') return 'free';
  if (!userId) return 'unknown';
  try {
    const user = await User.findById(userId).select('role freeAccess').lean();
    if (!user) return 'unknown';
    if (user.role === 'Admin') return 'admin';
    if ((user as { freeAccess?: boolean }).freeAccess === true) return 'free';
    const subscription = await getActiveSubscription(userId);
    return subscription ? 'paid' : 'free';
  } catch {
    return 'unknown';
  }
}

/**
 * Assemble the concurrency picture from the live stream sessions.
 * Tiers are resolved in one pass; lookups are memoized for a minute so a busy
 * box does not hammer Mongo just to render a dashboard.
 */
export async function buildUsageConcurrency(
  sessions?: ActiveStreamSession[],
): Promise<UsageConcurrency> {
  const active = sessions || (await listActiveStreamSessions());
  const byTier: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const channelCounts = new Map<string, number>();

  for (const session of active) {
    const tier = await resolveEgressTier(session.userId, session.channelListCode);
    byTier[tier] = (byTier[tier] || 0) + 1;

    // `sourceId` is not part of today's session metadata; when a future revision
    // stamps it, the per-provider view lights up with no change here.
    const sourceId = (session as { sourceId?: string }).sourceId;
    if (sourceId) bySource[sourceId] = (bySource[sourceId] || 0) + 1;

    const name = session.contentName || session.contentGroup || 'غير معروف';
    channelCounts.set(name, (channelCounts.get(name) || 0) + 1);
  }

  return {
    total: active.length,
    byTier,
    bySource,
    topChannels: [...channelCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}
