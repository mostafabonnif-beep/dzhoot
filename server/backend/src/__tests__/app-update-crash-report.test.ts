/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import express from 'express';

// A crashed app cannot be trusted to have scrubbed its own payload: a throwable
// message routinely embeds the URL or token that caused the failure, so the operator
// must never be able to read credentials out of a stored crash report (operations
// brief §7 "ممنوع إرسال / لا تخزّن أسرار"). These tests post hostile payloads and read
// the stored document back.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const router = require('../routes/app-update');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CrashReport = require('../models/CrashReport');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/app', router);
  return app;
}

const XTREAM_QUERY_URL =
  'http://xtream.example.test:8080/get.php?username=dz-user&password=SuperSecret1&type=m3u_plus';
const XTREAM_PATH_URL = 'https://xtream.example.test:8080/live/dz-user/SuperSecret1/1423.ts';
const USERINFO_URL = 'https://dz-user:SuperSecret1@xtream.example.test/player_api.php';
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiVXNlciJ9.c2lnbmF0dXJlLXZhbHVl';

async function post(body: Record<string, unknown>) {
  return request(buildApp()).post('/api/v1/app/crash-report').send(body);
}

describe('POST /api/v1/app/crash-report — no secrets reach storage', () => {
  it('stores the report and redacts credentials from every free-text field', async () => {
    const response = await post({
      deviceId: 'device-1',
      appVersion: '1.3.1',
      appVersionCode: 10301,
      platform: 'android-tv',
      deviceModel: 'Chromecast HD',
      androidVersion: '14',
      sdkInt: 34,
      exceptionType: 'java.io.IOException',
      exceptionMessage: `Unable to open ${XTREAM_PATH_URL}`,
      stackTrace: [
        'java.io.IOException: failed to load ' + XTREAM_QUERY_URL,
        `\tat com.dzhoof.iptv.data.remote.XtreamApi.fetch(XtreamApi.kt:120)`,
        `Authorization: Bearer ${JWT}`,
        `\tat com.dzhoof.iptv.data.remote.Proxy(${USERINFO_URL}:88)`,
      ].join('\n'),
      threadName: 'main',
      screen: `player — ${XTREAM_PATH_URL}`,
    });

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);

    const stored = await CrashReport.findById(response.body.id).lean();
    expect(stored).not.toBeNull();

    const joined = [
      stored.exceptionMessage,
      stored.stackTrace,
      stored.screen,
      stored.threadName,
      stored.exceptionType,
    ].join('\n');

    expect(joined).not.toContain('SuperSecret1');
    expect(joined).not.toContain('dz-user');
    expect(joined).not.toContain(JWT);
    expect(joined).not.toContain('signature-value');

    // The report is still useful: the failure site survives redaction.
    expect(stored.stackTrace).toContain('java.io.IOException: failed to load');
    expect(stored.stackTrace).toContain('XtreamApi.kt:120');
    expect(stored.exceptionType).toBe('java.io.IOException');
    expect(stored.screen).toContain('player');

    // Non-sensitive device facts are stored unchanged.
    expect(stored.deviceModel).toBe('Chromecast HD');
    expect(stored.sdkInt).toBe(34);
    expect(stored.appVersionCode).toBe(10301);
  });

  it('keeps the report identifiable when the payload carries only the token', async () => {
    const response = await post({
      appVersion: '1.3.1',
      exceptionMessage: `Playback token rejected: ${JWT}`,
      stackTrace: `Bearer ${JWT}`,
    });

    expect(response.status).toBe(201);
    const stored = await CrashReport.findById(response.body.id).lean();
    expect(stored.exceptionMessage).toContain('[redacted-jwt]');
    expect(stored.stackTrace).toContain('[redacted]');
    expect(stored.exceptionMessage).not.toContain(JWT);
  });

  it('nulls empty and non-string fields instead of storing blank values', async () => {
    const response = await post({
      deviceId: '   ',
      appVersionCode: 'not-a-number',
      exceptionMessage: '',
      stackTrace: 42,
      screen: null,
      sdkInt: -3,
    });

    expect(response.status).toBe(201);
    const stored = await CrashReport.findById(response.body.id).lean();
    expect(stored.deviceId).toBeNull();
    expect(stored.appVersionCode).toBeNull();
    expect(stored.exceptionMessage).toBeNull();
    expect(stored.stackTrace).toBeNull();
    expect(stored.screen).toBeNull();
    expect(stored.sdkInt).toBeNull();
  });

  it('bounds a very long stack trace instead of storing it whole', async () => {
    const response = await post({
      appVersion: '1.3.1',
      stackTrace: `java.lang.IllegalStateException: boom\n${'x'.repeat(80000)}`,
    });

    expect(response.status).toBe(201);
    const stored = await CrashReport.findById(response.body.id).lean();
    expect(stored.stackTrace.length).toBeLessThanOrEqual(50000);
    expect(stored.stackTrace).toContain('IllegalStateException: boom');
  });
});
