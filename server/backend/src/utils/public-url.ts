export function getPublicBaseUrl(req: {
  protocol: string;
  secure?: boolean;
  get(name: string): string | undefined;
}): string {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  // Respect the original scheme when the API is behind an HTTPS reverse proxy.
  // Express sees the internal HTTP hop otherwise, which would generate cleartext
  // playback URLs that Android rejects even though the API itself is HTTPS.
  const forwardedProto = String(req.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const protocol = forwardedProto === 'https' || forwardedProto === 'http'
    ? forwardedProto
    : req.secure
      ? 'https'
      : req.protocol;
  const host = String(req.get('x-forwarded-host') || req.get('host') || '')
    .split(',')[0]
    .trim();
  return `${protocol}://${host}`.replace(/\/+$/, '');
}

module.exports = { getPublicBaseUrl };
