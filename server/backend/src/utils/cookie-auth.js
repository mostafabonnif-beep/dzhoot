'use strict';

/**
 * httpOnly cookie helpers for browser sessions (F11 security refactor).
 *
 * Shared by CommonJS route modules (.js) and TypeScript middleware
 * (imported via `import cookieAuth = require('../utils/cookie-auth')`).
 *
 * No new dependencies: cookies are parsed/serialized by hand (the tiny
 * string splitting below) so nothing extra has to be installed or mounted.
 *
 * The backend keeps FULL backward compatibility: header auth is checked
 * FIRST and always wins, so Android apps and other API clients that never
 * send cookies are unaffected:
 *   - x-session-id     (DB sessions: users/admins)      -> SESSION_COOKIE
 *   - x-refresh-token  (JWT refresh token rotation)      -> REFRESH_COOKIE
 * Browsers get the same value mirrored into an httpOnly cookie, which keeps
 * credentials out of localStorage and JavaScript-readable storage entirely.
 */

const SESSION_COOKIE = 'dzhoof_sid';
const REFRESH_COOKIE = 'dzhoof_refresh';

const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 days

function isSecureEnv() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Cookie attributes used for every auth cookie this app sets.
 * `req` is kept in the signature for call-site symmetry (all helpers take
 * (req, res, ...) so route handlers can swap them in mechanically).
 */
function opts(req) {
  void req; // attributes are static per environment — no per-request data needed
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureEnv(),
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

/**
 * Parse the raw Cookie header into a { name: decodedValue } map.
 * Manual string splitting — split on ';' then trim so a stray space before
 * a separator cannot break parsing; each value is decodeURIComponent'd.
 */
function parseCookies(req) {
  const cookies = {};
  const header = req && req.headers && req.headers.cookie;
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep the raw value — a malformed cookie must never crash a request
    }
    cookies[name] = value;
  }
  return cookies;
}

/** Capitalize the first letter of an attribute value ("lax" -> "Lax"). */
function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * Serialize one cookie into a Set-Cookie header value (manual, dependency-free).
 * Matches the attributes from opts(); used for both set and clear (maxAge 0 +
 * epoch Expires makes the browser drop the stored cookie).
 */
function serializeCookie(name, value, cookieOpts) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (cookieOpts.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(cookieOpts.maxAge / 1000)}`);
    const expires =
      cookieOpts.maxAge > 0
        ? new Date(Date.now() + cookieOpts.maxAge)
        : new Date(0); // maxAge 0 → epoch, forces immediate deletion
    parts.push(`Expires=${expires.toUTCString()}`);
  }
  if (cookieOpts.path) parts.push(`Path=${cookieOpts.path}`);
  if (cookieOpts.secure) parts.push('Secure');
  if (cookieOpts.httpOnly) parts.push('HttpOnly');
  if (cookieOpts.sameSite) parts.push(`SameSite=${titleCase(cookieOpts.sameSite)}`);
  return parts.join('; ');
}

/** Append a Set-Cookie response header (keeps any headers already queued). */
function appendCookie(res, name, value, cookieOpts) {
  if (res && typeof res.append === 'function') {
    res.append('Set-Cookie', serializeCookie(name, value, cookieOpts));
  }
}

/** Persist the DB-session id as an httpOnly cookie (browser mirror of x-session-id). */
function setSessionCookie(req, res, sessionId) {
  appendCookie(res, SESSION_COOKIE, sessionId, opts(req));
}

/** Drop the DB-session cookie (logout / expired session). */
function clearSessionCookie(res) {
  appendCookie(res, SESSION_COOKIE, '', { ...opts({}), maxAge: 0 });
}

/** Persist the JWT refresh token as an httpOnly cookie. */
function setRefreshCookie(req, res, refreshToken) {
  appendCookie(res, REFRESH_COOKIE, refreshToken, opts(req));
}

/** Drop the JWT refresh cookie (logout / failed refresh). */
function clearRefreshCookie(res) {
  appendCookie(res, REFRESH_COOKIE, '', { ...opts({}), maxAge: 0 });
}

/**
 * Resolve the current DB-session id for a request.
 * Header first (Android/API clients), then the httpOnly cookie (browsers).
 * Returns null when neither is present.
 */
function getSessionId(req) {
  const fromHeader = req && req.headers && req.headers['x-session-id'];
  if (typeof fromHeader === 'string' && fromHeader) return fromHeader;
  return parseCookies(req)[SESSION_COOKIE] || null;
}

/**
 * Resolve the current JWT refresh token for a request.
 * Header first (x-refresh-token, API clients), then the httpOnly cookie
 * (browsers). Returns null when neither is present.
 */
function getRefreshToken(req) {
  const fromHeader = req && req.headers && req.headers['x-refresh-token'];
  if (typeof fromHeader === 'string' && fromHeader) return fromHeader;
  return parseCookies(req)[REFRESH_COOKIE] || null;
}

module.exports = {
  SESSION_COOKIE,
  REFRESH_COOKIE,
  opts,
  setSessionCookie,
  clearSessionCookie,
  getSessionId,
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshToken,
};
