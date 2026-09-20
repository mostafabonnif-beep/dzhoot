import axios from 'axios';
import http from 'http';
import https from 'https';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateUrlForSSRF, isPrivateIP, createPinnedLookup } = require('../utils/ssrf-guard');

export interface ProbeResult {
  status: 'alive' | 'dead';
  responseTimeMs: number;
  statusCode: number | null;
  error: string | null;
  manifestValid: boolean | null;
  segmentReachable: boolean | null;
  manifestInfo: {
    isLive: boolean;
    hasVideo: boolean;
    segmentCount: number;
  } | null;
}

interface ProbeOptions {
  timeout?: number;
  userAgent?: string;
  referrer?: string;
}

/**
 * Probe a stream URL to check liveness.
 * For HLS (.m3u8): validates manifest + HEAD checks the first segment.
 * For non-HLS: simple HTTP GET status check (200-399 = alive).
 */
export async function probeStream(url: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const { timeout = 15000, userAgent, referrer } = options;
  const startTime = Date.now();
  const headers: Record<string, string> = {
    'User-Agent': userAgent || 'VLC/3.0.18 LibVLC/3.0.18',
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate',
    Connection: 'close',
  };
  if (referrer) headers['Referer'] = referrer;

  // AbortController for the entire probe — cascading requests included
  const probeAbort = new AbortController();
  const probeTimer = setTimeout(() => probeAbort.abort(), timeout);
  // Deadline for cascading sub-requests (segment/variant checks)
  const cascadeTimeout = Math.min(8000, Math.max(timeout - 4000, 3000));

  // SSRF protection: validate URL before making outbound requests
  const ssrfCheck = await validateUrlForSSRF(url);
  if (!ssrfCheck.safe) {
    clearTimeout(probeTimer);
    return {
      status: 'dead' as const,
      responseTimeMs: Date.now() - startTime,
      statusCode: null,
      error: `Blocked: ${ssrfCheck.reason}`,
      manifestValid: null,
      segmentReachable: null,
      manifestInfo: null,
    };
  }

  const isHls = url.includes('.m3u8');

  // Pin DNS to prevent rebinding between validation and fetch
  // keepAlive: false ensures sockets are closed after each request
  const pinnedLookup = createPinnedLookup(ssrfCheck.resolvedAddresses, new URL(url).hostname);
  const httpAgent = new http.Agent({ lookup: pinnedLookup, keepAlive: false });
  const httpsAgent = new https.Agent({ lookup: pinnedLookup, keepAlive: false });

  // Shared redirect guard for all outbound requests in this probe
  const beforeRedirect = (options: any) => {
    const hostname = (options.hostname || '').replace(/^\[|\]$/g, '');
    if (
      isPrivateIP(hostname) ||
      ['localhost', 'metadata.google.internal'].includes(hostname.toLowerCase())
    ) {
      throw new Error('Redirect to private/internal address blocked');
    }
  };

  try {
    const response = await axios.get(url, {
      timeout,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 500,
      headers,
      httpAgent,
      httpsAgent,
      maxContentLength: isHls ? 512 * 1024 : 1024,
      responseType: isHls ? 'text' : 'stream',
      beforeRedirect,
      signal: probeAbort.signal,
    });

    const responseTimeMs = Date.now() - startTime;
    const statusCode = response.status;
    const httpOk = statusCode >= 200 && statusCode < 400;

    if (!httpOk) {
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
      return {
        status: 'dead',
        responseTimeMs,
        statusCode,
        error: `HTTP ${statusCode}`,
        manifestValid: null,
        segmentReachable: null,
        manifestInfo: null,
      };
    }

    // Non-HLS stream — reachable is enough
    if (!isHls) {
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
      return {
        status: 'alive',
        responseTimeMs,
        statusCode,
        error: null,
        manifestValid: null,
        segmentReachable: null,
        manifestInfo: null,
      };
    }

    // HLS manifest validation
    // For text responses, the socket may still be held open by the http agent.
    // Destroy the underlying socket to release it immediately.
    const socket = response.request?.socket || response.request?.res?.socket;
    if (socket && typeof socket.destroy === 'function' && !socket.destroyed) {
      socket.destroy();
    }

    const manifest = String(response.data);
    const manifestValid = manifest.includes('#EXTM3U') || manifest.includes('#EXT-X-');

    if (!manifestValid) {
      return {
        status: 'dead',
        responseTimeMs,
        statusCode,
        error: 'Invalid HLS manifest',
        manifestValid: false,
        segmentReachable: null,
        manifestInfo: null,
      };
    }

    const manifestInfo = {
      isLive: !manifest.includes('#EXT-X-ENDLIST'),
      hasVideo: manifest.includes('#EXTINF') || manifest.includes('#EXT-X-STREAM-INF'),
      segmentCount: (manifest.match(/#EXTINF/g) || []).length,
    };

    // Provider placeholder: an expired (or off-air) source answers with a valid manifest
    // whose only segment is a short black clip. The URL is not dead — the *subscription*
    // is, and naming that on the channel is the difference between "renew the account"
    // and "spend a day debugging probes" (measured 2026-09-20: 16,707 of 31,868 channels
    // served `black.ts` from a provider whose account expired on 2026-09-15, and every
    // one of them was reported as a generic all-sources-dead channel).
    const placeholderOnly =
      // The line ends with a newline inside the manifest, so the terminator is whitespace,
      // a query string or the end of the document — not just a query/end-of-string.
      /(^|\/)(black|black[_-]?out|no[_-]?signal)\.(ts|mp4|m4s)([?#\s]|$)/i.test(manifest) &&
      !manifestInfo.isLive;
    if (placeholderOnly) {
      return {
        status: 'dead',
        responseTimeMs,
        statusCode,
        error: 'Placeholder segment (black.ts) — provider account expired or channel off-air',
        manifestValid,
        // The manifest was parsed, not probed: the placeholder path returns before the
        // deep segment check runs, so there is no segment verdict to report.
        segmentReachable: null,
        manifestInfo,
      };
    }

    // Deep probe: try to reach the first segment
    let segmentReachable: boolean | null = null;
    const segmentUrl = extractFirstSegmentUrl(manifest, url);

    if (segmentUrl && !probeAbort.signal.aborted) {
      const segSsrf = await validateUrlForSSRF(segmentUrl);
      if (segSsrf.safe) {
        try {
          segmentReachable = await segmentIsReachable(segmentUrl, {
            headers,
            timeout: cascadeTimeout,
            beforeRedirect,
            signal: probeAbort.signal,
          });
        } catch {
          segmentReachable = false;
        }
      } else {
        segmentReachable = false;
      }
    }

    // If manifest is a master playlist (has #EXT-X-STREAM-INF but no #EXTINF segments),
    // try to probe the first variant playlist
    if (
      manifestInfo.segmentCount === 0 &&
      manifest.includes('#EXT-X-STREAM-INF') &&
      !probeAbort.signal.aborted
    ) {
      const variantUrl = extractFirstVariantUrl(manifest, url);
      if (variantUrl) {
        const varSsrf = await validateUrlForSSRF(variantUrl);
        if (varSsrf.safe) {
          try {
            const varRes = await axios.get(variantUrl, {
              timeout: cascadeTimeout,
              maxRedirects: 5,
              validateStatus: (s) => s >= 200 && s < 500,
              headers,
              maxContentLength: 512 * 1024,
              responseType: 'text',
              beforeRedirect,
              signal: probeAbort.signal,
            });
            // Destroy underlying socket for text response
            const varSocket = varRes.request?.socket || varRes.request?.res?.socket;
            if (varSocket && typeof varSocket.destroy === 'function' && !varSocket.destroyed) {
              varSocket.destroy();
            }
            if (varRes.status >= 200 && varRes.status < 400 && !probeAbort.signal.aborted) {
              const varManifest = String(varRes.data);
              const varSegUrl = extractFirstSegmentUrl(varManifest, variantUrl);
              if (varSegUrl) {
                const varSegSsrf = await validateUrlForSSRF(varSegUrl);
                if (varSegSsrf.safe) {
                  try {
                    segmentReachable = await segmentIsReachable(varSegUrl, {
                      headers,
                      timeout: cascadeTimeout,
                      beforeRedirect,
                      signal: probeAbort.signal,
                    });
                  } catch {
                    segmentReachable = false;
                  }
                } else {
                  segmentReachable = false;
                }
              }
            }
          } catch {
            // variant probe failed, keep whatever segmentReachable was
          }
        }
      }
    }

    const alive = manifestValid && (segmentReachable === true || segmentReachable === null);

    return {
      status: alive ? 'alive' : 'dead',
      responseTimeMs,
      statusCode,
      error: null,
      manifestValid,
      segmentReachable,
      manifestInfo,
    };
  } catch (error: any) {
    // Destroy any response stream that may be lingering from a partial read
    if (error.response?.data && typeof error.response.data.destroy === 'function') {
      error.response.data.destroy();
    }
    const errSocket = error.response?.request?.socket || error.response?.request?.res?.socket;
    if (errSocket && typeof errSocket.destroy === 'function' && !errSocket.destroyed) {
      errSocket.destroy();
    }

    const responseTimeMs = Date.now() - startTime;
    let errorMsg = 'Unknown error';
    let statusCode: number | null = null;

    if (
      error.code === 'ECONNABORTED' ||
      error.message?.includes('timeout') ||
      error.name === 'AbortError' ||
      error.name === 'CanceledError'
    ) {
      errorMsg = 'Timeout';
    } else if (error.code === 'ENOTFOUND') {
      errorMsg = 'DNS resolution failed';
    } else if (error.code === 'ECONNREFUSED') {
      errorMsg = 'Connection refused';
    } else if (error.response) {
      statusCode = error.response.status;
      errorMsg = `HTTP ${statusCode}`;
    } else if (error.code) {
      errorMsg = `${error.code}`;
    } else if (error.message) {
      errorMsg = error.message;
    }

    return {
      status: 'dead',
      responseTimeMs,
      statusCode,
      error: errorMsg,
      manifestValid: null,
      segmentReachable: null,
      manifestInfo: null,
    };
  } finally {
    clearTimeout(probeTimer);
    // Destroy agents to close any pooled sockets
    httpAgent.destroy();
    httpsAgent.destroy();
  }
}

/**
 * Extract the first .ts/.aac/.mp4 segment URL from an HLS manifest.
 */
/**
 * Is the segment actually fetchable?
 *
 * `HEAD` is not a reliable probe for media segments: plenty of CDNs answer it with
 * 405/403 (or not at all) while serving the very same URL to a ranged GET. Treating that
 * as "unreachable" declared *healthy* channels dead, and a dead primary is hidden from
 * customers by the health pipeline (measured 2026-09-20: a segment that returns 200 with
 * MPEG-TS data from a plain GET was reported `segmentReachable=false`).
 *
 * Keep HEAD as the cheap first try, then fall back to a single-byte ranged GET before
 * concluding the segment is unreachable.
 */
async function segmentIsReachable(
  segmentUrl: string,
  request: {
    headers: Record<string, string>;
    timeout: number;
    beforeRedirect: (options: any) => void;
    signal: AbortSignal;
  },
): Promise<boolean> {
  const release = (response: any) => {
    const socket = response?.request?.socket || response?.request?.res?.socket;
    if (socket && typeof socket.destroy === 'function' && !socket.destroyed) socket.destroy();
    const data = response?.data;
    if (data && typeof data.destroy === 'function') data.destroy();
  };

  try {
    const head = await axios.head(segmentUrl, {
      timeout: request.timeout,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 500,
      headers: request.headers,
      beforeRedirect: request.beforeRedirect,
      signal: request.signal,
    });
    if (head.status >= 200 && head.status < 400) return true;
  } catch {
    // fall through to the ranged GET
  }

  try {
    const ranged = await axios.get(segmentUrl, {
      timeout: request.timeout,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 500,
      headers: { ...request.headers, Range: 'bytes=0-0' },
      responseType: 'stream',
      beforeRedirect: request.beforeRedirect,
      signal: request.signal,
    });
    const ok = ranged.status >= 200 && ranged.status < 400;
    // Only the status line was needed — never leave a media body open.
    release(ranged);
    return ok;
  } catch {
    return false;
  }
}

function extractFirstSegmentUrl(manifest: string, manifestUrl: string): string | null {  const lines = manifest.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXTINF:')) {
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith('#')) {
        return resolveUrl(next, manifestUrl);
      }
    }
  }
  return null;
}

/**
 * Extract the first variant playlist URL from a master HLS manifest.
 */
function extractFirstVariantUrl(manifest: string, manifestUrl: string): string | null {
  const lines = manifest.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith('#')) {
        return resolveUrl(next, manifestUrl);
      }
    }
  }
  return null;
}

/**
 * Resolve a potentially relative URL against a base URL.
 */
function resolveUrl(relative: string, base: string): string {
  if (relative.startsWith('http://') || relative.startsWith('https://')) {
    return relative;
  }
  try {
    return new URL(relative, base).toString();
  } catch {
    // Fallback: manual path join
    const baseDir = base.substring(0, base.lastIndexOf('/') + 1);
    return baseDir + relative;
  }
}
