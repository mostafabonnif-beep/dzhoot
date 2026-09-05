import crypto from 'crypto';

/**
 * Activation code toolkit.
 * Codes are stored hashed (SHA-256) — never in plaintext — so a database
 * leak cannot be turned into usable codes. The plaintext is shown once,
 * at generation time.
 */

// No I, L, O, 0, 1 — avoids ambiguous characters when typing codes manually.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Strip separators and normalize to uppercase. */
export function normalizeActivationCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Generate a single random block of the given length. */
export function generateCodeBlock(len = 4): string {
  // crypto.randomInt is unbiased; modulo sampling skewed indices 0-7 for a
  // 31-char alphabet (security audit).
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** Generate a full code like DZHF-XXXX-XXXX-XXXX. */
export function generateActivationCode(prefix = 'DZHF'): string {
  const blocks = [generateCodeBlock(4), generateCodeBlock(4), generateCodeBlock(4)];
  return `${prefix.toUpperCase()}-${blocks.join('-')}`;
}

/** SHA-256 of the normalized code — the only thing stored in the DB. */
export function hashActivationCode(code: string): string {
  return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
}

/** Last 4 chars, used for search/display without revealing the code. */
export function codeLast4(code: string): string {
  return code.slice(-4).toUpperCase();
}

/** Stable hash of an IP for redemption logging (no raw IPs stored). */
export function hashIp(ip: string | undefined): string {
  if (!ip) return '';
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
}

module.exports = {
  normalizeActivationCode,
  generateCodeBlock,
  generateActivationCode,
  hashActivationCode,
  codeLast4,
  hashIp,
};
