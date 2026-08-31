import mongoose, { Schema, Document } from 'mongoose';

export interface IUserNotificationDocument extends Document {
  userId: mongoose.Types.ObjectId;
  notificationId: mongoose.Types.ObjectId;
  readAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userNotificationSchema = new Schema<IUserNotificationDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    notificationId: { type: Schema.Types.ObjectId, ref: 'Notification', required: true, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userNotificationSchema.index({ userId: 1, notificationId: 1 }, { unique: true });

const UserNotification = mongoose.model<IUserNotificationDocument>(
  'UserNotification',
  userNotificationSchema,
);

module.exports = UserNotification;
export default UserNotification;
