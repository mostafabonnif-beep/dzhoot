'use strict';

/**
 * Device identity for concurrent-stream sessions (anti account-sharing).
 *
 * `registerStreamSession` uses this hash for ONE narrow purpose: when the
 * subscription is already at its concurrent limit, a session may only be
 * replaced if it belongs to the SAME device (reconnect, Wi-Fi/LTE hand-over,
 * Multiview on one box, restarting a channel). Two DIFFERENT devices sharing
 * one subscription are refused instead.
 *
 * The hash is derived from identifiers the request ALREADY carries — no new
 * fingerprinting, no client change, no new header is invented here:
 *   1. `deviceId` from the request (body → query → `X-Device-Id` header): the
 *      same identifier the app registers a device with `/me/devices`.
 *   2. the existing browser playback-binding hash (`clientBindingHash`, minted
 *      from the `__Host-dzhoof-playback` cookie by the tv routes).
 *   3. the authenticated session credential (`X-Session-Id` header or the
 *      session cookie) — persisted per install by the app, so it is stable
 *      across reconnects on the same device.
 * When none of these exist the caller gets `undefined`, and the strict policy
 * (STREAM_LIMIT_POLICY=refuse) then treats the request as an unknown device.
 */
const crypto = require('crypto');
const cookieAuth = require('./cookie-auth');

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** sha256 of an explicit identifier, or undefined when there is nothing to hash. */
function hashStreamDeviceValue(value) {
  if (Array.isArray(value)) value = value[0];
  const raw = typeof value === 'string' ? value.trim() : String(value || '').trim();
  if (!raw || raw.length > 512) return undefined;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Resolve the device hash for a playback request.
 * @param {import('express').Request} req
 * @param {string} [fallbackHash] already-hashed binding (`clientBindingHash`)
 * @returns {string|undefined} 64-hex hash, or undefined when the device is unknown
 */
function resolveStreamDeviceHash(req, fallbackHash) {
  const explicit = req?.body?.deviceId ?? req?.query?.deviceId ?? req?.headers?.['x-device-id'];
  const hashed = hashStreamDeviceValue(explicit);
  if (hashed) return hashed;

  const binding = typeof fallbackHash === 'string' ? fallbackHash.trim() : '';
  if (SHA256_HEX.test(binding)) return binding.toLowerCase();

  const sessionId = cookieAuth.getSessionId(req);
  return hashStreamDeviceValue(sessionId);
}

module.exports = { hashStreamDeviceValue, resolveStreamDeviceHash };
