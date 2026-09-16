import { redactSensitiveText } from './audit-log';

describe('redactSensitiveText', () => {
  it('redacts credentials embedded in URLs and secret query parameters', () => {
    const value = redactSensitiveText(
      'request failed: https://xtream-user:super-secret@example.test/player_api.php?username=xtream-user&password=super-secret',
    );

    expect(value).not.toContain('super-secret');
    expect(value).toContain('https://[redacted]@example.test');
    expect(value).toContain('password=[redacted]');
  });

  it('redacts bearer tokens and bounds diagnostic length', () => {
    const value = redactSensitiveText(`Bearer abc.def.ghi ${'x'.repeat(2000)}`);

    expect(value).toContain('Bearer [redacted]');
    expect(value.length).toBeLessThanOrEqual(1000);
  });

  it('redacts Xtream-style account segments embedded in stream paths', () => {
    const value = redactSensitiveText(
      'probe failed: https://xtream.example.test:8080/live/dz-user/SuperSecret1/1423.ts',
    );

    expect(value).not.toContain('SuperSecret1');
    expect(value).not.toContain('dz-user');
    expect(value).toContain('/live/[redacted]/[redacted]/1423.ts');
  });

  it('redacts signed JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl';
    const value = redactSensitiveText(`playback token rejected: ${jwt}`);

    expect(value).not.toContain('c2lnbmF0dXJlLXZhbHVl');
    expect(value).toContain('[redacted-jwt]');
  });

  it('honours a caller-supplied length bound', () => {
    const value = redactSensitiveText('x'.repeat(900), 128);

    expect(value.length).toBe(128);
  });
});

describe('redactSensitiveText — secret classes found by the crash-report e2e test', () => {
  it('redacts a Cookie / Set-Cookie header line', () => {
    // Regression (2026-09-15): `cookie: session=…` passed every rule and was stored
    // verbatim in a crash report; the end-to-end redaction test caught it.
    const redacted = redactSensitiveText('Request failed with Cookie: session=abc123def456; csrf=zzz');

    expect(redacted).not.toContain('abc123def456');
    expect(redacted).not.toContain('csrf=zzz');
    expect(redacted).toContain('Cookie: [redacted]');
  });

  it('redacts a Set-Cookie response header line', () => {
    const redacted = redactSensitiveText('headers: Set-Cookie: playback_token=topsecret');

    expect(redacted).not.toContain('topsecret');
    expect(redacted).toContain('[redacted]');
  });

  it('redacts raw IPv4 addresses', () => {
    const redacted = redactSensitiveText('connect to 185.199.108.153:8080 timed out');

    expect(redacted).not.toContain('185.199.108.153');
    expect(redacted).toContain('[redacted-ip]');
  });

  it('leaves non-secret diagnostics readable', () => {
    const redacted = redactSensitiveText('RepositoryImpl.kt:120 network unavailable');

    expect(redacted).toBe('RepositoryImpl.kt:120 network unavailable');
  });
});

describe('redactSensitiveText — secret classes that survived the 2026-09-15 rules', () => {
  // Each case below was confirmed to pass through unchanged by replaying the previous
  // rule set. They are the "منع إرسال كلمات المرور وTokens وCookies" contract from the
  // operations brief, and the same table is asserted on the Android side in
  // `android/.../crash/CrashRedactorTest.kt` so the two implementations stay in step.

  it('redacts a JSON-encoded secret assignment', () => {
    // JSONObject.toString() output is exactly what a throwable message carries.
    const redacted = redactSensitiveText('{"password":"hunter2","user":"ali"}');

    expect(redacted).not.toContain('hunter2');
    expect(redacted).toContain('"password":"[redacted]"');
  });

  it('redacts a JSON-encoded token assignment', () => {
    const redacted = redactSensitiveText('body: {"token":"abc123","ok":true}');

    expect(redacted).not.toContain('abc123');
    expect(redacted).toContain('"token":"[redacted]"');
  });

  it('redacts the credential of an Authorization header, not just the scheme word', () => {
    // The previous rule consumed one bare token, so `Basic dXNlcjpwYXNz` kept the
    // base64 credential.
    const redacted = redactSensitiveText('Authorization: Basic dXNlcjpwYXNz');

    expect(redacted).not.toContain('dXNlcjpwYXNz');
    expect(redacted).toContain('Authorization: [redacted]');
  });

  it('redacts an Authorization header regardless of the key casing', () => {
    const redacted = redactSensitiveText('authorization: Basic dXNlcjpwYXNz');

    expect(redacted).not.toContain('dXNlcjpwYXNz');
  });

  it('redacts an inline auth scheme with no header form', () => {
    const redacted = redactSensitiveText('upstream rejected: Basic dXNlcjpwYXNz (401)');

    expect(redacted).not.toContain('dXNlcjpwYXNz');
    expect(redacted).toContain('Basic [redacted]');
  });

  it('redacts cookie and session assignments outside a header line', () => {
    const cookies = redactSensitiveText('cookies=sessionid=abc123def');
    const session = redactSensitiveText('sessionid=abc123def');

    expect(cookies).not.toContain('abc123def');
    expect(session).not.toContain('abc123def');
  });

  it('redacts credentials in a non-HTTP stream URL', () => {
    const redacted = redactSensitiveText('rtsp://operator:s3cret@10.0.0.5/live/1 failed');

    expect(redacted).not.toContain('s3cret');
    expect(redacted).toContain('[redacted]@[redacted-ip]');
  });

  it('redacts IPv6 addresses in every shape that appears in diagnostics', () => {
    const compressed = redactSensitiveText('connect to 2001:db8::1 refused');
    const bracketed = redactSensitiveText('http://[2001:db8::1]/live/a/b/1.ts failed');
    const loopback = redactSensitiveText('bind ::1 failed');
    const full = redactSensitiveText('peer fe80:0:0:0:0:0:0:1 down');

    for (const value of [compressed, bracketed, loopback, full]) {
      expect(value).toContain('[redacted-ip]');
    }
    expect(bracketed).not.toContain('2001:db8::1');
    expect(compressed).not.toContain('2001:db8::1');
  });

  it('does not redact a wall-clock time or a file:line reference', () => {
    // The IPv6 rule requires a literal `::`, so ordinary times survive.
    expect(redactSensitiveText('timed out after 12:34:56')).toBe('timed out after 12:34:56');
    expect(redactSensitiveText('StreamRepository.kt:412 retry')).toBe('StreamRepository.kt:412 retry');
  });
});
