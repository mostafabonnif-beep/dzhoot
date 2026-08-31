import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Reseller from '../models/Reseller';

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
    (req as any).reseller = reseller;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

module.exports = { requireReseller };
export { requireReseller };
