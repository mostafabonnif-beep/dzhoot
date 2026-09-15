/**
 * Pure logic behind the frontend request-hygiene middleware.
 *
 * The regression this guards (2026-09-15): 75 `The Server Reference ID did not match
 * the expected format. Received "x".` lines in 96h, all from external scans posting a
 * fabricated `Next-Action` header, logged with no route, no status and no request id.
 */
import {
  SERVER_ACTION_ID_LENGTH,
  buildMalformedActionLog,
  classifyUserAgent,
  clientKey,
  createMalformedActionLimiter,
  isMalformedServerActionHeader,
  serverActionIds,
} from '../lib/request-hygiene';

// A real Next.js server reference id is 42 characters long.
const REAL_ID = 'a'.repeat(SERVER_ACTION_ID_LENGTH);

describe('isMalformedServerActionHeader', () => {
  it.each([['x'], ['y'], ['0'], ['1'], ['action'], ['a'.repeat(41)], ['a'.repeat(43)]])(
    'rejects the value %p observed in production logs',
    (value) => {
      expect(isMalformedServerActionHeader(value)).toBe(true);
    },
  );

  it('accepts a 42-character server reference id', () => {
    expect(isMalformedServerActionHeader(REAL_ID)).toBe(false);
  });

  it('accepts a list that contains a valid id', () => {
    expect(isMalformedServerActionHeader(`${REAL_ID},b`)).toBe(false);
  });

  it('rejects a list where no entry could be an id', () => {
    expect(isMalformedServerActionHeader('x,y,0')).toBe(true);
  });

  it('accepts whitespace, quotes and brackets around an id', () => {
    expect(isMalformedServerActionHeader(` "${REAL_ID}" `)).toBe(false);
    expect(isMalformedServerActionHeader(`["${REAL_ID}"]`)).toBe(false);
  });

  it('leaves a POST without the header to the application', () => {
    // An ordinary form POST must not be intercepted by this guard.
    expect(isMalformedServerActionHeader(null)).toBe(false);
    expect(isMalformedServerActionHeader(undefined)).toBe(false);
    expect(isMalformedServerActionHeader('')).toBe(false);
    expect(isMalformedServerActionHeader('   ')).toBe(false);
  });
});

describe('serverActionIds', () => {
  it('splits, trims and strips wrapping punctuation', () => {
    expect(serverActionIds(' a , "b" ,[c] ')).toEqual(['a', 'b', 'c']);
    expect(serverActionIds('')).toEqual([]);
    expect(serverActionIds(null)).toEqual([]);
  });
});

describe('classifyUserAgent', () => {
  it('separates automated clients from browsers and empty agents', () => {
    expect(classifyUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe('browser');
    expect(classifyUserAgent('python-requests/2.31')).toBe('automated');
    expect(classifyUserAgent('curl/8.5.0')).toBe('automated');
    expect(classifyUserAgent('SomeBot/1.0')).toBe('automated');
    expect(classifyUserAgent('')).toBe('empty');
    expect(classifyUserAgent(undefined)).toBe('empty');
  });
});

describe('buildMalformedActionLog', () => {
  it('classifies the rejection without echoing the offending value', () => {
    const entry = buildMalformedActionLog({
      route: '/admin?tab=versions',
      method: 'POST',
      nextActionHeader: 'x',
      userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
      requestId: 'req-1',
      releaseCommit: 'deadbeef',
    });

    expect(entry).toMatchObject({
      event: 'SERVER_ACTION_ID_INVALID',
      errorCode: 'FRONTEND_SERVER_ACTION_ID_INVALID',
      severity: 'warning',
      retryable: false,
      method: 'POST',
      status: 400,
      clientClass: 'browser',
      requestId: 'req-1',
      releaseCommit: 'deadbeef',
      actionIdLengths: [1],
      outcome: 'rejected',
    });
    // Route only: a query string can carry a token or an email address.
    expect(entry.route).toBe('/admin');
    expect(JSON.stringify(entry)).not.toContain('"x"');
    expect(JSON.stringify(entry)).not.toContain('Chrome');
  });

  it('reports a throttled request as 429', () => {
    const entry = buildMalformedActionLog({
      route: '/',
      method: 'POST',
      nextActionHeader: '0',
      userAgent: '',
      requestId: 'req-2',
      outcome: 'rate_limited',
    });

    expect(entry.status).toBe(429);
    expect(entry.clientClass).toBe('empty');
    expect(entry.releaseCommit).toBe('unknown');
  });
});

describe('createMalformedActionLimiter', () => {
  it('allows up to the budget inside a window, then throttles', () => {
    const limiter = createMalformedActionLimiter({ windowMs: 1000, max: 3 });
    const now = 1_000_000;

    expect([1, 2, 3].map(() => limiter.allow('1.2.3.4', now))).toEqual([true, true, true]);
    expect(limiter.allow('1.2.3.4', now)).toBe(false);
    // A different client keeps its own budget.
    expect(limiter.allow('5.6.7.8', now)).toBe(true);
  });

  it('resets the budget after the window', () => {
    const limiter = createMalformedActionLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.allow('1.2.3.4', 0)).toBe(true);
    expect(limiter.allow('1.2.3.4', 500)).toBe(false);
    expect(limiter.allow('1.2.3.4', 1001)).toBe(true);
  });

  it('forgets keys instead of growing without bound', () => {
    const limiter = createMalformedActionLimiter({ windowMs: 1000, max: 1, maxKeys: 2 });
    limiter.allow('a', 0);
    limiter.allow('b', 0);
    limiter.allow('c', 0); // trips the size guard and clears the map
    expect(limiter.allow('a', 0)).toBe(true);
  });
});

describe('clientKey', () => {
  it('uses the first forwarded address', () => {
    const headers = { get: (name: string) => (name === 'x-forwarded-for' ? '203.0.113.9, 10.0.0.1' : null) };
    expect(clientKey(headers)).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip and then to a constant', () => {
    const realIp = { get: (name: string) => (name === 'x-real-ip' ? '198.51.100.4' : null) };
    expect(clientKey(realIp)).toBe('198.51.100.4');
    expect(clientKey({ get: () => null })).toBe('unknown');
  });
});
