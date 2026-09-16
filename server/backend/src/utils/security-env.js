/**
 * One definition of "this runtime must use real secrets".
 *
 * The codebase used to test `NODE_ENV === 'production'` in some places and a
 * broader flag in others. A process started without NODE_ENV=production (a
 * misconfigured systemd unit, a bare `node dist/server.js`) then booted with
 * public development fallback secrets — the exact hole the security audit
 * closed in server.js. Every secret-deriving module now asks this module.
 *
 * `NODE_ENV=test` is exempt so unit tests stay hermetic; a local developer can
 * opt out explicitly with ALLOW_INSECURE_DEV_SECRETS=1.
 */
'use strict';

function securityEnforced() {
  return (
    process.env.NODE_ENV !== 'test' &&
    String(process.env.ALLOW_INSECURE_DEV_SECRETS || '').trim() !== '1'
  );
}

module.exports = { securityEnforced };
