/**
 * Request hygiene for server action requests.
 *
 * Context (2026-09-15): production logged 75 `The Server Reference ID did not match
 * the expected format. Received "x".` errors in 96h. They were not a stale build or a
 * chunk mismatch — every one of them came from an external scan posting
 * `multipart/form-data` to `/`, `/admin`, `/signin`, … with a fabricated `Next-Action`
 * header whose value was `x`, `y`, `0`, `1` or `action`. Next.js only checks the
 * *length* of that id (`SERVER_REFERENCE_ID_LENGTH = 42`), so the framework logged an
 * unclassified, unattributable error per request: no route, no status, no request id,
 * no client class.
 *
 * This module holds the pure logic that lets middleware reject such a request early
 * with a classified, non-fatal log line — and, just as importantly, lets a legitimate
 * request through untouched. It mirrors Next's own rule exactly (an id is plausible
 * when it is 42 characters long), so it can never reject a request that the framework
 * would have accepted.
 */

/** Must match `SERVER_REFERENCE_ID_LENGTH` in next/dist/shared/lib/server-reference-info. */
export const SERVER_ACTION_ID_LENGTH = 42;

/** How a request identified itself. Coarse on purpose: no user-agent is logged verbatim. */
export type ClientClass = 'browser' | 'automated' | 'empty';

const AUTOMATED_PATTERN =
  /(bot|crawl|spider|scan|curl|wget|python|httpclient|okhttp|go-http|java\/|libwww|zgrab|masscan|nikto|nuclei)/i;

/** Classifies a user agent without storing it. */
export function classifyUserAgent(userAgent: string | null | undefined): ClientClass {
  const value = String(userAgent || '').trim();
  if (!value) return 'empty';
  return AUTOMATED_PATTERN.test(value) ? 'automated' : 'browser';
}

/**
 * Candidate action ids in a `Next-Action` header. Next accepts a single id, and some
 * clients send a comma-separated list; quotes/brackets/whitespace are cosmetic.
 */
export function serverActionIds(header: string | null | undefined): string[] {
  return String(header || '')
    .split(',')
    .map((token) => token.trim().replace(/^["'[\s]+|["'\]\s]+$/g, ''))
    .filter((token) => token.length > 0);
}

/**
 * True when no token in the header could be a server reference id. An empty or absent
 * header is *not* malformed here: a POST without `Next-Action` is an ordinary form
 * POST and belongs to the application, not to this guard.
 */
export function isMalformedServerActionHeader(header: string | null | undefined): boolean {
  if (header === null || header === undefined || String(header).trim() === '') return false;
  const ids = serverActionIds(header);
  if (ids.length === 0) return false;
  return !ids.some((id) => id.length === SERVER_ACTION_ID_LENGTH);
}

export type MalformedActionOutcome = 'rejected' | 'rate_limited';

export interface MalformedActionLog {
  event: 'SERVER_ACTION_ID_INVALID';
  errorCode: 'FRONTEND_SERVER_ACTION_ID_INVALID';
  severity: 'warning';
  retryable: false;
  /** Route only — never a query string, body or header value. */
  route: string;
  method: string;
  status: number;
  clientClass: ClientClass;
  requestId: string;
  releaseCommit: string;
  /** Action-id length(s) observed, for triage. Never the value itself. */
  actionIdLengths: number[];
  outcome: MalformedActionOutcome;
}

/**
 * Structured log payload for a rejected request. Deliberately excludes the header
 * value, the body, cookies and the full user agent: the operator needs to know that a
 * client is sending garbage and from which class of client, not what it sent.
 */
export function buildMalformedActionLog(input: {
  route: string;
  method: string;
  nextActionHeader: string | null | undefined;
  userAgent: string | null | undefined;
  requestId: string;
  releaseCommit?: string | null;
  outcome?: MalformedActionOutcome;
}): MalformedActionLog {
  const outcome = input.outcome || 'rejected';
  return {
    event: 'SERVER_ACTION_ID_INVALID',
    errorCode: 'FRONTEND_SERVER_ACTION_ID_INVALID',
    severity: 'warning',
    retryable: false,
    route: String(input.route || '/').split('?')[0].slice(0, 200),
    method: String(input.method || 'POST'),
    status: outcome === 'rate_limited' ? 429 : 400,
    clientClass: classifyUserAgent(input.userAgent),
    requestId: input.requestId,
    releaseCommit: String(input.releaseCommit || 'unknown'),
    actionIdLengths: serverActionIds(input.nextActionHeader).map((id) => id.length),
    outcome,
  };
}

export interface MalformedActionLimiter {
  /** Returns true when the caller may proceed, false when it should be throttled. */
  allow(key: string, now?: number): boolean;
}

/**
 * Small fixed-window limiter for repeated malformed requests from one client.
 *
 * This is the first line of defence only: middleware state is per server instance, so
 * the durable layer stays the host's fail2ban jail / Caddy. Bounded to `maxKeys`
 * entries so a distributed scan cannot grow the map without limit.
 */
export function createMalformedActionLimiter(options?: {
  windowMs?: number;
  max?: number;
  maxKeys?: number;
}): MalformedActionLimiter {
  const windowMs = options?.windowMs ?? 60_000;
  const max = options?.max ?? 20;
  const maxKeys = options?.maxKeys ?? 5_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    allow(key: string, now: number = Date.now()): boolean {
      if (buckets.size > maxKeys) buckets.clear();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      bucket.count += 1;
      return bucket.count <= max;
    },
  };
}

/** Client identity for throttling: the forwarded address, never a header the client can spoof freely. */
export function clientKey(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for') || headers.get('x-real-ip') || '';
  const first = forwarded.split(',')[0].trim();
  return first || 'unknown';
}
