import http from 'http';
import https from 'https';
import axios from 'axios';
import { issuePlaybackToken } from './playback-token';
import { createPinnedLookup, isPrivateIP, validateUrlForSSRF } from '../utils/ssrf-guard';
import { redactSensitiveText } from './audit-log';

const MAX_MANIFEST_SIZE = 10 * 1024 * 1024;

export interface ProxyTokenContext {
  userId: string;
  channelListCode: string;
}

export interface UpstreamHeaders {
  userAgent?: string;
  referrer?: string;
}

function nestedPlaybackUrl(
  absoluteUrl: string,
  tokenContext?: ProxyTokenContext,
  legacyCode?: string,
): string {
  if (tokenContext) {
    const { token } = issuePlaybackToken({
      userId: tokenContext.userId,
      channelListCode: tokenContext.channelListCode,
      streamUrl: absoluteUrl,
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

    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Content-Type': isManifest
        ? 'application/vnd.apple.mpegurl'
        : response.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

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
        const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
        const lines = data.split('\n');
        const rewrittenLines = lines.map((line: string) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return line;
          const resolveAndProxy = (rawUrl: string) => {
            const trimmed = rawUrl.trim();
            if (!trimmed) return trimmed;
            if (/^(data:|skd:|urn:|#)/i.test(trimmed)) return trimmed;
            if (trimmed.includes('/api/v1/tv/playback/') || trimmed.includes('/api/v1/tv/stream/')) return trimmed;
            let absolute: string;
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
              absolute = trimmed;
            } else if (trimmed.startsWith('/')) {
              try {
                const parsed = new URL(finalUrl);
                absolute = `${parsed.protocol}//${parsed.host}${trimmed}`;
              } catch {
                absolute = baseUrl + trimmed;
              }
            } else {
              absolute = baseUrl + trimmed;
            }
            return nestedPlaybackUrl(absolute, tokenContext, legacyCode);
          };
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

module.exports = { proxyUpstreamStream };
