import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { HydratedDocument, Types } from 'mongoose';
import { ISessionDocument, IUserDocument } from '@dzhoof/shared';
import Session from '../models/Session';
import User from '../models/User';

type ResolvedAuthUser = Pick<
  IUserDocument,
  'username' | 'email' | 'role' | 'channels' | 'channelListCode' | 'isActive' | 'emailVerified' | 'allCatalog'
> & { _id: Types.ObjectId };

type PopulatedSession = HydratedDocument<ISessionDocument> & {
  userId: ResolvedAuthUser | null;
};

/**
 * Resolves the current user for app-facing routes.
 * Accepts a session header (`x-session-id`), a JWT Bearer token, or a paired
 * TV code (`x-tv-code`). Sets req.user (same shape as requireAuth) and req.userId.
 */
async function resolveUser(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = req.headers['x-session-id'] as string | undefined;
    const tvCode = req.headers['x-tv-code'] as string | undefined;
    const auth = req.headers.authorization || '';
    let user: ResolvedAuthUser | null = null;

    if (sessionId) {
      const session = (await Session.findOne({ sessionId }).populate('userId')) as PopulatedSession | null;
      if (!session || !session.isValid()) {
        return res.status(401).json({ success: false, error: 'Invalid or expired session' });
      }
      user = session.userId;
      await session.updateActivity();
    } else if (auth.startsWith('Bearer ')) {
      const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
      if (!ACCESS_SECRET) {
        return res.status(500).json({ success: false, error: 'Server configuration error' });
      }
      const payload = jwt.verify(auth.slice(7), ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      user = (await User.findById(payload.sub).exec()) as ResolvedAuthUser | null;
    } else if (tvCode) {
      // PIN-paired TV clients authenticate with their channel list code (no
      // session exists until the companion app pairs a device). Same lookup as
      // requireTvOrSessionAuth; demo codes are intentionally NOT accepted here
      // (demo has no account, subscription, or devices).
      user = (await User.findOne({
        channelListCode: tvCode.toUpperCase(),
        isActive: true,
        codeRevokedAt: null,
      }).select(
        'username email role channels channelListCode isActive emailVerified allCatalog',
      )) as ResolvedAuthUser | null;
    }

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'User account is inactive',
        adminEmail: process.env.SUPER_ADMIN_EMAIL || null,
      });
    }

    req.user = {
      id: String(user._id),
      username: user.username,
      email: user.email,
      role: user.role,
      channelListCode: user.channelListCode,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      allCatalog: user.allCatalog === true,
      channels: user.channels || [],
    };
    req.userId = String(user._id);

    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}

/**
 * Optional auth: resolves the user when a session/JWT is present, otherwise
 * continues anonymously (req.user = null). Used for browseable catalogs.
 */
async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.headers['x-session-id'] as string | undefined;
  const auth = req.headers.authorization || '';
  req.user = undefined;
  req.userId = undefined;
  if (!sessionId && !auth.startsWith('Bearer ')) return next();

  try {
    await resolveUser(req, res, () => undefined);
    // resolveUser answers 401/500 directly (it does not throw); if it already
    // sent a response, the route handler must not run — otherwise the handler's
    // res.json() throws ERR_HTTP_HEADERS_SENT (seen on /api/v1/catalog/* with a
    // stale session header) and the server logs an unhandled rejection.
    if (res.headersSent) return;
    return next();
  } catch {
    req.user = undefined;
    req.userId = undefined;
    return next();
  }
}

module.exports = { resolveUser, optionalAuth };
export { resolveUser, optionalAuth };
