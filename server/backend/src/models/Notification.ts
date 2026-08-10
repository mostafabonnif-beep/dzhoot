import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationDocument extends Document {
  title: string;
  body: string;
  imageUrl?: string;
  deepLink?: string;
  audience: 'ALL' | 'ACTIVE';
  status: 'DRAFT' | 'SCHEDULED' | 'SENT';
  scheduledAt?: Date | null;
  sentAt?: Date | null;
  createdBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotificationDocument>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    imageUrl: { type: String, default: '' },
    deepLink: { type: String, default: '' },
    audience: { type: String, enum: ['ALL', 'ACTIVE'], default: 'ALL', index: true },
    status: { type: String, enum: ['DRAFT', 'SCHEDULED', 'SENT'], default: 'DRAFT', index: true },
    scheduledAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ status: 1, createdAt: -1 });

const Notification = mongoose.model<INotificationDocument>('Notification', notificationSchema);

module.exports = Notification;
export default Notification;
