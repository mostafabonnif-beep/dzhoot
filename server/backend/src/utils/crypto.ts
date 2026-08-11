import crypto from 'crypto';

/**
 * AES-256-GCM encryption for sensitive stored values (Xtream credentials).
 * Key is derived from XTREAM_SECRET_KEY (or JWT_ACCESS_SECRET as fallback)
 * so we never store plaintext credentials in the database.
 */

function getKey(): Buffer {
  const secret = process.env.XTREAM_SECRET_KEY;
  if (!secret) throw new Error('XTREAM_SECRET_KEY is not configured');
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith('enc:')) throw new Error('Refusing to decrypt legacy plaintext Xtream credential');
  const [, ivB64, tagB64, dataB64] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
