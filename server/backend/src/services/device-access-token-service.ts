import crypto from 'crypto';
import Device from '../models/Device';
import User from '../models/User';

const TOKEN_PREFIX = 'dzt_';
const TOKEN_BYTES = 32;
const DEFAULT_TTL_DAYS = 365;

export interface DeviceAccessPrincipal {
  user: any;
  device: any;
}

function hashDeviceAccessToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function getTokenExpiry(ttlDays = DEFAULT_TTL_DAYS): Date | null {
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) return null;
  const safeDays = Math.min(Math.floor(ttlDays), 730);
  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000);
}

function isWellFormedDeviceAccessToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`).test(token)
  );
}

/**
 * Issues a new 256-bit device-scoped bearer token. Only its SHA-256 hash is
 * persisted. Calling this method again rotates the prior token immediately.
 */
export async function issueDeviceAccessToken(
  userId: string,
  deviceId: string,
  ttlDays = DEFAULT_TTL_DAYS,
): Promise<{ token: string; expiresAt: Date | null; device: any }> {
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedDeviceId) throw new Error('deviceId is required to issue a device access token');

  const device = await Device.findOne({ userId, deviceId: normalizedDeviceId }).select('+accessTokenHash').exec();
  if (!device) throw new Error('paired device not found');

  const token = `${TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString('base64url')}`;
  const expiresAt = getTokenExpiry(ttlDays);
  device.accessTokenHash = hashDeviceAccessToken(token);
  device.accessTokenIssuedAt = new Date();
  device.accessTokenExpiresAt = expiresAt;
  device.accessTokenRevokedAt = null;
  device.lastSeenAt = new Date();
  await device.save();

  return { token, expiresAt, device };
}

/**
 * Resolves a current device token. Invalid, expired, revoked, disabled-user,
 * and unknown-token cases intentionally collapse to null to avoid an oracle.
 */
export async function verifyDeviceAccessToken(token: unknown): Promise<DeviceAccessPrincipal | null> {
  if (!isWellFormedDeviceAccessToken(token)) return null;

  const device = await Device.findOne({ accessTokenHash: hashDeviceAccessToken(token) })
    .select('+accessTokenHash +accessTokenExpiresAt +accessTokenRevokedAt')
    .lean()
    .exec();
  if (!device || device.accessTokenRevokedAt) return null;
  if (device.accessTokenExpiresAt && device.accessTokenExpiresAt.getTime() <= Date.now()) return null;

  const user = await User.findById(device.userId)
    .select('username email role channels channelListCode isActive emailVerified allCatalog')
    .lean()
    .exec();
  if (!user?.isActive) return null;

  Device.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } }).catch(() => undefined);
  return { user, device };
}

export async function revokeDeviceAccessToken(userId: string, deviceId: string): Promise<boolean> {
  const result = await Device.updateOne(
    { userId, deviceId: String(deviceId || '').trim(), accessTokenHash: { $exists: true } },
    { $set: { accessTokenRevokedAt: new Date() } },
  ).exec();
  return result.modifiedCount > 0;
}

module.exports = {
  hashDeviceAccessToken,
  issueDeviceAccessToken,
  verifyDeviceAccessToken,
  revokeDeviceAccessToken,
};
