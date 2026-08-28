import crypto from 'crypto';

const TOKEN_VERSION = 'pt1';
// Playlist channel URLs carry playback tokens; the app caches the channel list
// (sync every 6h) and its health scanner probes those URLs every 30 min. A
// short TTL made every probe hit an expired token (401) and falsely marked
// every channel OFFLINE ("all channels down"). 6h covers the sync interval.
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_STREAM_URL_LENGTH = 8192;

export interface PlaybackTokenPayload {
  v: 1;
  userId: string;
  channelListCode: string;
  streamUrl: string;
  upstreamHeaders?: {
    userAgent?: string;
    referrer?: string;
  };
  /** When true, the playback endpoint responds with a 302 redirect to the raw
   *  upstream URL instead of proxying the bytes (operator opt-in per source). */
  direct?: boolean;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  sessionId?: string;
}

/**
 * v2 = channel-reference token. Instead of embedding the (potentially 8KB)
 * upstream stream URL — which made the TV channel-list payload ~35% URLs —
 * the token carries the catalog `channelId` (and, for alternates, a 16-hex
 * SHA-256 fingerprint of the stream URL). The playback endpoint resolves the
 * CURRENT stream URL from the Channel document at play time, so the list
 * payload shrinks dramatically and URL rotations propagate without a resync.
 * Authz is unchanged: the token is still bound to the user + channel list
 * code, AES-256-GCM encrypted, and the resolved URL still goes through the
 * same proxy/redirect gate (ALLOW_DIRECT_PLAYBACK).
 */
export interface PlaybackTokenChannelRefPayload {
  v: 2;
  userId: string;
  channelListCode: string;
  channelId: string;
  /** First 16 hex chars of sha256(streamUrl) — selects an alternate slot. */
  altUrlHash?: string;
  /** Container hint (mirrors the v1 suffix decision at issue time). */
  hls?: boolean;
  direct?: boolean;
  /** Never set for v2 (headers are re-derived from the Channel doc at resolve
   *  time); declared so consumers can treat both payload shapes uniformly. */
  upstreamHeaders?: {
    userAgent?: string;
    referrer?: string;
  };
  /** Never set for v2 (the URL is resolved from the Channel doc at play time);
   *  declared so shared consumers can read it without narrowing. */
  streamUrl?: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  sessionId?: string;
}

export type AnyPlaybackTokenPayload = PlaybackTokenPayload | PlaybackTokenChannelRefPayload;

/** sha256(streamUrl) truncated to 16 hex chars — stable alternate fingerprint. */
export function altStreamHash(streamUrl: string): string {
  return crypto.createHash('sha256').update(String(streamUrl || '')).digest('hex').slice(0, 16);
}

function sanitizeHeader(value: unknown, maxLength = 512): string | undefined {
  if (typeof value !== 'string' || !value || value.length > maxLength || /[\r\n]/.test(value)) {
    return undefined;
  }
  return value;
}

function sanitizeUpstreamHeaders(headers?: { userAgent?: string; referrer?: string }) {
  if (!headers) return undefined;
  const userAgent = sanitizeHeader(headers.userAgent);
  const referrer = sanitizeHeader(headers.referrer, 2048);
  if (!userAgent && !referrer) return undefined;
  return { ...(userAgent ? { userAgent } : {}), ...(referrer ? { referrer } : {}) };
}

function getKey(): Buffer {
  const secret =
    process.env.PLAYBACK_TOKEN_SECRET ||
    process.env.JWT_ACCESS_SECRET ||
    process.env.XTREAM_SECRET_KEY;

  // Never silently fall back to a known development secret in production.
  // A predictable playback-token key would let an attacker forge authorization
  // tokens if the application were deployed with incomplete configuration.
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PLAYBACK_TOKEN_SECRET is required in production');
    }
    throw new Error('Playback token secret is not configured');
  }

  return crypto.createHash('sha256').update(secret).digest();
}

function encode(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function validateStreamUrl(streamUrl: string): string {
  const normalized = String(streamUrl || '').trim();
  if (!normalized || normalized.length > MAX_STREAM_URL_LENGTH) {
    throw new Error('Invalid playback URL');
  }
  const parsed = new URL(normalized);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Playback URL must use HTTP or HTTPS');
  }
  return normalized;
}

export function issuePlaybackToken(input: {
  userId: string;
  channelListCode: string;
  streamUrl?: string;
  upstreamHeaders?: {
    userAgent?: string;
    referrer?: string;
  };
  /** v2 mode: reference a catalog channel instead of embedding the stream URL. */
  channelRef?: {
    channelId: string;
    altUrlHash?: string;
    hls?: boolean;
  };
  direct?: boolean;
  ttlMs?: number;
  sessionId?: string;
}): { token: string; expiresAt: number } {
  const now = Date.now();
  const configuredTtl = Number.parseInt(process.env.PLAYBACK_TOKEN_TTL_MS || '', 10) || DEFAULT_TTL_MS;
  const ttlMs = Math.min(Math.max(Number(input.ttlMs) || configuredTtl, 30_000), 12 * 60 * 60 * 1000);

  let payload: AnyPlaybackTokenPayload;
  if (input.channelRef) {
    const channelId = String(input.channelRef.channelId || '').trim();
    if (!channelId || channelId.length > 200) {
      throw new Error('Invalid channel reference');
    }
    payload = {
      v: 2,
      userId: String(input.userId),
      channelListCode: String(input.channelListCode).trim().toUpperCase(),
      channelId,
      altUrlHash: input.channelRef.altUrlHash || undefined,
      hls: input.channelRef.hls === true || undefined,
      direct: input.direct === true || undefined,
      issuedAt: now,
      expiresAt: now + ttlMs,
      nonce: crypto.randomBytes(16).toString('hex'),
      sessionId: input.sessionId ? String(input.sessionId).slice(0, 256) : undefined,
    };
  } else {
    if (typeof input.streamUrl !== 'string') {
      throw new Error('streamUrl or channelRef is required');
    }
    payload = {
      v: 1,
      userId: String(input.userId),
      channelListCode: String(input.channelListCode).trim().toUpperCase(),
      streamUrl: validateStreamUrl(input.streamUrl),
      upstreamHeaders: sanitizeUpstreamHeaders(input.upstreamHeaders),
      direct: input.direct === true || undefined,
      issuedAt: now,
      expiresAt: now + ttlMs,
      nonce: crypto.randomBytes(16).toString('hex'),
      sessionId: input.sessionId ? String(input.sessionId).slice(0, 256) : undefined,
    };
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const token = [TOKEN_VERSION, encode(iv), encode(tag), encode(encrypted)].join('.');
  return { token, expiresAt: payload.expiresAt };
}

export function verifyPlaybackToken(token: string): AnyPlaybackTokenPayload | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), decode(parts[1]));
    decipher.setAuthTag(decode(parts[2]));
    const plaintext = Buffer.concat([
      decipher.update(decode(parts[3])),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext) as AnyPlaybackTokenPayload;
    if (typeof payload.expiresAt !== 'number' || payload.expiresAt <= Date.now()) return null;
    if (payload.v === 1) {
      if (
        typeof payload.userId !== 'string' ||
        typeof payload.channelListCode !== 'string' ||
        typeof payload.streamUrl !== 'string'
      ) {
        return null;
      }
      validateStreamUrl(payload.streamUrl);
      return payload;
    }
    if (payload.v === 2) {
      if (
        typeof payload.userId !== 'string' ||
        typeof payload.channelListCode !== 'string' ||
        typeof payload.channelId !== 'string' ||
        !payload.channelId ||
        payload.channelId.length > 200
      ) {
        return null;
      }
      if (payload.altUrlHash !== undefined && !/^[0-9a-f]{16}$/.test(payload.altUrlHash)) {
        return null;
      }
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { issuePlaybackToken, verifyPlaybackToken, altStreamHash };
