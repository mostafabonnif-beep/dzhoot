/**
 * Logo proxy helper — the channel logos stored in the catalog come from the
 * upstream providers' image servers (raw IPs like 51.158.145.100, picons
 * hosts…). Exposing them in playlists/EPG lets a customer or reseller identify
 * the exact upstream source — a business secret for DZ HOOF. Every
 * customer-facing logo URL is rewritten to OUR server, which relays the image.
 */

/** Rewrite a raw logo URL to our proxy (or leave it alone if it's not http). */
export function proxyLogoUrl(baseUrl: string, rawUrl: unknown): string {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url; // data: URIs and empties pass through
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base}/api/v1/tv/logo?url=${encodeURIComponent(url)}`;
}
