/**
 * Catch-up / timeshift URL building for DZ HOOF channels.
 *
 * Two upstream styles are supported:
 *  - M3U templates: the provider's `catchup-source` attribute with the standard
 *    IPTV placeholders ({utc}, {lutc}, {start}, {end}, {duration}).
 *  - Xtream: the panel `/timeshift/...` endpoint, built from the source's
 *    live URL credentials + stream id.
 *
 * The raw template is stored server-side only (it may embed credentials) and
 * is never exposed to clients — see routes/channels.js slimAlternates().
 */
import type { IChannel } from '@firevision/shared';

/** Max single catch-up session (minutes) — mirrors the 24h clamp in /tv/playback-token. */
export const CATCHUP_MAX_DURATION_MIN = 24 * 60;

/** Default window (days) when a channel has catch-up but no explicit catchup-days. */
export const CATCHUP_DEFAULT_DAYS = 7;

/** Grace: allow a program that started moments ago (clock skew / rounding). */
const START_GRACE_MS = 60_000;

/** Allow a program whose start is slightly in the future (EPG clock skew). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface CatchupChannelLike {
  catchup?: { type?: string | null; source?: string | null; days?: number | null };
  metadata?: { source?: string | null; xtreamSourceId?: string | null; xtreamStreamId?: number | null };
}

/** Number of days of history a channel's catch-up covers (0 = none). */
export function getCatchupWindowDays(channel: CatchupChannelLike): number {
  if (channel.catchup?.days && channel.catchup.days > 0) return channel.catchup.days;
  if (channel.catchup?.type) return CATCHUP_DEFAULT_DAYS;
  // Legacy Xtream channels synced before the catch-up field existed are still
  // timeshift-capable via their panel — assume the default window.
  if (isLegacyXtreamChannel(channel)) return CATCHUP_DEFAULT_DAYS;
  return 0;
}

function isLegacyXtreamChannel(channel: CatchupChannelLike): boolean {
  return (
    channel.metadata?.source === 'xtream' &&
    channel.metadata?.xtreamStreamId !== undefined &&
    channel.metadata?.xtreamStreamId !== null
  );
}

/** Whether a channel advertises catch-up at all. */
export function isCatchupSupported(channel: CatchupChannelLike): boolean {
  return Boolean(channel.catchup?.type) || isLegacyXtreamChannel(channel);
}

/**
 * Substitute the standard IPTV catchup placeholders into a provider template.
 * All values are Unix epoch seconds.
 *  - {utc}      → now
 *  - {lutc}     → program start
 *  - {start}    → program start (alias)
 *  - {end}      → program start + duration
 *  - {duration} → program duration (seconds)
 */
export function substituteCatchupTemplate(
  template: string,
  startMs: number,
  durationMs: number,
  nowMs: number,
): string {
  const startSec = Math.floor(startMs / 1000);
  const durationSec = Math.max(1, Math.floor(durationMs / 1000));
  const nowSec = Math.floor(nowMs / 1000);
  return template
    .replaceAll('{utc}', String(nowSec))
    .replaceAll('{lutc}', String(startSec))
    .replaceAll('{start}', String(startSec))
    .replaceAll('{end}', String(startSec + durationSec))
    .replaceAll('{duration}', String(durationSec));
}

/**
 * Build a catch-up URL for a channel whose catch-up comes from an M3U
 * `catchup-source` template. Returns null when the channel has no template.
 */
export function buildM3uCatchupUrl(
  channel: CatchupChannelLike,
  startMs: number,
  durationMs: number,
  nowMs: number,
): string | null {
  const template = channel.catchup?.source;
  if (!channel.catchup?.type || !template) return null;
  return substituteCatchupTemplate(template, startMs, durationMs, nowMs);
}

/**
 * Build an Xtream timeshift URL (panel `/timeshift/` endpoint).
 * `start` is formatted as YYYY-MM-DD:HH-MM in UTC, per the Xtream convention.
 */
export function buildXtreamTimeshiftUrl(
  input: { serverUrl: string; username: string; password: string; streamId: string | number },
  startMs: number,
  durationMin: number,
): string {
  const host = String(input.serverUrl).replace(/\/+$/, '');
  const start = new Date(startMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  const formatted =
    `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}` +
    `:${pad(start.getUTCHours())}-${pad(start.getUTCMinutes())}`;
  return (
    `${host}/timeshift/${encodeURIComponent(input.username)}/${encodeURIComponent(input.password)}` +
    `/${durationMin}/${formatted}/${input.streamId}.m3u8`
  );
}

export interface CatchupUrlResult {
  ok: boolean;
  url?: string;
  code?: 'CATCHUP_UNAVAILABLE' | 'CATCHUP_OUT_OF_WINDOW' | 'INVALID_CATCHUP_TIME';
  error?: string;
}

/**
 * Validate a catch-up request and pick the URL strategy for a channel:
 *  - M3U template channels: substitute placeholders.
 *  - Xtream channels: caller passes decrypted creds; the URL is built here.
 * Returns CATCHUP_UNAVAILABLE when the channel has no catch-up at all.
 */
export function buildCatchupUrlForChannel(
  channel: CatchupChannelLike,
  input: {
    startMs: number;
    durationMin: number;
    nowMs: number;
    xtreamCreds?: { serverUrl: string; username: string; password: string };
  },
): CatchupUrlResult {
  const { startMs, durationMin, nowMs, xtreamCreds } = input;

  if (!Number.isFinite(startMs) || startMs <= 0) {
    return { ok: false, code: 'INVALID_CATCHUP_TIME', error: 'Invalid catch-up start time' };
  }
  if (!Number.isFinite(durationMin) || durationMin < 1) {
    return { ok: false, code: 'INVALID_CATCHUP_TIME', error: 'Invalid catch-up duration' };
  }

  const supported = isCatchupSupported(channel);
  if (!supported) {
    return { ok: false, code: 'CATCHUP_UNAVAILABLE', error: 'Catch-up is not available for this channel' };
  }

  // Enforce the provider's timeshift window (with small clock-skew tolerances).
  const windowDays = getCatchupWindowDays(channel);
  const windowStart = nowMs - windowDays * 86_400_000 - START_GRACE_MS;
  if (startMs < windowStart || startMs > nowMs + FUTURE_TOLERANCE_MS) {
    return {
      ok: false,
      code: 'CATCHUP_OUT_OF_WINDOW',
      error: `Catch-up is only available for the last ${windowDays} days`,
    };
  }

  const safeDurationMin = Math.min(Math.max(durationMin, 1), CATCHUP_MAX_DURATION_MIN);
  const durationMs = safeDurationMin * 60_000;

  // M3U template wins when present; Xtream channels fall back to /timeshift/.
  const m3uUrl = buildM3uCatchupUrl(channel, startMs, durationMs, nowMs);
  if (m3uUrl) return { ok: true, url: m3uUrl };

  const streamId = channel.metadata?.xtreamStreamId;
  if (xtreamCreds && streamId !== undefined && streamId !== null) {
    return {
      ok: true,
      url: buildXtreamTimeshiftUrl(
        { ...xtreamCreds, streamId },
        startMs,
        safeDurationMin,
      ),
    };
  }

  return { ok: false, code: 'CATCHUP_UNAVAILABLE', error: 'Catch-up is not available for this channel' };
}
