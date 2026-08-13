import { Types, Document } from 'mongoose';

export interface IFlaggedBad {
  isFlagged: boolean;
  reason?: string | null;
  flaggedBy?: Types.ObjectId | null;
  flaggedAt?: Date | null;
}

export interface IAlternateStreamLiveness {
  status: 'alive' | 'dead' | 'unknown';
  lastCheckedAt?: Date | null;
  responseTimeMs?: number | null;
  error?: string | null;
}

export interface IAlternateStream {
  streamUrl: string;
  quality?: string | null;
  liveness: IAlternateStreamLiveness;
  flaggedBad: IFlaggedBad;
  userAgent?: string | null;
  referrer?: string | null;
  source?: string | null;
  promotedAt?: Date | null;
  demotedAt?: Date | null;
}

export interface IChannel {
  // null = shared admin catalog; a user id = a private channel owned by that user.
  ownerId?: Types.ObjectId | null;
  isActive?: boolean;
  channelId: string;
  channelName: string;
  channelUrl: string;
  channelImg: string;
  channelGroup: string;
  channelDrmKey: string;
  channelDrmType: string;
  tvgId: string;
  tvgName: string;
  tvgLogo: string;
  order: number;
  /**
   * Catch-up (timeshift) capability, populated from M3U attributes
   * (catchup= / catchup-source= / catchup-days=) or set for Xtream channels.
   * `source` is the raw upstream template and may embed credentials —
   * it MUST never be exposed to clients; only `type`/`days` leave the server.
   */
  catchup?: {
    type?: string | null;
    source?: string | null;
    days?: number | null;
  };
  metadata?: {
    country?: string;
    language?: string;
    resolution?: string;
    network?: string;
    website?: string;
    quality?: string;
    tags?: string[];
    lastTested?: Date;
    isWorking?: boolean;
    responseTime?: number;
    /** Provenance: which pipeline imported this channel (e.g. "xtream"). */
    source?: string;
    /** Xtream source document id (when source === "xtream"). */
    xtreamSourceId?: string;
    /** Original stream_id on the Xtream panel. */
    xtreamStreamId?: number;
  };
  flaggedBad?: IFlaggedBad;
  alternateStreams?: IAlternateStream[];
  metrics?: {
    deadCount?: number;
    aliveCount?: number;
    unresponsiveCount?: number;
    playCount?: number;
    proxyPlayCount?: number;
    lastDeadAt?: Date;
    lastAliveAt?: Date;
    lastPlayedAt?: Date;
    lastUnresponsiveAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface IChannelDocument extends IChannel, Document {
  _id: Types.ObjectId;
  toM3U(): string;
}

export interface IChannelModel {
  generateM3UPlaylist(): Promise<string>;
}
