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
