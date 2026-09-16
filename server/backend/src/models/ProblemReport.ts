import mongoose, { Document, Schema } from 'mongoose';

export type ProblemReportStatus = 'new' | 'triaged' | 'investigating' | 'resolved' | 'duplicate';

export interface IProblemReportDocument extends Document {
  /** Short, human-quotable id shown to the customer and quoted in support threads. */
  reportId: string;
  /** Set when the report came from a signed-in user; null for a pre-auth/device report. */
  userId: mongoose.Types.ObjectId | null;
  deviceId: string | null;
  appVersion: string | null;
  appVersionCode: number | null;
  platform: string | null;
  deviceModel: string | null;
  deviceBrand: string | null;
  androidVersion: string | null;
  sdkInt: number | null;
  /** What the customer was doing when it broke. Bounded, never free-form for `feature`. */
  feature: string | null;
  screen: string | null;
  /** Stable, non-sensitive label from the shared error taxonomy. */
  errorCode: string | null;
  severity: string | null;
  retryable: boolean | null;
  /** Join key to the API log line for the request that failed. */
  correlationId: string | null;
  /** The customer's own description, redacted before storage. */
  message: string;
  /** Redacted, bounded diagnostic snapshot (already sanitised by the client and again here). */
  diagnostics: Record<string, unknown> | null;
  /** Groups reports of the same failure so a spike is visible without reading free text. */
  dedupeKey: string | null;
  status: ProblemReportStatus;
  adminNotes: string | null;
  resolvedInVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const problemReportSchema = new Schema<IProblemReportDocument>(
  {
    reportId: { type: String, required: true, unique: true, trim: true, maxlength: 32, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    deviceId: { type: String, trim: true, maxlength: 128, default: null, index: true },
    appVersion: { type: String, trim: true, maxlength: 40, default: null },
    appVersionCode: { type: Number, default: null, index: true },
    platform: { type: String, trim: true, maxlength: 30, default: null },
    deviceModel: { type: String, trim: true, maxlength: 80, default: null },
    deviceBrand: { type: String, trim: true, maxlength: 80, default: null },
    androidVersion: { type: String, trim: true, maxlength: 40, default: null },
    sdkInt: { type: Number, default: null },
    feature: { type: String, trim: true, maxlength: 60, default: null, index: true },
    screen: { type: String, trim: true, maxlength: 100, default: null },
    errorCode: { type: String, trim: true, maxlength: 64, default: null, index: true },
    severity: { type: String, trim: true, maxlength: 20, default: null },
    retryable: { type: Boolean, default: null },
    correlationId: { type: String, trim: true, maxlength: 64, default: null, index: true },
    message: { type: String, trim: true, maxlength: 2000, default: '' },
    // `Mixed` on purpose: the shape is the client's, and pinning it here would force a
    // migration every time a diagnostic field is added. Bounded and redacted on ingest.
    diagnostics: { type: Schema.Types.Mixed, default: null },
    dedupeKey: { type: String, trim: true, maxlength: 160, default: null, index: true },
    status: {
      type: String,
      enum: ['new', 'triaged', 'investigating', 'resolved', 'duplicate'],
      default: 'new',
      index: true,
    },
    adminNotes: { type: String, trim: true, maxlength: 4000, default: null },
    resolvedInVersion: { type: String, trim: true, maxlength: 40, default: null },
  },
  { timestamps: true },
);

problemReportSchema.index({ createdAt: -1 });
problemReportSchema.index({ status: 1, createdAt: -1 });
// The triage view groups by failure class across a window; this is the index it needs.
problemReportSchema.index({ errorCode: 1, feature: 1, createdAt: -1 });
problemReportSchema.index({ dedupeKey: 1, createdAt: -1 });

const ProblemReport = mongoose.model<IProblemReportDocument>('ProblemReport', problemReportSchema);

module.exports = ProblemReport;
export default ProblemReport;
