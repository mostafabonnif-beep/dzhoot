import crypto from 'crypto';
import { authenticator } from 'otplib';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TOTP_ENCRYPTION_KEY is required in production');
    }
    return crypto.createHash('sha256').update('dzhoof-development-totp-key').digest();
  }
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error('TOTP_ENCRYPTION_KEY must be a 64-character hexadecimal value');
  }
  return Buffer.from(raw, 'hex');
}

export function encryptTotpSecret(secret: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

export function decryptTotpSecret(payload: string): string {
  const packed = Buffer.from(payload, 'base64url');
  if (packed.length <= IV_BYTES + TAG_BYTES) throw new Error('Invalid encrypted TOTP secret');
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export async function verifyTotpToken(secretPayload: string, token: string): Promise<boolean> {
  if (!/^[0-9]{6,8}$/.test(token)) return false;
  try {
    return authenticator.check(token, decryptTotpSecret(secretPayload));
  } catch {
    return false;
  }
}

export async function createTotpSetup(label: string) {
  const secret = authenticator.generateSecret();
  return {
    encryptedSecret: encryptTotpSecret(secret),
    secret,
    uri: authenticator.keyuri(label, 'DZ HOOF IPTV', secret),
  };
}
