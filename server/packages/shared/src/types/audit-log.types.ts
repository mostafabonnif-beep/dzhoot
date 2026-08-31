import { Types, Document } from 'mongoose';

export interface IAuditLog {
  // Optional: pre-auth events (login failures) and system actions have no user.
  userId?: Types.ObjectId | null;
  action: string;
  resource: string;
  resourceId?: string;
  changes?: {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failure';
  errorMessage?: string;
  timestamp: Date;
}

export interface IAuditLogDocument extends IAuditLog, Document {
  _id: Types.ObjectId;
}
