import AuditLog from '../models/AuditLog';

interface LogOptions {
  /** Optional: pre-auth/system events have no authenticated user. */
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string;
  changes?: { before?: any; after?: any };
  ipAddress?: string;
  userAgent?: string;
  status?: 'success' | 'failure';
  errorMessage?: string;
}

// High-volume, low-value actions we don't persist — they dominated the audit log (~81% of rows)
// and provide little forensic value. Liveness/health probing is already visible in scheduler runs.
const NOISY_ACTIONS = new Set([
  'test_channel',
  'test_channel_batch',
  'test_channel_all',
  'check_liveness_single',
  'check_liveness_batch',
]);

/**
 * Remove credentials, bearer tokens and common secret query parameters from diagnostics.
 * `maxLength` bounds the stored text (audit entries keep 1000 characters; crash-report
 * stack traces pass a larger bound and are redacted the same way).
 */
export function redactSensitiveText(value: unknown, maxLength = 1000): string {
  let text = value instanceof Error ? value.message : String(value ?? 'Unknown error');
  // Any scheme, not just http(s): an IPTV failure routinely carries an `rtsp://` or
  // `rtmp://` URL with the account in the userinfo section.
  // Every quantifier is bounded. An unbounded `[a-z0-9+.-]*` makes the engine retry from
  // every start position on a long run of one character — a polynomial blowup on
  // attacker-controlled text, which CodeQL flagged on the first version of this rule.
  text = text.replace(/([a-z][a-z0-9+.-]{0,31}:\/\/)([^\s/@:]{1,256}):([^\s/@:]{1,256})@/gi, '$1[redacted]@');
  // Xtream-style stream URLs carry the account as path segments
  // (https://host:8080/live/<user>/<password>/1234.ts), so the query-parameter rule
  // above never sees them. This deliberately over-redacts a two-segment path under a
  // known stream prefix: garbled diagnostics are cheaper than a leaked account.
  text = text.replace(
    /(https?:\/\/[^\s/]{1,256}\/(?:live|movie|series|timeshift|vod)\/)[^\s/?#]{1,256}\/[^\s/?#]{1,256}\//gi,
    '$1[redacted]/[redacted]/',
  );
  // Header lines first: an `Authorization:` value is a scheme plus a credential
  // (`Basic dXNlcjpwYXNz`), and the assignment rule below only consumed the scheme
  // word, leaving the base64 credential in place. Consuming the whole value to the
  // end of the line is the only reliable form for a header.
  text = text.replace(
    /((?:set-)?cookie|proxy-authorization|authorization)(\s*:\s*)[^\r\n]{1,4096}/gi,
    '$1$2[redacted]',
  );
  // Auth schemes can also appear inline without the header form
  // (`upstream said: Basic dXNlcjpwYXNz`).
  text = text.replace(/((?:\bbasic|\bdigest|\bnegotiate)\s{1,8})[A-Za-z0-9._~+/=-]{6,512}/gi, '$1[redacted]');
  text = text.replace(/([?&](?:username|user|password|pass|passwd|token|api[_-]?key|secret|auth|authorization|session|sessionid|session[_-]?id|cookie|cookies|sid)=)[^&\s]{1,2000}/gi, '$1[redacted]');
  // The key may be quoted and/or JSON-encoded: `{"password":"hunter2"}` is exactly
  // what `JSONObject.toString()` puts in a throwable message, and the rule below never
  // matched it because it required `[:=]` immediately after the bare key name.
  // `[\s"']{0,8}` replaces an ambiguous `\s*["']?\s*`: the original could match the
  // same text in several ways, which is the other half of the polynomial blowup.
  text = text.replace(
    /((?:password|passwd|secret|token|api[_-]?key|authorization|auth|session|sessionid|session[_-]?id|cookie|cookies|pin|credentials?)[\s"']{0,8}[:=]\s{0,8})(["']?)[^\s,"'&}]{1,2000}/gi,
    '$1$2[redacted]',
  );
  text = text.replace(/(Bearer\s{1,8})[A-Za-z0-9._~+/=-]{1,4096}/gi, '$1[redacted]');
  // Signed JWTs (session, refresh and playback tokens) are base64url triples that
  // start with the base64 of `{"`.
  text = text.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}\b/g, '[redacted-jwt]');
  // Raw IP addresses are neither needed to reproduce a failure nor safe to keep.
  // A dotted version string is a rare false positive in error text; privacy wins.
  // IPv6 was the documented gap here (`docs/DIAGNOSTICS_AND_CRASH_REPORTS.md`): it is
  // now covered by three shapes — a compressed address (contains `::`, which keeps a
  // time like `12:34:56` from matching), the full eight-group form, and the bracketed
  // form used in URLs.
  text = text.replace(
    /\[[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7}\]|\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})?\b|(?<![0-9a-fA-F:])::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})?\b/g,
    '[redacted-ip]',
  );
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]');
  return text.slice(0, maxLength);
}

/** Fire-and-forget audit log entry. Never throws. */
export function audit(opts: LogOptions): void {
  if (NOISY_ACTIONS.has(opts.action)) return;

  AuditLog.create({
    userId: opts.userId,
    action: opts.action,
    resource: opts.resource,
    resourceId: opts.resourceId,
    changes: opts.changes,
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
    status: opts.status || 'success',
    errorMessage: opts.errorMessage ? redactSensitiveText(opts.errorMessage) : undefined,
  }).catch((err: Error) => {
    console.error('[audit] Failed to write audit log:', err.message);
  });
}

/** Helper to extract common request context */
export function reqCtx(req: any) {
  return {
    userId: req.user?.id,
    ipAddress: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers?.['user-agent'],
  };
}

module.exports = { audit, reqCtx, redactSensitiveText };
