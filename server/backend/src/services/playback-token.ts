import crypto from 'crypto';

const TOKEN_VERSION = 'pt2';
const LEGACY_TOKEN_VERSION = 'pt1';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_STREAM_URL_LENGTH = 8192;

export interface PlaybackTokenPayload {
  v: 1 | 2;
  userId: string;
  /** Legacy binding only. v2 authorization is device-scoped, not code-scoped. */
  channelListCode?: string;
  deviceId?: string;
  /** Epoch milliseconds for the device token generation that issued this URL. */
  deviceTokenIssuedAt?: number;
  streamUrl: string;
  upstreamHeaders?: {
    userAgent?: string;
    referrer?: string;
  };
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
  streamUrl: string;
  /** Required only while legacy code-based endpoints remain opt-in. */
  channelListCode?: string;
  deviceId?: string;
  deviceTokenIssuedAt?: number;
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
  const ttlMs = Math.min(Math.max(Number(input.ttlMs) || configuredTtl, 30_000), 15 * 60 * 1000);
  const deviceId = input.deviceId ? String(input.deviceId).trim().slice(0, 200) : undefined;
  const deviceTokenIssuedAt = Number.isFinite(input.deviceTokenIssuedAt)
    ? Number(input.deviceTokenIssuedAt)
    : undefined;
  const payload: PlaybackTokenPayload = {
    v: deviceId && deviceTokenIssuedAt ? 2 : 1,
    userId: String(input.userId),
    channelListCode: input.channelListCode ? String(input.channelListCode).trim().toUpperCase() : undefined,
    deviceId,
    deviceTokenIssuedAt,
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
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const token = [TOKEN_VERSION, encode(iv), encode(tag), encode(encrypted)].join('.');
  return { token, expiresAt: payload.expiresAt };
}

export function verifyPlaybackToken(token: string): PlaybackTokenPayload | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 4 || ![TOKEN_VERSION, LEGACY_TOKEN_VERSION].includes(parts[0])) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), decode(parts[1]));
    decipher.setAuthTag(decode(parts[2]));
    const plaintext = Buffer.concat([decipher.update(decode(parts[3])), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plaintext) as PlaybackTokenPayload;
    if (
      ![1, 2].includes(payload.v) ||
      typeof payload.userId !== 'string' ||
      typeof payload.streamUrl !== 'string' ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    if (payload.v === 2 && (!payload.deviceId || !Number.isFinite(payload.deviceTokenIssuedAt))) return null;
    if (payload.v === 1 && typeof payload.channelListCode !== 'string') return null;
    validateStreamUrl(payload.streamUrl);
    return payload;
  } catch {
    return null;
  }
}

module.exports = { issuePlaybackToken, verifyPlaybackToken };
