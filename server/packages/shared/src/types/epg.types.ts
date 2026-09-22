import { Types, Document } from 'mongoose';

export interface IEpgProgram {
  channelEpgId: string;
  title: string;
  description: string | null;
  category: string[];
  startTime: Date;
  endTime: Date;
  icon: string | null;
  language: string | null;
}

export interface IEpgProgramDocument extends IEpgProgram, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A guide channel's own naming metadata, captured from the XMLTV `<channel>`
 * elements during EPG refresh. This is what makes name-based matching possible:
 * a catalog channel with no `tvgId` can be linked to a guide id whose id alone
 * does not canonicalize to the channel's name (e.g. `xyz.123.tr`), as long as the
 * guide publishes a display-name that matches the catalog channel's name.
 *
 * `displayNames` is the set of every `<display-name>` alias seen for the guide id
 * across sources; matching only ever uses an alias that resolves to exactly one
 * guide id (see epg-rematch-service).
 */
export interface IEpgChannel {
  channelEpgId: string;
  displayNames: string[];
  lastSeenAt: Date | null;
}

export interface IEpgChannelDocument extends IEpgChannel, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
