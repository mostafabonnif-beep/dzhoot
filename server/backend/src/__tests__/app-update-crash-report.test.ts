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
  // Mirrors server.js: every request carries a request id, which the crash-report
  // route uses as the correlation id when a client cannot supply one.
  app.use((req: any, _res, next) => {
    req.requestId = 'test-request-id';
    next();
  });
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

  it('redacts the thread name too, because the device sends it as free text', async () => {
    const response = await post({
      deviceId: 'device-1',
      appVersion: '1.3.1',
      exceptionMessage: 'boom',
      threadName: `OkHttp Dispatcher ${USERINFO_URL}`,
    });

    expect(response.status).toBe(201);
    const stored = await CrashReport.findById(response.body.id).lean();
    expect(stored).not.toBeNull();

    expect(stored.threadName).not.toContain('SuperSecret1');
    expect(stored.threadName).not.toContain('dz-user');
    expect(stored.threadName).toContain('[redacted');
    // Still useful for triage: the thread that failed survives.
    expect(stored.threadName).toContain('OkHttp Dispatcher');
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

// ---------------------------------------------------------------------------
// End-to-end privacy + correlation contract (P1-1)
//
// The device redacts first (CrashRedactor) and the server redacts again on ingest.
// This suite is the server half: it posts a report whose every free-text field is
// loaded with a secret, then asserts that no listed secret class survives anywhere in
// the stored document, and that the report is classifiable/joinable without reading
// that text.
// ---------------------------------------------------------------------------
describe('crash report end-to-end: no secret class survives, correlation is stored', () => {
  /** Every string field of a stored document, so nothing can hide in an unexpected key. */
  function allStrings(value: unknown, acc: string[] = []): string[] {
    if (typeof value === 'string') acc.push(value);
    else if (Array.isArray(value)) value.forEach((entry) => allStrings(entry, acc));
    else if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach((entry) => allStrings(entry, acc));
    }
    return acc;
  }

  const SECRETS = {
    password: 'SuperSecret1',
    token: 'playback-token-9f8e7d6c5b4a',
    cookie: 'session=abc123def456ghi789',
    authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payloadpart.signaturepart',
    xtreamAccount: 'dz-user',
    rawIp: '185.199.108.153',
  };

  it('stores nothing that the operations brief forbids', async () => {
    const response = await post({
      deviceId: 'device-e2e',
      appVersion: '1.3.1',
      appVersionCode: 10301,
      platform: 'android-tv',
      exceptionType: 'java.net.SocketTimeoutException',
      exceptionMessage:
        `failed ${XTREAM_QUERY_URL} with Authorization: ${SECRETS.authorization}` +
        ` and Cookie: ${SECRETS.cookie} from 185.199.108.153`,
      stackTrace: [
        `java.io.IOException: 185.199.108.153:8080 refused`,
        `\tat com.dzhoof.iptv.data.remote.XtreamApi.fetch(XtreamApi.kt:120)`,
        `password=${SECRETS.password}`,
        `token=${SECRETS.token}`,
        `\tat http://${SECRETS.xtreamAccount}:${SECRETS.password}@185.199.108.153:8080/live/`,
      ].join('\n'),
      threadName: 'OkHttp Dispatcher',
      screen: 'player',
    });

    expect(response.status).toBe(201);
    const stored = await CrashReport.findById(response.body.id).lean();
    expect(stored).not.toBeNull();

    const storedText = allStrings(stored).join('\n');
    for (const [name, secret] of Object.entries(SECRETS)) {
      expect({ leaked: name, secret }).toEqual({ leaked: name, secret }); // keeps the label in the failure output
      expect(storedText.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    // Sanity: the report is still useful.
    expect(storedText).toContain('XtreamApi.kt:120');
  });

  it('stores the correlation fields that make a report classifiable', async () => {
    const response = await post({
      deviceId: 'device-correlation',
      appVersion: '1.3.1',
      appVersionCode: 10301,
      platform: 'android-tv',
      errorCode: 'UPDATE_CHECK_NETWORK',
      correlationId: 'corr-1234',
      feature: 'app-update',
      retryable: true,
      severity: 'warning',
      exceptionType: 'java.io.IOException',
      exceptionMessage: 'network down',
    });

    expect(response.status).toBe(201);
    const stored = await CrashReport.findById(response.body.id).lean();

    expect(stored).toMatchObject({
      errorCode: 'UPDATE_CHECK_NETWORK',
      correlationId: 'corr-1234',
      feature: 'app-update',
      retryable: true,
      severity: 'warning',
      appVersion: '1.3.1',
      platform: 'android-tv',
    });
  });

  it('falls back to the API request id so a report is never orphaned', async () => {
    const response = await post({
      deviceId: 'device-no-correlation',
      exceptionType: 'java.io.IOException',
      exceptionMessage: 'no correlation id supplied',
    });

    const stored = await CrashReport.findById(response.body.id).lean();
    expect(stored?.correlationId).toBe('test-request-id');
    expect(stored?.errorCode).toBeNull();
    expect(stored?.retryable).toBeNull();
  });

  it('rejects an unknown severity and a non-boolean retryable instead of storing free text', async () => {
    const response = await post({
      deviceId: 'device-bad-fields',
      severity: 'catastrophic; DROP',
      retryable: 'maybe',
      errorCode: 'x'.repeat(200),
      exceptionType: 'java.io.IOException',
    });

    const stored = await CrashReport.findById(response.body.id).lean();
    expect(stored?.severity).toBeNull();
    expect(stored?.retryable).toBeNull();
    // Bounded, not stored whole.
    expect((stored?.errorCode || '').length).toBeLessThanOrEqual(64);
  });
});
