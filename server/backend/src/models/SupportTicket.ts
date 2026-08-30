import mongoose, { Schema, Document } from 'mongoose';

export type SupportTicketStatus = 'OPEN' | 'PENDING' | 'CLOSED';
export type SupportTicketPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ITicketMessage {
  author: 'reseller' | 'admin';
  body: string;
  createdAt: Date;
}

export interface ISupportTicketDocument extends Document {
  resellerId: mongoose.Types.ObjectId;
  subject: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  messages: ITicketMessage[];
  closedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<ITicketMessage>(
  {
    author: {
      type: String,
      enum: ['reseller', 'admin'],
      required: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, _id: false },
);

const supportTicketSchema = new Schema<ISupportTicketDocument>(
  {
    resellerId: {
      type: Schema.Types.ObjectId,
      ref: 'Reseller',
      required: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    status: {
      type: String,
      enum: ['OPEN', 'PENDING', 'CLOSED'],
      default: 'OPEN',
      index: true,
    },
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'MEDIUM',
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
    closedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Admin dashboards list open tickets newest-first across all resellers.
supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ resellerId: 1, createdAt: -1 });

const SupportTicket = mongoose.model<ISupportTicketDocument>('SupportTicket', supportTicketSchema);

module.exports = SupportTicket;
export default SupportTicket;
