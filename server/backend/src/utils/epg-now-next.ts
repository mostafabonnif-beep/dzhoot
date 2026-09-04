/**
 * Pure builder for the EPG now/next payload (work-plan issue #173 — market-grade EPG).
 *
 * The route resolves the user's channels + the programs overlapping a short
 * window, then this helper assembles a per-channel { now, next } view with an
 * explicit fallback for channels that have no guide data (hasEpg: false), so
 * client UIs never break on missing EPG.
 */

export interface NowNextProgram {
  title: string;
  description?: string | null;
  category?: string[];
  start: string;
  end: string;
}

export interface NowNextChannel {
  channelId: string;
  channelName: string;
  tvgLogo: string;
  hasEpg: boolean;
  now: NowNextProgram | null;
  next: NowNextProgram | null;
}

export interface NowNextResult {
  now: string;
  channels: NowNextChannel[];
  withEpg: number;
  withoutEpg: number;
}

type RawProgram = {
  channelEpgId: string;
  title: string;
  description?: string | null;
  category?: string[] | null;
  startTime: Date | string;
  endTime: Date | string;
};

function iso(d: Date | string): string {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function toProgram(p: RawProgram): NowNextProgram {
  return {
    title: p.title,
    description: p.description ?? null,
    category: Array.isArray(p.category) ? p.category : [],
    start: iso(p.startTime),
    end: iso(p.endTime),
  };
}

export function buildNowNext(
  channelKeys: Array<{ key: string; name: string; icon?: string }>,
  programs: RawProgram[],
  nowDate: Date,
): NowNextResult {
  const nowMs = nowDate.getTime();
  const byChannel = new Map<string, RawProgram[]>();
  for (const p of programs) {
    const key = String(p.channelEpgId).toLowerCase();
    let list = byChannel.get(key);
    if (!list) {
      list = [];
      byChannel.set(key, list);
    }
    list.push(p);
  }

  const channels: NowNextChannel[] = [];
  let withEpg = 0;
  for (const ch of channelKeys) {
    const key = ch.key.toLowerCase();
    const list = (byChannel.get(key) || []).sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
    // "now" = the program whose window contains nowMs (started before, ends after).
    // "next" = the first program that starts after nowMs.
    const current =
      list.find(
        (p) =>
          new Date(p.startTime).getTime() <= nowMs &&
          new Date(p.endTime).getTime() > nowMs,
      ) || null;
    const upcoming = list.find(
      (p) => new Date(p.startTime).getTime() > nowMs,
    );
    const has = Boolean(current || upcoming);
    if (has) withEpg += 1;
    channels.push({
      channelId: ch.key,
      channelName: ch.name || ch.key,
      tvgLogo: ch.icon || '',
      hasEpg: has,
      now: current ? toProgram(current) : null,
      next: upcoming ? toProgram(upcoming) : null,
    });
  }

  return {
    now: iso(nowDate),
    channels,
    withEpg,
    withoutEpg: channels.length - withEpg,
  };
}

module.exports = { buildNowNext };
