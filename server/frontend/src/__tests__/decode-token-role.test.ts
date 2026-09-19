import { decodeTokenRole } from '@/lib/api';

/**
 * `decodeTokenRole` routes 401s: a reseller JWT must land on `/reseller/login`,
 * everything else on `/login`.
 *
 * What was actually wrong: the decode depended on the browser tolerating
 * unpadded base64 and on the payload being Latin-1. A base64url payload can only
 * have length 0, 2 or 3 (mod 4) — so the "1 mod 4 crashes it" story is wrong for
 * a well-formed token, and this file says so instead of repeating it. The tests
 * below pin the behaviour for every length class, for a UTF-8 payload, and for
 * genuinely corrupt input.
 */
function base64url(payload: Record<string, unknown>): string {
  // Node's Buffer encodes UTF-8 for us and is available in the jest environment.
  return Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function jwt(payload: Record<string, unknown>): string {
  return `header.${base64url(payload)}.signature`;
}

describe('decodeTokenRole', () => {
  it('reads the role from a reseller token', () => {
    expect(decodeTokenRole(jwt({ sub: 'r1', role: 'reseller' }))).toBe('reseller');
  });

  it('reads the role from an admin token', () => {
    expect(decodeTokenRole(jwt({ sub: 'a1', role: 'Admin' }))).toBe('Admin');
  });

  it('decodes payloads of every base64url length class', () => {
    // A base64url payload is 0, 2 or 3 (mod 4) — never 1 — because base64 emits
    // 4 characters per 3 input bytes. The samples are asserted to cover the
    // classes that need padding (2 and 3), so this cannot pass on easy cases only.
    const candidates = [
      { role: 'reseller', a: '1' },
      { role: 'reseller', ab: '12' },
      { role: 'reseller', abc: '123' },
      { role: 'reseller', abcd: '1234' },
      { role: 'reseller', abcde: '12345' },
      { role: 'reseller', abcdef: '123456' },
      { role: 'reseller', abcdefg: '1234567' },
      { role: 'reseller', x: 'y' },
    ];

    const classes = new Set(candidates.map((payload) => base64url(payload).length % 4));
    expect(classes.has(2)).toBe(true);
    expect(classes.has(3)).toBe(true);

    candidates.forEach((payload) => {
      expect(decodeTokenRole(jwt(payload))).toBe('reseller');
    });
  });

  it('returns null for a payload whose base64 length is impossible (1 mod 4)', () => {
    // Five characters cannot be decoded; the helper must answer null rather than
    // throw into the 401 interceptor.
    expect(decodeTokenRole('header.AAAAA.signature')).toBeNull();
  });

  it('decodes a payload containing a non-ASCII username', () => {
    expect(decodeTokenRole(jwt({ sub: 'u1', role: 'reseller', username: 'مستخدم عربي' }))).toBe(
      'reseller',
    );
  });

  it('returns null for garbage, a missing payload or no token', () => {
    expect(decodeTokenRole(null)).toBeNull();
    expect(decodeTokenRole(undefined)).toBeNull();
    expect(decodeTokenRole('')).toBeNull();
    expect(decodeTokenRole('not-a-jwt')).toBeNull();
    expect(decodeTokenRole('header..signature')).toBeNull();
    expect(decodeTokenRole('header.@@@@.signature')).toBeNull();
  });

  it('returns null when the payload carries no role', () => {
    expect(decodeTokenRole(jwt({ sub: 'u1' }))).toBeNull();
    expect(decodeTokenRole(jwt({ sub: 'u1', role: 42 }))).toBeNull();
  });
});
