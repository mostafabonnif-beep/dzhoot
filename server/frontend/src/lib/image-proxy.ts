import { useAuthStore } from '@/store/auth-store';

/**
 * Image proxying without credentials in URLs.
 *
 * The old helper appended ?sid=<sessionId> / ?token=<jwt> to the proxy query
 * string so that plain <img src> requests could authenticate — but those live
 * credentials leak into Caddy access logs and browser history. New code must
 * resolve remote images through `getSignedImageUrl`, which exchanges the
 * session (sent as a header) for a short-lived HMAC signature (10 min TTL)
 * that is safe to embed in an <img> src.
 *
 * `proxyImageUrl` is kept exported only for compatibility with call sites that
 * attach an auth header themselves via fetch/XHR (the backend still requires a
 * live session there). It must NOT be used for <img> tags anymore — the
 * unsigned URL it returns is 401 without session headers.
 */

const SIGN_PATH = '/api/v1/image-proxy/sign';
/** Re-sign 60s before the server-side expiry so cached <img> URLs never 401. */
const SIGN_TTL_BUFFER_MS = 60_000;
/** Bounded in-module cache — evicts the oldest entry past this size. */
const MAX_CACHE_ENTRIES = 500;

interface SignedCacheEntry {
  signedPath: string;
  /** Epoch ms after which the entry is stale (server exp minus buffer). */
  expiresAt: number;
}

const signedCache = new Map<string, SignedCacheEntry>();
const inflight = new Map<string, Promise<string>>();
let warnedOnce = false;

/** True for absolute http(s) URLs — the only kind the proxy signs. */
function isProxiableRemoteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resolve a short-lived signed proxy path for a remote image URL.
 * Returns '' when the image cannot be loaded through the proxy: falsy input,
 * relative/local paths (never proxied — callers render those directly),
 * non-http(s) URLs, unauthenticated sessions, 401/error responses and network
 * failures. The caller should then hide the image or use its fallback;
 * credentials are NEVER embedded in the URL as a fallback.
 * On success returns `/api/v1/image-proxy?url=..&exp=..&sig=..` (cached until
 * `exp` minus 60s).
 */
export async function getSignedImageUrl(url: string | undefined | null): Promise<string> {
  if (!url) return '';
  if (url.startsWith('/')) return ''; // relative — served directly, never proxied
  if (!isProxiableRemoteUrl(url)) return ''; // data:/javascript:/garbage → never proxy

  const now = Date.now();
  const cached = signedCache.get(url);
  if (cached && cached.expiresAt > now) return cached.signedPath;

  // Reuse an in-flight request for the same URL instead of double-signing.
  const pending = inflight.get(url);
  if (pending) return pending;

  const { sessionId, accessToken } = useAuthStore.getState();
  if (!sessionId && !accessToken) return ''; // nothing to sign with

  const promise = (async () => {
    try {
      const headers: Record<string, string> = sessionId
        ? { 'x-session-id': sessionId }
        : { Authorization: `Bearer ${accessToken}` };
      const res = await fetch(`${SIGN_PATH}?url=${encodeURIComponent(url)}`, {
        headers,
        credentials: 'same-origin',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return ''; // 401 (missing/invalid session) or any error → no image
      const data = (await res.json()) as { exp?: unknown; sig?: unknown; url?: unknown };
      if (typeof data.sig !== 'string' || typeof data.url !== 'string') return '';

      const signedPath = data.url;
      const serverExp = Number(data.exp);
      const expiresAt = (Number.isFinite(serverExp) ? serverExp : Date.now()) - SIGN_TTL_BUFFER_MS;
      if (signedCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = signedCache.keys().next().value;
        if (oldest !== undefined) signedCache.delete(oldest);
      }
      signedCache.set(url, { signedPath, expiresAt });
      return signedPath;
    } catch (err) {
      // Network failure — never fall back to embedding session/token in the URL.
      if (!warnedOnce) {
        warnedOnce = true;
        console.warn('[image-proxy] getSignedImageUrl failed, image omitted:', err);
      }
      return '';
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, promise);
  return promise;
}

/**
 * DEPRECATED for <img> usage — returns an UNSIGNED proxied URL
 * (`/api/v1/image-proxy?url=..`) that the backend 401s unless a session header
 * is attached via fetch/XHR. Use `getSignedImageUrl` for anything rendered as
 * an image, and never append session IDs or tokens to URLs.
 */
export function proxyImageUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('/')) return url;
  const params = new URLSearchParams({ url });
  return `/api/v1/image-proxy?${params.toString()}`;
}
