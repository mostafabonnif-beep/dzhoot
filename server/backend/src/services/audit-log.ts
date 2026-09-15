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
  text = text.replace(/(https?:\/\/)([^\s/@:]+):([^\s/@:]+)@/gi, '$1[redacted]@');
  // Xtream-style stream URLs carry the account as path segments
  // (https://host:8080/live/<user>/<password>/1234.ts), so the query-parameter rule
  // above never sees them. This deliberately over-redacts a two-segment path under a
  // known stream prefix: garbled diagnostics are cheaper than a leaked account.
  text = text.replace(
    /(https?:\/\/[^\s/]+\/(?:live|movie|series|timeshift|vod)\/)[^\s/?#]+\/[^\s/?#]+\//gi,
    '$1[redacted]/[redacted]/',
  );
  text = text.replace(/([?&](?:username|user|password|pass|token|api[_-]?key|secret|auth)=)[^&\s]+/gi, '$1[redacted]');
  text = text.replace(/((?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*)(["']?)[^\s,"']+/gi, '$1$2[redacted]');
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]');
  // Signed JWTs (session, refresh and playback tokens) are base64url triples that
  // start with the base64 of `{"`.
  text = text.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}\b/g, '[redacted-jwt]');
  // Cookie/Set-Cookie header lines carry a session token verbatim and were the one
  // secret class the rules above never matched (found by the crash-report end-to-end
  // test on 2026-09-15: `cookie: session=…` was stored intact).
  text = text.replace(/((?:set-)?cookie\s*:\s*)[^\r\n]+/gi, '$1[redacted]');
  // Raw IPv4 addresses are neither needed to reproduce a failure nor safe to keep.
  // A dotted version string is a rare false positive in error text; privacy wins.
  // IPv6 is not covered (see docs/DIAGNOSTICS_AND_CRASH_REPORTS.md).
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
