import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Session from '../models/Session';
import User from '../models/User';

/**
 * Resolves the current user for app-facing routes.
 * Accepts either a session header (`x-session-id`) or a JWT Bearer token.
 * Sets req.user (same shape as requireAuth) and req.userId.
 */
async function resolveUser(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = req.headers['x-session-id'] as string | undefined;
    const auth = req.headers.authorization || '';
    let user: any = null;

    if (sessionId) {
      const session = await Session.findOne({ sessionId }).populate('userId');
      if (!session || !session.isValid()) {
        return res.status(401).json({ success: false, error: 'Invalid or expired session' });
      }
      user = session.userId;
      await (session as any).updateActivity();
    } else if (auth.startsWith('Bearer ')) {
      const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
      if (!ACCESS_SECRET) {
        return res.status(500).json({ success: false, error: 'Server configuration error' });
      }
      const payload = jwt.verify(auth.slice(7), ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      user = await User.findById(payload.sub).exec();
    }

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'User account is inactive',
        adminEmail: process.env.SUPER_ADMIN_EMAIL || null,
      });
    }

    req.user = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      channelListCode: user.channelListCode,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
    };
    req.userId = String(user._id);

    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}

module.exports = { resolveUser };
export { resolveUser };
