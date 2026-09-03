import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Reseller from '../models/Reseller';
import ResellerApiKey, {
  hashResellerApiKey,
} from '../models/ResellerApiKey';

/**
 * Protect reseller-portal routes: Bearer JWT with role 'reseller',
 * then load the reseller (must exist and be Active).
 */
async function requireReseller(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || '';
  const [, token] = auth.split(' ');
  if (!token) {
    return res.status(401).json({ success: false, error: 'Missing bearer token' });
  }
  try {
    const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
    if (!ACCESS_SECRET) {
      console.error('JWT_ACCESS_SECRET not configured');
      return res.status(500).json({ success: false, error: 'Server configuration error' });
    }
    const payload = jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (payload.role !== 'reseller') {
      return res.status(403).json({ success: false, error: 'Not a reseller account' });
    }
    const reseller = await Reseller.findById(payload.sub).exec();
    if (!reseller || reseller.status !== 'Active') {
      return res.status(403).json({ success: false, error: 'Reseller account inactive or missing' });
    }
    req.reseller = reseller;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * Router-level auth for the reseller portal (بوابة الموزعين):
 *
 * - Bearer JWT (requireReseller) works on EVERY route — the portal UI path.
 * - `X-API-Key` (dzhk_…) works on SAFE READ routes only (GET, allow-listed
 *   below). Writes, key management and anything state-changing stay
 *   JWT-only so a leaked key can neither mutate data nor replicate itself.
 */
const API_KEY_READ_ROUTES: RegExp[] = [
  /^\/me$/,
  /^\/ledger$/,
  /^\/statement$/,
  /^\/clients$/,
  /^\/credit$/,
  /^\/batches$/,
  /^\/batches\/[^/]+\/codes$/,
  /^\/tickets$/,
  /^\/debts$/,
  /^\/whitelabel\/branding$/,
  /^\/sub-resellers$/,
];

async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = String(req.headers['x-api-key'] || '').trim();
  if (!apiKey) {
    res.status(401).json({ success: false, error: 'Missing API key' });
    return;
  }
  try {
    const key = await ResellerApiKey.findOne({
      tokenHash: hashResellerApiKey(apiKey),
      active: true,
    })
      .populate('resellerId')
      .exec();
    if (!key) {
      res.status(401).json({ success: false, error: 'Invalid API key' });
      return;
    }
    const reseller = key.resellerId as unknown as {
      _id: unknown;
      status?: string;
    } | null;
    if (!reseller || reseller.status !== 'Active') {
      res.status(403).json({ success: false, error: 'Reseller account inactive or missing' });
      return;
    }
    req.reseller = reseller as any;
    // Fire-and-forget usage stamp (best-effort — never blocks the request).
    ResellerApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    next();
  } catch (err) {
    console.error('[requireReseller] api-key auth error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
    return;
  }
}

function requireResellerOrApiKeyForReads(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const hasApiKey = Boolean(String(req.headers['x-api-key'] || '').trim());
  const hasBearer = /^Bearer\s+\S+/i.test(req.headers.authorization || '');
  if (hasApiKey && !hasBearer) {
    // API-key path: only on safe GET reads from the allow-list. req.path here
    // is relative to the router mount (/api/v1/reseller) — e.g. "/me".
    const allowed =
      req.method === 'GET' &&
      API_KEY_READ_ROUTES.some((re) => re.test(req.path));
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: 'API keys are limited to read-only endpoints',
      });
    }
    return authenticateApiKey(req, res, next);
  }
  return requireReseller(req, res, next);
}

module.exports = { requireReseller, requireResellerOrApiKeyForReads };
export { requireReseller, requireResellerOrApiKeyForReads };
