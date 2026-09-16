/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import express from 'express';

jest.mock('../services/alert-notifier', () => ({
  sendOperationalAlert: jest.fn(async () => true),
  clearAlertCooldowns: jest.fn(),
  getAlertChannelStatus: jest.fn(async () => []),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const alertNotifier = require('../services/alert-notifier');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const router = require('../routes/app-problem-reports');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ProblemReport = require('../models/ProblemReport');

const sendOperationalAlert = alertNotifier.sendOperationalAlert as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/app', router);
  return app;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    message: 'القناة لا تعمل عند فتحها',
    errorCode: 'PLAYBACK_FAILED',
    feature: 'player',
    screen: 'channel_detail',
    appVersion: '1.3.1',
    appVersionCode: 10301,
    platform: 'android-tv',
    deviceId: 'dz-0018a80af2a8f852',
    deviceModel: 'SM-A057G',
    severity: 'error',
    retryable: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.APP_REPORT_ALERT_THRESHOLD;
  delete process.env.APP_REPORT_RATE_LIMIT_MAX;
});

describe('POST /api/v1/app/report-problem — validation', () => {
  // Regression for the observed production defect: `POST {}` to the sibling crash
  // endpoint returned 201 and stored a document whose every field was null.
  it('refuses a report that says nothing', async () => {
    const response = await request(buildApp()).post('/api/v1/app/report-problem').send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe('REPORT_CONTENT_REQUIRED');
  });

  it('refuses a report whose only fields are unknown ones', async () => {
    const response = await request(buildApp())
      .post('/api/v1/app/report-problem')
      .send({ mystery: 'value', secretish: 42 });

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('REPORT_CONTENT_REQUIRED');
  });

  it('accepts a report that carries only an error code', async () => {
    const response = await request(buildApp())
      .post('/api/v1/app/report-problem')
      .send({ errorCode: 'UPDATE_CHECKSUM_REQUIRED' });

    expect(response.status).toBe(201);
    expect(response.body.reportId).toMatch(/^DZR-[23456789A-HJ-NP-Z]{8}$/);
  });

  it('accepts a report that carries only a description', async () => {
    const response = await request(buildApp())
      .post('/api/v1/app/report-problem')
      .send({ message: 'الشاشة السوداء عند تغيير القناة' });

    expect(response.status).toBe(201);
  });
});

describe('POST /api/v1/app/report-problem — stored shape', () => {
  it('stores the report and returns a quotable id plus a correlation id', async () => {
    const response = await request(buildApp())
      .post('/api/v1/app/report-problem')
      .send(validBody());

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.reportId).toMatch(/^DZR-/);

    const stored = await ProblemReport.findOne({ reportId: response.body.reportId }).lean();
    expect(stored.message).toBe('القناة لا تعمل عند فتحها');
    expect(stored.errorCode).toBe('PLAYBACK_FAILED');
    expect(stored.feature).toBe('player');
    expect(stored.appVersionCode).toBe(10301);
    expect(stored.status).toBe('new');
    // A report must always be joinable to a request, even when the client sent none.
    expect(stored.correlationId).toBeTruthy();
  });

  it('redacts credentials in the customer description before storing it', async () => {
    const response = await request(buildApp())
      .post('/api/v1/app/report-problem')
      .send(
        validBody({
          message:
            'فشل الاتصال بـ http://xtream.example.test/get.php?username=dz-user&password=SuperSecret1',
        }),
      );

    expect(response.status).toBe(201);
    const stored = await ProblemReport.findOne({ reportId: response.body.reportId }).lean();
    expect(stored.message).not.toContain('SuperSecret1');
    expect(stored.message).not.toContain('dz-user');
  });

  it('keeps only the documented diagnostic keys', async () => {
    const response = await request(buildApp())
      .post('/api/v1/app/report-problem')
      .send(
        validBody({
          diagnostics: {
            serverVersion: '1.0.1',
            updateErrorCode: 'UPDATE_CHECKSUM_REQUIRED',
            checksumVerified: true,
            freeStorageMb: 15151,
            // Not on the closed list — a stream URL or a token would arrive here.
            streamUrl: 'http://provider.example/live/dz-user/SuperSecret1/1.ts',
            token: 'abc123',
          },
        }),
      );

    const stored = await ProblemReport.findOne({ reportId: response.body.reportId }).lean();
    expect(stored.diagnostics).toEqual({
      serverVersion: '1.0.1',
      updateErrorCode: 'UPDATE_CHECKSUM_REQUIRED',
      checksumVerified: true,
      freeStorageMb: 15151,
    });
    expect(JSON.stringify(stored.diagnostics)).not.toContain('SuperSecret1');
  });

  it('groups reports of the same failure through a dedupe key', async () => {
    const first = await request(buildApp()).post('/api/v1/app/report-problem').send(validBody());
    const second = await request(buildApp())
      .post('/api/v1/app/report-problem')
      .send(validBody({ deviceId: 'dz-other-device' }));

    const a = await ProblemReport.findOne({ reportId: first.body.reportId }).lean();
    const b = await ProblemReport.findOne({ reportId: second.body.reportId }).lean();
    expect(a.dedupeKey).toBe('PLAYBACK_FAILED|player|10301');
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });
});

describe('POST /api/v1/app/report-problem — repeat alerts', () => {
  it('does not alert below the threshold', async () => {
    process.env.APP_REPORT_ALERT_THRESHOLD = '3';

    await request(buildApp()).post('/api/v1/app/report-problem').send(validBody());

    expect(sendOperationalAlert).not.toHaveBeenCalled();
  });

  it('alerts once the same failure reaches the threshold', async () => {
    process.env.APP_REPORT_ALERT_THRESHOLD = '3';

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(buildApp())
        .post('/api/v1/app/report-problem')
        .send(validBody({ deviceId: `dz-device-${i}` }));
    }

    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);
    const payload = sendOperationalAlert.mock.calls[0][0];
    expect(payload.event).toBe('APP_PROBLEM_REPORT_REPEAT');
    // The alert names the failure class, never the customer's text.
    expect(payload.message).toContain('PLAYBACK_FAILED');
    expect(payload.message).not.toContain('القناة لا تعمل');
  });

  it('still stores the report when the alert cannot be delivered', async () => {
    process.env.APP_REPORT_ALERT_THRESHOLD = '1';
    sendOperationalAlert.mockRejectedValueOnce(new Error('telegram down'));

    const response = await request(buildApp()).post('/api/v1/app/report-problem').send(validBody());

    expect(response.status).toBe(201);
    expect(await ProblemReport.countDocuments({})).toBe(1);
  });

  it('does not alert when the report has no failure class to group by', async () => {
    process.env.APP_REPORT_ALERT_THRESHOLD = '1';

    await request(buildApp())
      .post('/api/v1/app/report-problem')
      .send({ message: 'شيء ما لا يعمل' });

    expect(sendOperationalAlert).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/app/crash-report — empty payload guard', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const updateRouter = require('../routes/app-update');

  function crashApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/app', updateRouter);
    return app;
  }

  it('refuses a crash report with no identifying or diagnostic field', async () => {
    const response = await request(crashApp()).post('/api/v1/app/crash-report').send({});

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('CRASH_REPORT_CONTENT_REQUIRED');
  });

  it('still accepts a minimal but real crash report', async () => {
    const response = await request(crashApp())
      .post('/api/v1/app/crash-report')
      .send({ deviceId: 'dz-0018a80af2a8f852', exceptionType: 'java.lang.IllegalStateException' });

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
  });
});
