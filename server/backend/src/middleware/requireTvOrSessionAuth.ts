import { Request, Response, NextFunction } from 'express';
import Session from '../models/Session';
import User from '../models/User';
import { verifyDeviceAccessToken } from '../services/device-access-token-service';

function assignUser(req: Request, user: any): void {
  req.user = {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    channels: user.channels || [],
    channelListCode: user.channelListCode,
    isActive: user.isActive,
    emailVerified: user.emailVerified ?? false,
    allCatalog: user.allCatalog === true,
  };
}

/**
 * Authenticates Android TV requests in this order:
 * 1. X-Device-Token: 256-bit, device-scoped, hashed at rest, revocable.
 * 2. X-Session-ID: established authenticated session during the migration.
 * 3. X-TV-Code: legacy compatibility only when explicitly enabled.
 */
const requireTvOrSessionAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deviceToken = req.headers['x-device-token'] as string | undefined;
    if (deviceToken) {
      const principal = await verifyDeviceAccessToken(deviceToken);
      if (!principal) {
        return res.status(401).json({ success: false, error: 'Invalid device access token' });
      }
      assignUser(req, principal.user);
      (req as any).deviceAuth = {
        deviceId: principal.device.deviceId,
        issuedAt: principal.device.accessTokenIssuedAt?.getTime?.() || null,
      };
      return next();
    }

    const sessionId = req.headers['x-session-id'] as string | undefined;
    if (sessionId) {
      const session = await Session.findOne({ sessionId }).populate(
        'userId',
        'username email role channels channelListCode isActive emailVerified allCatalog',
      );
      if (!session) return res.status(401).json({ success: false, error: 'Invalid session' });
      if (!session.isValid()) {
        await Session.deleteOne({ sessionId });
        return res.status(401).json({ success: false, error: 'Session expired' });
      }
      if (!session.userId || !(session.userId as any).isActive) {
        await Session.deleteOne({ sessionId });
        return res.status(401).json({ success: false, error: 'User account is inactive' });
      }
      await session.updateActivity();
      assignUser(req, session.userId as any);
      req.sessionId = sessionId;
      return next();
    }

    const tvCode = req.headers['x-tv-code'] as string | undefined;
    if (tvCode && process.env.ALLOW_LEGACY_TV_CODE === 'true') {
      const user = await User.findOne({
        channelListCode: tvCode.toUpperCase(),
        isActive: true,
      }).select('username email role channels channelListCode isActive emailVerified allCatalog');
      if (!user || user.codeRevokedAt) {
        return res.status(401).json({ success: false, error: 'Invalid TV credentials' });
      }
      assignUser(req, user);
      return next();
    }

    return res.status(401).json({
      success: false,
      error: 'Device authentication required',
      code: 'DEVICE_AUTH_REQUIRED',
    });
  } catch (error) {
    console.error('TV/session authentication failed:', (error as Error).message);
    return res.status(500).json({ success: false, error: 'Authentication error' });
  }
};

export { requireTvOrSessionAuth };
