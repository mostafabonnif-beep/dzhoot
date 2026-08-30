import fs from 'fs';
import path from 'path';

describe('TV pairing log safety', () => {
  const source = fs.readFileSync(path.join(__dirname, 'tv.js'), 'utf8');
  const pairingSection = source.slice(source.indexOf("router.post('/pairing/request'"));

  it('does not log raw pairing PINs, session IDs, usernames, or channel-list codes', () => {
    expect(pairingSection).not.toMatch(/console\.(?:log|info|warn)\([^\n]*(?:PIN \$\{pin\}|sessionId|user\.username|user\.channelListCode)/);
    expect(pairingSection).not.toContain('Pairing request created: PIN');
    expect(pairingSection).not.toContain('Pairing confirmed: PIN');
    expect(pairingSection).not.toContain('Session not found or has no user:');
  });

  it('uses the pairing request id, rather than a PIN, for pairing audit entries', () => {
    expect(pairingSection).toContain("action: 'pairing_request'");
    expect(pairingSection).toContain("action: 'pairing_confirm'");
    expect(pairingSection).toContain('resourceId: String(pairingRequest._id)');
    expect(pairingSection).not.toMatch(/resourceId:\s*pin\b/);
  });
});
