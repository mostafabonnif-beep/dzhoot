import crypto from 'crypto';
import Device from '../models/Device';

const TOKEN_PREFIX = 'dzdev1';
const TOKEN_BYTES = 32;
const DEFAULT_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function getCredentialEncryptionSecret(): string {
  const secret = String(process.env.PLAYBACK_TOKEN_SECRET || '').trim();
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('PLAYBACK_TOKEN_SECRET must be at least 32 characters in production');
  }
  return secret || 'dzhoof-development-playback-secret';
}

export function hashDeviceCredential(token: string): string {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

export function issueDeviceCredential(input: { userId: string; deviceId: string; ttlMs?: number }) {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const token = `${TOKEN_PREFIX}.${raw}`;
  const ttl = Math.min(Math.max(Number(input.ttlMs) || DEFAULT_TTL_MS, 24 * 60 * 60 * 1000), 365 * 24 * 60 * 60 * 1000);
  return {
    token,
    tokenHash: hashDeviceCredential(token),
    expiresAt: new Date(Date.now() + ttl),
    userId: String(input.userId),
    deviceId: String(input.deviceId),
  };
}

export async function verifyDeviceCredential(token: string) {
  const value = String(token || '').trim();
  if (!value.startsWith(`${TOKEN_PREFIX}.`) || value.length < TOKEN_PREFIX.length + 20) return null;
  const tokenHash = hashDeviceCredential(value);
  const device = await Device.findOne({ credentialHash: tokenHash, credentialRevokedAt: null }).select(
    '_id userId deviceId credentialExpiresAt credentialVersion',
  ).lean().exec();
  if (!device || (device.credentialExpiresAt && device.credentialExpiresAt.getTime() <= Date.now())) return null;
  return device;
}

export function encryptDeviceCredential(token: string): string {
  const secret = getCredentialEncryptionSecret();
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptDeviceCredential(value: string): string | null {
  try {
    const secret = getCredentialEncryptionSecret();
    const key = crypto.createHash('sha256').update(secret).digest();
    const [ivRaw, tagRaw, cipherRaw] = String(value || '').split('.');
    if (!ivRaw || !tagRaw || !cipherRaw) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(cipherRaw, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
