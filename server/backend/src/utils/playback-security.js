const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { decryptSecret } = require('./crypto');

function buildPlaybackPath(contentType, contentId, tvCode, resource) {
  const params = new URLSearchParams({ contentType: String(contentType), contentId: String(contentId) });
  if (resource) params.set('resource', String(resource));
  const prefix = tvCode ? `/api/v1/tv/stream/${encodeURIComponent(String(tvCode))}` : '/api/v1/stream-proxy';
  return `${prefix}?${params.toString()}`;
}

function buildPlaybackUrl(req, contentType, contentId, tvCode, resource) {
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}${buildPlaybackPath(contentType, contentId, tvCode, resource)}`;
}

function buildPlaybackUrlForBase(baseUrl, contentType, contentId, tvCode, resource) {
  return `${String(baseUrl || '').replace(/\/$/, '')}${buildPlaybackPath(contentType, contentId, tvCode, resource)}`;
}

function isXtreamChannel(channel) {
  return channel?.metadata?.source === 'xtream' && Boolean(channel?.metadata?.xtreamSourceId);
}

function isManagedContent(content, contentType) {
  if (!content) return false;
  if (contentType === 'LIVE') return isXtreamChannel(content);
  if (contentType === 'MOVIE') return Boolean(content.sourceId && content.externalId);
  if (contentType === 'EPISODE') return Boolean(content.externalId && (content.sourceId || content.seasonId || content.seriesId));
  return false;
}

function toPlain(value) {
  if (!value) return value;
  return typeof value.toObject === 'function' ? value.toObject() : { ...value };
}

function modelFor(contentType) {
  if (contentType === 'LIVE') return require('../models/Channel');
  if (contentType === 'MOVIE') return require('../models/Movie');
  if (contentType === 'EPISODE') return require('../models/Episode');
  return null;
}

function filterFor(contentType, id) {
  if (contentType === 'LIVE') return { _id: id, isActive: { $ne: false } };
  if (contentType === 'MOVIE') return { _id: id, isActive: true };
  return { _id: id };
}

async function resolvePlaybackContent(contentType, contentId) {
  const id = mongoose.Types.ObjectId.isValid(contentId) ? new mongoose.Types.ObjectId(contentId) : null;
  const Model = modelFor(contentType);
  if (!id || !Model) return null;
  return Model.findOne(filterFor(contentType, id)).lean();
}

async function sourceIdFor(content, contentType) {
  if (contentType !== 'EPISODE') return contentType === 'LIVE' ? content?.metadata?.xtreamSourceId : content?.sourceId;
  if (content?.sourceId) return content.sourceId;
  if (!content?.seasonId) return null;
  const Season = require('../models/Season');
  const Series = require('../models/Series');
  const season = await Season.findById(content.seasonId).select('seriesId').lean();
  if (!season?.seriesId) return null;
  const series = await Series.findById(season.seriesId).select('sourceId').lean();
  return series?.sourceId || null;
}

function streamIdFor(content, contentType) {
  return contentType === 'LIVE' ? content?.metadata?.xtreamStreamId : content?.externalId;
}

function parseManagedResource(resource) {
  if (typeof resource !== 'string' || !resource || resource.length > 2048) return null;
  if (resource.includes('\0') || resource.includes('\\') || resource.includes('..')) return null;
  let parsed;
  try {
    parsed = new URL(resource, 'https://managed.invalid');
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://managed.invalid' || parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const match = parsed.pathname.match(/^\/(live|movie|series)\/(.+)$/i);
  if (!match) return null;
  const segments = match[2].split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\\\0]/.test(segment))) return null;
  const params = new URLSearchParams(parsed.search);
  for (const key of params.keys()) {
    if (!['token', 'expires', 'hash', 'sig'].includes(key.toLowerCase())) return null;
  }
  const signature = params.get('sig');
  params.delete('sig');
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return null;
  return { type: match[1].toLowerCase(), remainder: match[2], query: params, signature };
}

function resourceSignature(canonicalUrl, resource) {
  const secret = process.env.PLAYBACK_RESOURCE_SECRET;
  if (!secret) throw new Error('PLAYBACK_RESOURCE_SECRET is not configured');
  return crypto.createHmac('sha256', secret)
    .update(`${new URL(canonicalUrl).origin}${resource}`)
    .digest('hex');
}

function signedResourcePath(canonicalUrl, path) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}sig=${resourceSignature(canonicalUrl, path)}`;
}

function streamStem(pathname) {
  const last = pathname.split('/').filter(Boolean).at(-1) || '';
  return last.split('.')[0];
}

function streamIdMatchesContent(stem, content, contentType) {
  const expected = String(streamIdFor(content, contentType));
  return stem === expected || stem.startsWith(`${expected}_`) || stem.startsWith(`${expected}-`);
}

function assertManagedResource(resource, canonicalUrl, content, contentType, errorPrefix) {
  const parsed = parseManagedResource(resource);
  if (!parsed) throw new Error(`${errorPrefix}: invalid resource`);
  const canonical = new URL(canonicalUrl);
  const canonicalMatch = canonical.pathname.match(/^\/(live|movie|series)\/[^/]+\/[^/]+\/(.+)$/i);
  if (!canonicalMatch || parsed.type !== canonicalMatch[1].toLowerCase()) {
    throw new Error(`${errorPrefix}: media type mismatch`);
  }
  const resourceSegments = parsed.remainder.split('/');
  const resourceStem = streamStem(`/${parsed.type}/${parsed.remainder}`);
  const resourceRoot = streamStem(`/${parsed.type}/${resourceSegments[0] || ''}`);
  if (
    !resourceStem ||
    !resourceRoot ||
    !streamIdMatchesContent(resourceRoot, content, contentType)
  ) {
    throw new Error(`${errorPrefix}: resource is not associated with the requested stream`);
  }
  return parsed;
}

async function resolveManagedPlayback(contentType, contentId, resource) {
  const content = await resolvePlaybackContent(contentType, contentId);
  if (!content || !isManagedContent(content, contentType)) return null;
  const XtreamSource = require('../models/XtreamSource');
  const Series = require('../models/Series');
  const { buildXtreamStreamUrl } = require('../services/xtream-service');
  let sourceId = await sourceIdFor(content, contentType);
  if (contentType === 'EPISODE' && !sourceId) {
    const series = await Series.findById(content.seriesId).select('sourceId').lean();
    sourceId = series?.sourceId;
  }
  const streamId = streamIdFor(content, contentType);
  if ((contentType === 'MOVIE' || contentType === 'EPISODE') && !content.externalId) return null;
  if (!sourceId || streamId === undefined || streamId === null || streamId === '') return null;
  const source = await XtreamSource.findOne({ _id: sourceId, status: 'Active' }).lean();
  if (!source) return null;
  const credentials = {
    serverUrl: source.serverUrl,
    username: decryptSecret(source.usernameEncrypted),
    password: decryptSecret(source.passwordEncrypted),
  };
  const canonicalUrl = buildXtreamStreamUrl(credentials, contentType, streamId, content.containerExtension || 'm3u8');
  if (!resource) return { url: canonicalUrl, canonicalUrl, content, contentType };
  const parsed = assertManagedResource(resource, canonicalUrl, content, contentType, 'Managed playback resource');
  const canonical = new URL(canonicalUrl);
  const canonicalSegments = canonical.pathname.split('/').filter(Boolean);
  const upstream = new URL(canonical.origin);
  upstream.username = canonical.username;
  upstream.password = canonical.password;
  upstream.pathname = `/${canonicalSegments.slice(0, 3).concat(parsed.remainder.split('/')).join('/')}`;
  upstream.search = parsed.query.toString() ? `?${parsed.query.toString()}` : '';
  return { url: upstream.href, canonicalUrl, content, contentType };
}

function canonicalResourcePath(rawUrl, canonicalUrl, content, contentType) {
  const raw = new URL(rawUrl, canonicalUrl);
  const canonical = new URL(canonicalUrl);
  if (raw.origin !== canonical.origin || raw.protocol !== canonical.protocol || raw.username !== canonical.username || raw.password !== canonical.password) {
    throw new Error('Managed HLS reference points outside the canonical upstream');
  }
  const canonicalMatch = canonical.pathname.match(/^\/(live|movie|series)\/[^/]+\/[^/]+\/(.+)$/i);
  const rawMatch = raw.pathname.match(/^\/(live|movie|series)\/[^/]+\/[^/]+\/(.+)$/i);
  if (!canonicalMatch || !rawMatch) throw new Error('Managed HLS reference is not a media resource');
  const resourcePath = `/${rawMatch[1].toLowerCase()}/${rawMatch[2]}${raw.search}`;
  const signed = signedResourcePath(canonicalUrl, resourcePath);
  assertManagedResource(signed, canonicalUrl, content || {}, contentType || 'LIVE', 'Managed HLS reference');
  return signed;
}

function sanitizeManagedContent(value, contentType, req, tvCode) {
  const output = toPlain(value);
  if (!output) return output;
  const managed = isManagedContent(output, contentType);
  const hasManagedMarkers = contentType === 'LIVE'
    ? isXtreamChannel(output)
    : Boolean(output.sourceId || output.externalId || output.seasonId || output.seriesId);
  if (!managed && !hasManagedMarkers) return output;
  delete output.streamUrl;
  delete output.channelUrl;
  delete output.originalUrl;
  delete output.playbackUrl;
  if (!managed) return output;
  const id = mongoose.Types.ObjectId.isValid(output._id) ? output._id : null;
  output.playbackUrl = id && req ? buildPlaybackUrl(req, contentType, id, tvCode) : null;
  if (contentType === 'LIVE') output.alternateStreams = [];
  return output;
}

function sanitizeChannel(value, req, tvCode) {
  return sanitizeManagedContent(value, 'LIVE', req, tvCode);
}

function sanitizeVod(value, req, contentType = 'MOVIE', tvCode) {
  return sanitizeManagedContent(value, contentType, req, tvCode);
}

function redactSensitiveText(value) {
  if (value === undefined || value === null) return value;
  return String(value)
    .replace(/([?&](?:username|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\/(live|movie|series)\/[^/\s]+\/[^/\s]+\//gi, '/$1/[REDACTED]/[REDACTED]/');
}

function sanitizeXtreamUserInfo(value) {
  if (!value || typeof value !== 'object') return {};
  const output = {};
  const fields = { status: 'status', exp_date: 'expiresAt', is_trial: 'isTrial', active_cons: 'activeConnections', max_connections: 'maxConnections' };
  for (const [key, out] of Object.entries(fields)) if (value[key] !== undefined) output[out] = value[key];
  return output;
}

function sanitizeXtreamTestResult(result) {
  return {
    account: sanitizeXtreamUserInfo(result?.userInfo),
    server: { timezone: result?.serverInfo?.timezone || null, timeNow: result?.serverInfo?.time_now || null },
  };
}

function isManagedPlaybackRequest(req) {
  return Boolean(req.query.contentType && req.query.contentId);
}

module.exports = {
  buildPlaybackPath,
  buildPlaybackUrl,
  buildPlaybackUrlForBase,
  canonicalResourcePath,
  isXtreamChannel,
  isManagedContent,
  isManagedPlaybackRequest,
  resolvePlaybackContent,
  resolveManagedPlayback,
  sanitizeChannel,
  sanitizeManagedContent,
  sanitizeVod,
  sanitizeXtreamTestResult,
  sanitizeXtreamUserInfo,
  redactSensitiveText,
};
