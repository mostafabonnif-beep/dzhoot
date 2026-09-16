/**
 * Channel-group access scope (the freemium boundary).
 *
 * A user's visible Live catalog can be limited to a set of channel groups:
 *   - Paid plans carry `channelGroups` (empty = every group).
 *   - Redeeming a code copies the plan's groups onto `user.accessGroups`.
 *   - The shared free/demo code is scoped by the operator's `free_access`
 *     setting, falling back to the legacy `DEMO_CHANNEL_GROUPS` env.
 *
 * Groups are matched against `Channel.channelGroup` exactly — the same values
 * the operator picks in the control panel.
 *
 * This module is the single source of truth so the playlist, the playback
 * token, the stream authorization, the channel list and the category list can
 * never disagree about what a given code may watch.
 */

const AppSetting = require('../models/AppSetting');

/** Hard cap mirrors the admin API — groups are short labels, never URLs. */
const MAX_GROUPS = 200;
const MAX_GROUP_LENGTH = 200;

/** Legacy fallback for the demo/free code; `free_access.channelGroups` wins. */
const DEMO_CHANNEL_GROUPS = (process.env.DEMO_CHANNEL_GROUPS || 'AR| ALGERIA الجزائر')
  .split(',')
  .map((group) => group.trim())
  .filter(Boolean);

// Settings are read on hot paths (every playlist and playback request), so a
// short in-process cache keeps Mongo out of the streaming loop. Operators save
// settings rarely; a 30s staleness is invisible.
const SETTINGS_TTL_MS = 30 * 1000;
const settingsCache = new Map(); // key -> { at, value }

async function readSetting(key, fallback) {
  const cached = settingsCache.get(key);
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.value;
  let value = fallback;
  try {
    const doc = await AppSetting.findOne({ key }).lean();
    const raw = doc?.value;
    if (raw !== undefined && raw !== null && raw !== '') value = raw;
  } catch {
    // Never block streaming on a settings read failure — fall back to default.
    value = fallback;
  }
  settingsCache.set(key, { at: Date.now(), value });
  return value;
}

/** Clear the cache (tests, and after an admin saves a setting). */
function clearScopeCache() {
  settingsCache.clear();
}

/** The operator's free-tier scope: `{ enabled, channelGroups, showAds }`. */
async function getFreeAccessConfig() {
  const raw = await readSetting('free_access', {});
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: value.enabled === true,
    channelGroups: normalizeGroupList(value.channelGroups),
    showAds: value.showAds !== false,
  };
}

/** Trim, drop empties, dedupe, cap. A comma-separated string is accepted too. */
function normalizeGroupList(input) {
  if (input === undefined || input === null) return [];
  const raw = Array.isArray(input) ? input : String(input).split(',');
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const value = String(item ?? '').trim();
    if (!value || value.length > MAX_GROUP_LENGTH) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_GROUPS) break;
  }
  return out;
}

/** True when the user belongs to the ad-supported free tier. */
function isFreeTierUser(user) {
  return user?.demo === true || user?.freeAccess === true;
}

/**
 * The groups that scope this user's catalog, or null when unrestricted.
 * Precedence: admin → user.accessGroups → free-tier setting → demo env legacy.
 */
async function allowedGroupsForUser(user) {
  if (!user) return null;
  // Admins always see the full catalog — they are the operators.
  if (user.role === 'Admin') return null;
  const explicit = normalizeGroupList(user.accessGroups);
  if (explicit.length) return explicit;
  if (!isFreeTierUser(user)) return null;
  const freeConfig = await getFreeAccessConfig();
  if (freeConfig.enabled) {
    // Panel-managed free tier: the operator's list is authoritative. An empty
    // list is a deliberate choice — the free tier sees the whole catalog (with
    // ads), instead of silently falling back to the legacy env groups.
    return freeConfig.channelGroups.length ? freeConfig.channelGroups : null;
  }
  // Free tier not (yet) managed from the panel: keep the legacy demo scoping so
  // an upgrade never changes what the existing demo code can watch.
  const legacy = normalizeGroupList(DEMO_CHANNEL_GROUPS);
  return legacy.length ? legacy : null;
}

/** True when this user may watch this channel (group scope aware). */
async function isChannelAllowedForUser(user, channel) {
  const groups = await allowedGroupsForUser(user);
  if (!groups) return true;
  const group = String(channel?.channelGroup ?? '').trim();
  return groups.includes(group);
}

/**
 * True when this user's code may watch a channel in `group`.
 * `allowedGroupsForUser` returning null means "unrestricted" → allow.
 */
async function isGroupAllowedForUser(user, group) {
  const groups = await allowedGroupsForUser(user);
  if (!groups) return true;
  return groups.includes(String(group ?? '').trim());
}

/**
 * Merge the user's group scope into a Mongo query object.
 * Mutates and returns `query` for convenient chaining at call sites.
 */
async function applyGroupScope(user, query = {}) {
  const groups = await allowedGroupsForUser(user);
  if (groups) query.channelGroup = { $in: groups };
  return query;
}

/** Same as {@link applyGroupScope}, expressed as a standalone `$and` clause. */
async function groupScopeClause(user) {
  const groups = await allowedGroupsForUser(user);
  if (!groups) return null;
  return { channelGroup: { $in: groups } };
}

/** Distinct groups present in the shared catalog, for the admin picker. */
async function listCatalogGroups() {
  const mongoose = require('mongoose');
  const Channel = mongoose.model('Channel');
  const groups = await Channel.distinct('channelGroup', {
    ownerId: null,
    channelGroup: { $nin: ['', null] },
  });
  return groups
    .map((group) => String(group).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

module.exports = {
  MAX_GROUPS,
  DEMO_CHANNEL_GROUPS,
  normalizeGroupList,
  isFreeTierUser,
  getFreeAccessConfig,
  allowedGroupsForUser,
  isChannelAllowedForUser,
  isGroupAllowedForUser,
  applyGroupScope,
  groupScopeClause,
  listCatalogGroups,
  clearScopeCache,
};
