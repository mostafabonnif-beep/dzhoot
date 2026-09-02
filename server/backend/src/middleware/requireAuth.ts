import { Request, Response, NextFunction } from 'express';
import { HydratedDocument } from 'mongoose';
import { IUserDocument, ISessionDocument } from '@dzhoof/shared';
import Session from '../models/Session';

type PopulatedSession = HydratedDocument<ISessionDocument> & {
  userId: HydratedDocument<IUserDocument> | null;
};

/**
 * Middleware to check if user is authenticated
 * Validates session from database and attaches user info to request
 */
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.headers['x-session-id'] as string | undefined;

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'No session ID provided',
      });
    }

    // Find session in database
    const session = (await Session.findOne({ sessionId }).populate('userId')) as PopulatedSession | null;

    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session',
      });
    }

    // Check if session is expired
    if (!session.isValid()) {
      await Session.deleteOne({ sessionId });
      return res.status(401).json({
        success: false,
        error: 'Session expired',
      });
    }

    // Check if user still exists and is active
    if (!session.userId || !session.userId.isActive) {
      await Session.deleteOne({ sessionId });
      return res.status(401).json({
        success: false,
        error: 'User account is inactive',
        adminEmail: process.env.SUPER_ADMIN_EMAIL || null,
      });
    }

    // Session binding: warn on IP/UA mismatch (log for now, strict mode can reject)
    if (session.ipAddress && session.ipAddress !== req.ip) {
      console.warn(
        `Session IP mismatch: session=${session.ipAddress} request=${req.ip} user=${session.userId?.username || 'unknown'}`,
      );
    }

    // Update last activity
    await session.updateActivity();

    // Attach user info to request
    const user = session.userId;
    req.user = {
      id: String(user._id),
      username: user.username,
      email: user.email,
      role: user.role,
      channelListCode: user.channelListCode,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
    };

    req.sessionId = sessionId;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication error',
    });
  }
};

module.exports = { requireAuth };
export { requireAuth };
