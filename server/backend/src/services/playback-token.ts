import crypto from 'crypto';

const TOKEN_VERSION = 'pt1';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_STREAM_URL_LENGTH = 8192;

export interface PlaybackTokenPayload {
  v: 1;
  userId: string;
  channelListCode: string;
  credentialVersion: number;
  deviceId?: string;
  deviceCredentialVersion?: number;
  streamUrl: string;
  upstreamHeaders?: {
    userAgent?: string;
    referrer?: string;
  };
  issuedAt: number;
  expiresAt: number;
  nonce: string;
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
  // Playback tokens are bearer credentials. Never silently fall back to another
  // application secret: rotating JWT/Xtream secrets must not accidentally rotate
  // or expose the playback capability, and production must fail closed.
  const secret = process.env.PLAYBACK_TOKEN_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PLAYBACK_TOKEN_SECRET is required in production');
    }
    return crypto.createHash('sha256').update('dzhoof-development-playback-secret').digest();
  }
  if (secret.length < 32) {
    throw new Error('PLAYBACK_TOKEN_SECRET must be at least 32 characters');
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
  credentialVersion?: number;
  deviceId?: string;
  deviceCredentialVersion?: number;
  streamUrl: string;
  upstreamHeaders?: {
    userAgent?: string;
    referrer?: string;
  };
  ttlMs?: number;
}): { token: string; expiresAt: number } {
  const now = Date.now();
  const configuredTtl = Number.parseInt(process.env.PLAYBACK_TOKEN_TTL_MS || '', 10) || DEFAULT_TTL_MS;
  const ttlMs = Math.min(Math.max(Number(input.ttlMs) || configuredTtl, 30_000), 15 * 60 * 1000);
  const payload: PlaybackTokenPayload = {
    v: 1,
    userId: String(input.userId),
    channelListCode: String(input.channelListCode).trim().toUpperCase(),
    credentialVersion: Math.max(1, Number(input.credentialVersion) || 1),
    ...(input.deviceId ? { deviceId: String(input.deviceId).trim().slice(0, 200) } : {}),
    ...(input.deviceCredentialVersion ? { deviceCredentialVersion: Math.max(1, Number(input.deviceCredentialVersion)) } : {}),
    streamUrl: validateStreamUrl(input.streamUrl),
    upstreamHeaders: sanitizeUpstreamHeaders(input.upstreamHeaders),
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(16).toString('hex'),
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
      !Number.isInteger(payload.credentialVersion) ||
      payload.credentialVersion < 1 ||
      (payload.deviceId !== undefined && typeof payload.deviceId !== 'string') ||
      (payload.deviceCredentialVersion !== undefined && (!Number.isInteger(payload.deviceCredentialVersion) || payload.deviceCredentialVersion < 1)) ||
      (payload.deviceId !== undefined && payload.deviceCredentialVersion === undefined) ||
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
