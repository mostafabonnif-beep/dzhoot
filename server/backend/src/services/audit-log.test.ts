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
