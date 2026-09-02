import type { IResellerDocument } from '../models/Reseller';

export {};

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        email: string;
        role: 'Admin' | 'User' | 'Demo';
        channels?: unknown[];
        channelListCode?: string;
        isActive: boolean;
        emailVerified: boolean;
        allCatalog?: boolean;
        demo?: boolean;
      };
      sessionId?: string;
      jwt?: {
        sub: string;
        role: string;
        channelListCode?: string;
        jti?: string;
        iat?: number;
        exp?: number;
      };
      userId?: string;
      reseller?: IResellerDocument;
    }
  }
}
