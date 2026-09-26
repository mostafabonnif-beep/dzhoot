/**
 * Which upstream hosts must egress through the residential relay.
 *
 * This is deployment configuration, not code (AGENTS.md: never hard-code a provider
 * URL in the repository). `UPSTREAM_PROXY_HOSTS` is a comma-separated list of host
 * suffixes; an unset or empty list means "proxy nothing", which is the safe default.
 *
 * Both egress paths share this module — `hls-remux-service` (ffmpeg `-http_proxy`) and
 * `upstream-proxy` (axios CONNECT tunnel). They used to disagree: remux honoured the
 * list, while the playback fetch tunnelled *every* host as soon as `UPSTREAM_HTTP_PROXY`
 * was set (measured 2026-09-26). That sent CDN segment fetches through the relay the
 * operator had deliberately left direct, and made the relay the single point of failure
 * for traffic that never needed it.
 */

export function parseUpstreamProxyHosts(
  raw: string | undefined = process.env.UPSTREAM_PROXY_HOSTS,
): string[] {
  return String(raw || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True when an upstream URL belongs to a host that must egress through the
 * residential relay (the provider's WAF blocks datacenter IPs on its /live endpoints).
 * Matches the exact host or any subdomain of a configured suffix.
 */
export function upstreamHostNeedsProxy(
  streamUrl: string,
  proxyHostSuffixes: string[],
): boolean {
  if (!proxyHostSuffixes || proxyHostSuffixes.length === 0) return false;
  let host: string;
  try {
    host = new URL(streamUrl).hostname.toLowerCase();
  } catch {
    return false; // unparseable URL — never break the direct fetch path
  }
  return proxyHostSuffixes.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}
