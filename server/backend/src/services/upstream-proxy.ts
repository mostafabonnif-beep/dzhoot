import http from 'http';
import https from 'https';
import axios from 'axios';
import { issuePlaybackToken } from './playback-token';
import { createPinnedLookup, isPrivateIP, validateUrlForSSRF } from '../utils/ssrf-guard';
import { redactSensitiveText } from './audit-log';

const MAX_MANIFEST_SIZE = 10 * 1024 * 1024;

// Short-lived cache of upstream media playlists used to resolve segment URLs
// by absolute media sequence (normalized /playback/:token/segments/:seq path).
// Keyed by upstream manifest URL; entries live 3s — long enough to serve the
// window's segments, short enough to never serve a stale window.
const segmentManifestCache = new Map<string, { at: number; text: string; finalUrl: string }>();
const SEGMENT_MANIFEST_TTL_MS = 3_000;
const SEGMENT_MANIFEST_MAX_ENTRIES = 500;

export async function resolveSegmentUrlBySequence(
  manifestUrl: string,
  seq: number,
  upstreamHeaders?: UpstreamHeaders,
): Promise<string | null> {
  const key = String(manifestUrl || '');
  if (!key) return null;
  let cached = segmentManifestCache.get(key);
  if (!cached || Date.now() - cached.at > SEGMENT_MANIFEST_TTL_MS) {
    const ssrfCheck = await validateUrlForSSRF(manifestUrl);
    if (!ssrfCheck.safe || !ssrfCheck.resolvedAddresses?.length) return null;
    const pinnedLookup = createPinnedLookup(ssrfCheck.resolvedAddresses);
    const httpAgent = new http.Agent({ lookup: pinnedLookup });
    const httpsAgent = new https.Agent({ lookup: pinnedLookup });
    const response = await axios.get(manifestUrl, {
      responseType: 'text',
      timeout: 15_000,
      httpAgent,
      httpsAgent,
      headers: {
        'User-Agent': upstreamHeaders?.userAgent || 'VLC/3.0.18 LibVLC/3.0.18',
        ...(upstreamHeaders?.referrer ? { Referer: upstreamHeaders.referrer } : {}),
        Accept: '*/*',
        'Accept-Encoding': 'gzip, deflate',
      },
      maxRedirects: 5,
    });
    const finalUrl =
      response.request?.res?.responseUrl || response.request?.responseURL || manifestUrl;
    cached = { at: Date.now(), text: String(response.data || ''), finalUrl };
    segmentManifestCache.set(key, cached);
    if (segmentManifestCache.size > SEGMENT_MANIFEST_MAX_ENTRIES) {
      const oldestKey = segmentManifestCache.keys().next().value as string;
      segmentManifestCache.delete(oldestKey);
    }
  }
  let mediaSequence = 0;
  let sawSequence = false;
  let position = 0;
  for (const rawLine of cached.text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const seqMatch = line.match(/^#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/);
    if (seqMatch) {
      mediaSequence = parseInt(seqMatch[1], 10);
      sawSequence = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    const absoluteSeq = sawSequence ? mediaSequence + position : position;
    position += 1;
    if (absoluteSeq === seq) {
      try {
        return new URL(line, cached.finalUrl).toString();
      } catch {
        return line;
      }
    }
  }
  return null;
}

export interface ProxyTokenContext {
  userId: string;
  channelListCode: string;
  /** Root playback session that authorizes nested HLS playlists, keys and segments. */
  sessionId?: string;
  /** Client-visible root playback token — media-playlist segments are addressed under it. */
  rootToken?: string;
}

export interface UpstreamHeaders {
  userAgent?: string;
  referrer?: string;
}

function nestedPlaybackUrl(
  absoluteUrl: string,
  tokenContext?: ProxyTokenContext,
  legacyCode?: string,
  upstreamHeaders?: UpstreamHeaders,
): string {
  if (tokenContext) {
    const { token } = issuePlaybackToken({
      userId: tokenContext.userId,
      channelListCode: tokenContext.channelListCode,
      streamUrl: absoluteUrl,
      upstreamHeaders,
      // HLS manifests may reference playlists, keys and segments recursively.
      // All of those child tokens must remain tied to the root concurrent-stream
      // session instead of being treated as independent, unregistered sessions.
      sessionId: tokenContext.sessionId,
    });
    return `/api/v1/tv/playback/${token}`;
  }
  return legacyCode
    ? `/api/v1/tv/stream/${legacyCode}?url=${encodeURIComponent(absoluteUrl)}`
    : absoluteUrl;
}

export async function proxyUpstreamStream(
  req: any,
  res: any,
  url: string,
  tokenContext?: ProxyTokenContext,
  legacyCode?: string,
  upstreamHeaders?: UpstreamHeaders,
): Promise<void> {
  try {
    try {
      new URL(url);
    } catch {
      if (!res.headersSent) res.status(400).send('Invalid URL format');
      return;
    }

    const ssrfCheck = await validateUrlForSSRF(url);
    if (!ssrfCheck.safe || !ssrfCheck.resolvedAddresses?.length) {
      if (!res.headersSent) res.status(403).send(ssrfCheck.reason || 'Stream URL blocked by security policy');
      return;
    }

    const pinnedLookup = createPinnedLookup(ssrfCheck.resolvedAddresses);
    const httpAgent = new http.Agent({ lookup: pinnedLookup });
    const httpsAgent = new https.Agent({ lookup: pinnedLookup });
    const requestedRange = typeof req.headers?.range === 'string' ? req.headers.range : undefined;
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 30_000,
      httpAgent,
      httpsAgent,
      headers: {
        'User-Agent': upstreamHeaders?.userAgent || 'VLC/3.0.18 LibVLC/3.0.18',
        ...(upstreamHeaders?.referrer ? { Referer: upstreamHeaders.referrer } : {}),
        Accept: '*/*',
        'Accept-Encoding': 'gzip, deflate',
        ...(requestedRange ? { Range: requestedRange } : {}),
        Connection: 'keep-alive',
      },
      maxRedirects: 5,
      beforeRedirect: (options) => {
        const hostname = (options.hostname || '').replace(/^\[|\]$/g, '');
        if (isPrivateIP(hostname) || ['localhost', 'metadata.google.internal'].includes(hostname.toLowerCase())) {
          throw new Error('Redirect to private/internal address blocked');
        }
      },
    });

    const finalUrl = response.request?.res?.responseUrl || response.request?.responseURL || url;
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    const isManifest =
      url.includes('.m3u8') ||
      finalUrl.includes('.m3u8') ||
      contentType.includes('mpegurl') ||
      contentType.includes('apple.mpegurl');

    // Preserve HTTP range semantics and response metadata. Media3 may use byte-range
    // requests for MPEG-TS/HLS segments; discarding 206 or Content-Range makes a healthy
    // upstream appear as an unplayable source on Android.
    res.status(response.status).set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Content-Type': isManifest
        ? 'application/vnd.apple.mpegurl'
        : response.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    for (const header of ['content-length', 'content-range', 'accept-ranges']) {
      const value = response.headers[header];
      if (value !== undefined) res.setHeader(header, value);
    }

    if (isManifest) {
      let data = '';
      let dataSize = 0;
      const closeUpstream = () => {
        if (!response.data.destroyed) response.data.destroy();
      };
      req.once('aborted', closeUpstream);
      req.once('close', closeUpstream);
      res.once('close', closeUpstream);
      response.data.on('data', (chunk: Buffer) => {
        dataSize += chunk.length;
        if (dataSize > MAX_MANIFEST_SIZE) {
          response.data.destroy();
          if (!res.headersSent) res.status(413).send('Manifest too large');
          return;
        }
        data += chunk.toString();
      });

      response.data.on('end', () => {
        if (res.headersSent) return;
        const lines = data.split('\n');
        const resolveAgainstFinalUrl = (rawUrl: string): string => {
          try {
            return new URL(rawUrl, finalUrl).toString();
          } catch {
            return rawUrl;
          }
        };

        // ── Media playlist normalization ──────────────────────────────────────
        // Some upstreams (e.g. NEO) emit media playlists that are technically
        // valid but that several players handle badly: segment durations equal
        // to TARGETDURATION, the obsolete #EXT-X-ALLOW-CACHE tag, and — after
        // tokenization — per-segment 500+ char child-token URLs that change on
        // every playlist reload. AndroidX Media3 in particular reports
        // ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED and never fetches a segment.
        // For plain media playlists we therefore emit a normalized playlist:
        //   - short, stable segment URLs under the ROOT token
        //     (/api/v1/tv/playback/<root>/segments/<abs-seq>.ts)
        //   - TARGETDURATION raised to ceil(max segment duration) + 1
        //   - obsolete #EXT-X-ALLOW-CACHE dropped
        // Master playlists (variants/renditions) keep the child-token rewrite,
        // which resolves recursively through the same proxy.
        const resolveAndProxy = (rawUrl: string) => {
          const trimmed = String(rawUrl || '').trim();
          if (!trimmed) return trimmed;
          if (/^(data:|skd:|urn:|#)/i.test(trimmed)) return trimmed;
          if (trimmed.includes('/api/v1/tv/playback/') || trimmed.includes('/api/v1/tv/stream/')) return trimmed;
          const absolute = resolveAgainstFinalUrl(trimmed);
          return nestedPlaybackUrl(absolute, tokenContext, legacyCode, upstreamHeaders);
        };
        const isMaster =
          /#EXT-X-STREAM-INF|#EXT-X-MEDIA:/.test(lines.join('\n'));
        const normalized =
          !isMaster && tokenContext?.rootToken && tokenContext.sessionId;
        if (normalized) {
          let mediaSequence = 0;
          let sawSequence = false;
          let maxDurationSec = 0;
          const durations: number[] = [];
          for (const line of lines) {
            const m = line.trim();
            const seqMatch = m.match(/^#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/);
            if (seqMatch) {
              mediaSequence = parseInt(seqMatch[1], 10);
              sawSequence = true;
            }
            const infMatch = m.match(/^#EXTINF:\s*([\d.]+)/);
            if (infMatch) {
              const dur = parseFloat(infMatch[1]);
              durations.push(Number.isFinite(dur) ? dur : 0);
            }
          }
          if (durations.length) maxDurationSec = Math.max(...durations);
          const targetDurationSec = Math.ceil(maxDurationSec) + 1;
          let position = 0;
          const rewrittenLines = lines.map((line: string) => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return line;
            if (trimmedLine.startsWith('#EXT-X-TARGETDURATION')) {
              return `#EXT-X-TARGETDURATION:${targetDurationSec}`;
            }
            if (trimmedLine.startsWith('#EXT-X-ALLOW-CACHE')) {
              return ''; // obsolete tag (RFC 8216 §4.3.3.5) — drop it
            }
            if (trimmedLine.startsWith('#')) {
              // Keys / init segments / other URI="..." attributes.
              return line.replace(/URI="([^"]+)"/gi, (match: string, uri: string) => {
                return `URI="${resolveAndProxy(uri)}"`;
              });
            }
            // Segment URI — absolute sequence index under the root token.
            const absoluteSeq = sawSequence ? mediaSequence + position : position;
            position += 1;
            return `/api/v1/tv/playback/${tokenContext.rootToken}/segments/${absoluteSeq}.ts`;
          });
          res.send(rewrittenLines.join('\n'));
          return;
        }

        const rewrittenLines = lines.map((line: string) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return line;
          if (trimmedLine.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/gi, (match: string, uri: string) => {
              return `URI="${resolveAndProxy(uri)}"`;
            });
          }
          return resolveAndProxy(trimmedLine);
        });
        res.send(rewrittenLines.join('\n'));
      });

      response.data.on('error', (error: unknown) => {
        req.off('aborted', closeUpstream);
        req.off('close', closeUpstream);
        res.off('close', closeUpstream);
        console.error('[upstream-proxy] manifest error:', redactSensitiveText(error));
        if (!res.headersSent) res.status(500).send('Stream error');
      });
      response.data.on('end', () => {
        req.off('aborted', closeUpstream);
        req.off('close', closeUpstream);
        res.off('close', closeUpstream);
      });
    } else {
      response.data.pipe(res);
      response.data.on('error', (error: unknown) => {
        console.error('[upstream-proxy] stream error:', redactSensitiveText(error));
        if (!res.headersSent) res.status(500).send('Stream error');
      });
      req.on('close', () => response.data.destroy());
    }
  } catch (error: any) {
    console.error('[upstream-proxy] request error:', redactSensitiveText(error));
    if (res.headersSent) return;
    if (error.response) res.status(error.response.status).send(error.response.statusText);
    else if (error.code === 'ECONNABORTED') res.status(504).send('Gateway Timeout');
    else res.status(502).send('Bad Gateway');
  }
}

module.exports = { proxyUpstreamStream, resolveSegmentUrlBySequence };
