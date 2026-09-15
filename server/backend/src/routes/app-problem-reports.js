const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const ProblemReport = require('../models/ProblemReport');
const { sendOperationalAlert } = require('../services/alert-notifier');
const { validateReport, generateReportId, MESSAGE_MAX } = require('../services/problem-report-service');

// Customer problem reports from the Android app: /api/v1/app/report-problem
//
// Public on purpose: the most valuable report is the one sent by a customer who cannot
// sign in, and a device that just failed to start has no session. A report therefore
// carries no credentials by construction — everything it contains is redacted on the way
// in (`services/problem-report-service`) and the diagnostic shape is a closed list.
//
// This is the customer-facing sibling of `POST /app/crash-report`: a crash report is
// written automatically by the app, a problem report is written deliberately by the
// customer and must carry what *they* were doing.
const REPORT_RATE_LIMIT_DEFAULT = 20;
const reportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  // Read through a function so the limit is taken from the environment at request time:
  // a value captured at import cannot be changed by the deployment (or by a test) once the
  // process is up, which is exactly the trap a rate limit must not have.
  max: () => Number.parseInt(process.env.APP_REPORT_RATE_LIMIT_MAX || '', 10) || REPORT_RATE_LIMIT_DEFAULT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many reports, try again later' },
});

/**
 * How many reports of one failure class within the window before an operator is told.
 * Repeat reports are the whole point of this endpoint: one customer hitting a bug is a
 * ticket, twenty hitting the same bug is an incident.
 */
const ALERT_THRESHOLD_DEFAULT = 5;
const ALERT_WINDOW_DEFAULT_MS = 3_600_000;

/** Read at call time for the same reason as the rate limit above. */
function alertThreshold() {
  return Number.parseInt(process.env.APP_REPORT_ALERT_THRESHOLD || '', 10) || ALERT_THRESHOLD_DEFAULT;
}

function alertWindowMs() {
  return Number.parseInt(process.env.APP_REPORT_ALERT_WINDOW_MS || '', 10) || ALERT_WINDOW_DEFAULT_MS;
}

/**
 * Tells the operators when the same failure class reaches the threshold. Never throws:
 * an alert that cannot be delivered must not fail the customer's report, which is data
 * the operator needs either way. `sendOperationalAlert` applies its own cooldown.
 */
async function alertOnRepeat(report, count) {
  if (count < alertThreshold()) return;
  try {
    await sendOperationalAlert({
      event: 'APP_PROBLEM_REPORT_REPEAT',
      severity: 'warning',
      message:
        `تكرّر بلاغ العملاء ${count} مرات خلال الواجهة الزمنية: ` +
        `${report.errorCode || 'بدون كود'} على ${report.feature || 'بدون ميزة'} ` +
        `(إصدار ${report.appVersionCode ?? 'غير معروف'})`,
      details: {
        errorCode: report.errorCode,
        feature: report.feature,
        appVersionCode: report.appVersionCode,
        reportId: report.reportId,
        correlationId: report.correlationId,
        repeatCount: count,
      },
    });
  } catch (error) {
    console.error('[problem-report] could not send the repeat alert:', error.message || error);
  }
}

router.post('/report-problem', reportLimiter, async (req, res) => {
  try {
    const verdict = validateReport(req.body);
    if (!verdict.ok) {
      return res.status(400).json({
        success: false,
        // Stable code so the client can branch without parsing the message, matching the
        // rest of the update/report surface.
        errorCode: verdict.code,
        error: verdict.error,
        requestId: req.requestId || null,
      });
    }

    const report = verdict.report;
    // A report from a signed-in customer is attributed; a pre-auth/device report still
    // gets a correlation id, so it is never orphaned in the log.
    const userId = req.user?._id || req.user?.id || null;

    const created = await ProblemReport.create({
      reportId: generateReportId(),
      userId,
      ...report,
      // A report must never be orphaned: a client can send no id and a direct call (or a
      // test harness) can arrive without the request-id middleware, so the last resort is
      // an id generated here.
      correlationId:
        report.correlationId || req.requestId || `srv-${require('crypto').randomUUID()}`,
    });

    // Counted after the write so the number an operator sees always includes the report
    // that triggered the alert.
    if (created.dedupeKey) {
      const count = await ProblemReport.countDocuments({
        dedupeKey: created.dedupeKey,
        createdAt: { $gte: new Date(Date.now() - alertWindowMs()) },
      });
      await alertOnRepeat(created, count);
    }

    return res.status(201).json({
      success: true,
      // The customer (and the operator) quotes this; it is not an internal ObjectId.
      reportId: created.reportId,
      correlationId: created.correlationId,
      messageMaxLength: MESSAGE_MAX,
    });
  } catch (error) {
    console.error('[problem-report] failed to store the report:', error.message || error);
    return res.status(500).json({
      success: false,
      errorCode: 'REPORT_STORE_FAILED',
      error: 'Could not store the report',
      requestId: req.requestId || null,
    });
  }
});

module.exports = router;
module.exports._private = { reportLimiter, alertOnRepeat, alertThreshold, alertWindowMs };
