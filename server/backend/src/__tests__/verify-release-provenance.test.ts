/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import os from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  parseManifest,
  compareManifestToServed,
  verifyReleaseProvenance,
} = require('../scripts/verify-release-provenance');

const SHA = 'f0494df3f964b5f16ccb50be945e98cc25fa95a8fa187189c399a81a1b481e85';

const manifest = {
  schemaVersion: 1,
  packageName: 'com.dzhoof.iptv',
  versionName: '1.4.2',
  versionCode: 10402,
  releaseChannel: 'stable',
  distribution: 'external_apk',
  apkFileName: 'dzhoof-tv-v1.4.2-official.apk',
  sizeBytes: 26840396,
  sha256: SHA,
  signerSha256: '5938049a7b7eb803d7354efb96ca1989fdf17af1f62ff0e7fb68bd765920bb11',
  minSdk: 28,
  targetSdk: 34,
  commit: 'd34db33fd34db33fd34db33fd34db33fd34db33f',
  builtAt: '2026-09-13T10:00:00Z',
};

const served = {
  versionName: '1.4.2',
  versionCode: 10402,
  releaseChannel: 'stable',
  distribution: 'external_apk',
  downloadUrl:
    'https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.4.2/dzhoof-tv-v1.4.2-official.apk',
  sha256: SHA,
  sizeBytes: 26840396,
  apkFileName: 'dzhoof-tv-v1.4.2-official.apk',
};

function tempManifest(content: unknown): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prov-')), 'release.json');
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

function fetchStub(responses: Record<string, { status?: number; body: unknown }>, seen: string[] = []) {
  return (async (url: string) => {
    seen.push(String(url));
    const key = Object.keys(responses).find((candidate) => String(url).includes(candidate));
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    const { status = 200, body } = responses[key];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as any;
  }) as unknown as typeof fetch;
}

describe('parseManifest', () => {
  it('accepts a complete manifest', () => {
    expect(parseManifest(manifest).versionCode).toBe(10402);
  });

  it.each([
    ['versionName', { ...manifest, versionName: undefined }],
    ['sha256', { ...manifest, sha256: undefined }],
    ['sizeBytes', { ...manifest, sizeBytes: 0 }],
    ['versionCode', { ...manifest, versionCode: 0 }],
  ])('rejects a manifest with an unusable %s', (_field, broken) => {
    expect(() => parseManifest(broken)).toThrow();
  });

  it('rejects a sha256 that is not a 64-character hex digest', () => {
    expect(() => parseManifest({ ...manifest, sha256: 'abc123' })).toThrow(/hex digest/);
  });

  it('rejects a non-object', () => {
    expect(() => parseManifest(null)).toThrow(/not an object/);
  });
});

describe('compareManifestToServed', () => {
  it('reports every field as matching when the API serves the published artifact', () => {
    const comparisons = compareManifestToServed(manifest, served);
    expect(comparisons).toHaveLength(7);
    expect(comparisons.every((comparison: any) => comparison.match)).toBe(true);
  });

  it('matches sha256 case-insensitively', () => {
    const comparisons = compareManifestToServed(manifest, { ...served, sha256: SHA.toUpperCase() });
    expect(comparisons.find((entry: any) => entry.field === 'sha256').match).toBe(true);
  });

  it('flags a served checksum that is absent, with the reason', () => {
    const comparisons = compareManifestToServed(manifest, { ...served, sha256: null });
    const entry = comparisons.find((item: any) => item.field === 'sha256');
    expect(entry.match).toBe(false);
    expect(entry.note).toMatch(/cannot verify/);
  });

  it.each([
    ['versionCode', { versionCode: 10403 }],
    ['sizeBytes', { sizeBytes: 26840397 }],
    ['releaseChannel', { releaseChannel: 'beta' }],
    ['distribution', { distribution: 'play' }],
    ['versionName', { versionName: '1.4.3' }],
  ])('flags a %s the API disagrees about', (field, override) => {
    const comparisons = compareManifestToServed(manifest, { ...served, ...override });
    expect(comparisons.find((entry: any) => entry.field === field).match).toBe(false);
  });

  it('fails closed when the API serves no download URL at all', () => {
    const comparisons = compareManifestToServed(manifest, { ...served, downloadUrl: null });
    const entry = comparisons.find((item: any) => item.field.startsWith('apkFileName'));
    expect(entry.match).toBe(false);
    expect(entry.note).toMatch(/cannot download/);
  });

  it('flags a download URL that names a different file', () => {
    const comparisons = compareManifestToServed(manifest, {
      ...served,
      downloadUrl: 'https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.4.2/dzhoof-tv-v1.4.2-debug.apk',
    });
    expect(comparisons.find((item: any) => item.field.startsWith('apkFileName')).match).toBe(false);
  });
});

describe('verifyReleaseProvenance', () => {
  it('agrees when the API serves the manifest artifact, and probes as a device one code below', async () => {
    const seen: string[] = [];
    const result = await verifyReleaseProvenance({
      manifestPath: tempManifest(manifest),
      apiBaseUrl: 'https://iptv.ld-11.net/',
      fetchImpl: fetchStub(
        {
          '/api/v1/app/version': { body: { success: true, updateAvailable: true, latestVersion: served } },
          '/health/version': { body: { version: '1.4.2', commit: 'abc1234', builtAt: '2026-09-13T10:00:00Z' } },
        },
        seen
      ),
    });

    expect(result.ok).toBe(true);
    expect(result.server).toMatchObject({ version: '1.4.2', commit: 'abc1234' });
    expect(seen[0]).toContain('currentVersionCode=10401');
    expect(seen[0]).toContain('channel=stable');
    expect(seen[0]).toContain('platform=android-tv');
    expect(seen[0].startsWith('https://iptv.ld-11.net/api/v1/app/version')).toBe(true);
  });

  it('reports a mismatch instead of throwing', async () => {
    const result = await verifyReleaseProvenance({
      manifestPath: tempManifest(manifest),
      apiBaseUrl: 'https://iptv.ld-11.net',
      fetchImpl: fetchStub({
        '/api/v1/app/version': { body: { success: true, latestVersion: { ...served, sha256: 'a'.repeat(64) } } },
        '/health/version': { status: 500, body: {} },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.comparisons.find((entry: any) => entry.field === 'sha256').match).toBe(false);
    expect(result.server).toBeUndefined();
  });

  it('refuses to compare when the API offers no release', async () => {
    await expect(
      verifyReleaseProvenance({
        manifestPath: tempManifest(manifest),
        apiBaseUrl: 'https://iptv.ld-11.net',
        fetchImpl: fetchStub({
          '/api/v1/app/version': { body: { success: true, latestVersion: null, message: 'No APK asset found' } },
        }),
      })
    ).rejects.toThrow(/served no release/);
  });

  it('falls back to the legacy currentVersion parameter on an older deployment', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      if (String(url).includes('currentVersionCode')) {
        return {
          ok: false,
          status: 400,
          text: async () => '{"error":"Current version is required"}',
        } as any;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, latestVersion: served }) } as any;
    }) as unknown as typeof fetch;

    const result = await verifyReleaseProvenance({
      manifestPath: tempManifest(manifest),
      apiBaseUrl: 'https://legacy.example',
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(seen[0]).toContain('currentVersionCode=');
    expect(seen[1]).toContain('currentVersion=');
    // The legacy call must not smuggle the contract parameter in as well.
    expect(seen[1]).not.toContain('currentVersionCode=');
  });

  it('does not retry when the API fails for a reason other than the parameter name', async () => {
    const seen: string[] = [];
    await expect(
      verifyReleaseProvenance({
        manifestPath: tempManifest(manifest),
        apiBaseUrl: 'https://iptv.ld-11.net',
        fetchImpl: fetchStub({ '/api/v1/app/version': { status: 503, body: { error: 'down' } } }, seen),
      })
    ).rejects.toThrow(/HTTP 503/);
    expect(seen).toHaveLength(1);
  });

  it('surfaces an API error rather than reporting a pass', async () => {
    await expect(
      verifyReleaseProvenance({
        manifestPath: tempManifest(manifest),
        apiBaseUrl: 'https://iptv.ld-11.net',
        fetchImpl: fetchStub({ '/api/v1/app/version': { status: 500, body: {} } }),
      })
    ).rejects.toThrow(/HTTP 500/);
  });

  it('refuses to run without a manifest file', async () => {
    await expect(
      verifyReleaseProvenance({
        manifestPath: '/tmp/does-not-exist-release.json',
        apiBaseUrl: 'https://iptv.ld-11.net',
        fetchImpl: fetchStub({}),
      })
    ).rejects.toThrow(/manifest not found/);
  });

  it('refuses an unverifiable manifest before touching the network', async () => {
    const seen: string[] = [];
    await expect(
      verifyReleaseProvenance({
        manifestPath: tempManifest({ ...manifest, sha256: undefined }),
        apiBaseUrl: 'https://iptv.ld-11.net',
        fetchImpl: fetchStub({}, seen),
      })
    ).rejects.toThrow(/missing required field/);
    expect(seen).toHaveLength(0);
  });
});
