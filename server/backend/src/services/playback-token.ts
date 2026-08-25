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
  streamUrl: string;
  upstreamHeaders?: {
    userAgent?: string;
    referrer?: string;
  };
  direct?: boolean;
  ttlMs?: number;
  sessionId?: string;
}): { token: string; expiresAt: number } {
  const now = Date.now();
  const configuredTtl = Number.parseInt(process.env.PLAYBACK_TOKEN_TTL_MS || '', 10) || DEFAULT_TTL_MS;
  const ttlMs = Math.min(Math.max(Number(input.ttlMs) || configuredTtl, 30_000), 12 * 60 * 60 * 1000);
  const payload: PlaybackTokenPayload = {
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

export function verifyPlaybackToken(token: string): PlaybackTokenPayload | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), decode(parts[1]));
    decipher.setAuthTag(decode(parts[2]));
    const plaintext = Buffer.concat([
      decipher.update(decode(parts[3])),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext) as PlaybackTokenPayload;
    if (
      payload.v !== 1 ||
      typeof payload.userId !== 'string' ||
      typeof payload.channelListCode !== 'string' ||
      typeof payload.streamUrl !== 'string' ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    validateStreamUrl(payload.streamUrl);
    return payload;
  } catch {
    return null;
  }
}

module.exports = { issuePlaybackToken, verifyPlaybackToken };
