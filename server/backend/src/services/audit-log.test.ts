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
});
