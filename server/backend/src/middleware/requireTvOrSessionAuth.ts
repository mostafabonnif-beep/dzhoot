import { Request, Response, NextFunction } from 'express';
import { HydratedDocument, Types } from 'mongoose';
import { ISessionDocument, IUserDocument } from '@dzhoof/shared';
import Session from '../models/Session';
import User from '../models/User';

type MinimalAuthUser = Pick<
  IUserDocument,
  'username' | 'email' | 'role' | 'channels' | 'channelListCode' | 'isActive' | 'emailVerified' | 'allCatalog'
> & { _id: Types.ObjectId };

type PopulatedSession = HydratedDocument<ISessionDocument> & {
  userId: MinimalAuthUser | null;
};

/**
 * Middleware that authenticates via session OR TV channel list code.
 * Used on endpoints the TV app needs (e.g. GET /channels).
 *
 * Auth order:
 * 1. X-TV-Code header → look up user by channelListCode
 * 2. X-Session-ID header → standard session auth
 */
const requireTvOrSessionAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. Try TV code auth first
    const tvCode = req.headers['x-tv-code'] as string | undefined;
    if (tvCode) {
      // Demo mode is opt-in. Never expose a known/default credential in production.
      // A configured DEMO_TV_CODE may be used to browse the bounded demo catalog.
      // Demo access is strictly opt-in in every environment. There is no
      // implicit/default credential (including the historical `DEMO` value).
      const demoTvCode = String(process.env.DEMO_TV_CODE || '').trim();
      if (demoTvCode && tvCode.trim().toUpperCase() === demoTvCode.toUpperCase()) {
        req.user = {
          id: 'demo',
          username: 'demo',
          email: '',
          role: 'Demo',
          channels: [],
          channelListCode: demoTvCode.toUpperCase(),
          isActive: true,
          emailVerified: true,
          allCatalog: false,
          demo: true,
        };
        return next();
      }

      const user = (await User.findOne({
        channelListCode: tvCode.toUpperCase(),
        isActive: true,
      }).select(
        'username email role channels channelListCode isActive emailVerified allCatalog',
      )) as MinimalAuthUser | null;

      if (user) {
        req.user = {
          id: String(user._id),
          username: user.username,
          email: user.email,
          role: user.role,
          channels: user.channels || [],
          channelListCode: user.channelListCode,
          isActive: user.isActive,
          emailVerified: user.emailVerified ?? false,
          allCatalog: user.allCatalog === true,
        };
        return next();
      }

      return res.status(401).json({
        success: false,
        error: 'Invalid TV code',
      });
    }

    // 2. Fall back to session auth
    const sessionId = req.headers['x-session-id'] as string | undefined;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'No authentication provided',
      });
    }

    const session = (await Session.findOne({ sessionId }).populate(
      'userId',
      'username email role channels channelListCode isActive emailVerified allCatalog',
    )) as PopulatedSession | null;

    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session',
      });
    }

    if (!session.isValid()) {
      await Session.deleteOne({ sessionId });
      return res.status(401).json({
        success: false,
        error: 'Session expired',
      });
    }

    if (!session.userId || !session.userId.isActive) {
      await Session.deleteOne({ sessionId });
      return res.status(401).json({
        success: false,
        error: 'User account is inactive',
      });
    }

    await session.updateActivity();

    const user = session.userId;
    req.user = {
      id: String(user._id),
      username: user.username,
      email: user.email,
      role: user.role,
      channels: user.channels || [],
      channelListCode: user.channelListCode,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      allCatalog: user.allCatalog === true,
    };
    req.sessionId = sessionId;

    next();
  } catch (error) {
    console.error('TV/Session auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication error',
    });
  }
};

export { requireTvOrSessionAuth };
