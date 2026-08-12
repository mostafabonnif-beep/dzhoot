export function getPublicBaseUrl(req: { protocol: string; get(name: string): string | undefined }): string {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const host = String(req.get('host') || '').trim();
  return `${req.protocol}://${host}`.replace(/\/+$/, '');
}

module.exports = { getPublicBaseUrl };
