import mongoose, { Schema, Document } from 'mongoose';

export interface IAppSettingDocument extends Document {
  key: string;
  value: unknown;
  description?: string;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const appSettingSchema = new Schema<IAppSettingDocument>(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, required: true },
    description: { type: String, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

const AppSetting = mongoose.model<IAppSettingDocument>('AppSetting', appSettingSchema);

module.exports = AppSetting;
export default AppSetting;
