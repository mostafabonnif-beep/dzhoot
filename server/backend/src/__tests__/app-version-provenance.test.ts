import AppVersion from '../models/AppVersion';
import {
  backfillAppVersionProvenance,
  PROVENANCE_FILTER,
} from '../scripts/migrations/0016-app-version-provenance';

const APK_URL =
  'https://github.com/mostafabonnif-beep/dzhoot/releases/download/v1.4.2/dzhoof-tv-v1.4.2-official.apk';
const SHA256 = 'f0494df3f964b5f16ccb50be945e98cc25fa95a8fa187189c399a81a1b481e85';

function versionDoc(overrides: Record<string, unknown> = {}) {
  return {
    versionName: '1.4.2',
    versionCode: 10402,
    apkFileName: 'dzhoof-tv-v1.4.2-official.apk',
    apkFileSize: 26840396,
    downloadUrl: APK_URL,
    ...overrides,
  };
}

describe('AppVersion provenance fields', () => {
  it('defaults to the stable external-APK channel', async () => {
    const created = await AppVersion.create(versionDoc());

    expect(created.releaseChannel).toBe('stable');
    expect(created.distribution).toBe('external_apk');
    expect(created.sha256).toBeNull();
    expect(created.platforms).toBeUndefined();
  });

  it('accepts a valid checksum and rejects a malformed one', async () => {
    const ok = await AppVersion.create(versionDoc({ sha256: SHA256 }));
    expect(ok.sha256).toBe(SHA256);

    await expect(
      AppVersion.create(versionDoc({ versionCode: 10403, versionName: '1.4.3', sha256: 'not-a-checksum' })),
    ).rejects.toThrow();
  });

  it('rejects an unknown channel, distribution or platform', async () => {
    await expect(
      AppVersion.create(versionDoc({ releaseChannel: 'nightly' })),
    ).rejects.toThrow();

    await expect(
      AppVersion.create(versionDoc({ versionCode: 10404, versionName: '1.4.4', distribution: 'sideload' })),
    ).rejects.toThrow();

    await expect(
      AppVersion.create(versionDoc({ versionCode: 10405, versionName: '1.4.5', platforms: ['ios'] })),
    ).rejects.toThrow();
  });

  it('stores a platform scope when one is given', async () => {
    const created = await AppVersion.create(versionDoc({ platforms: ['android-tv', 'fire-tv'] }));
    expect(created.platforms).toEqual(['android-tv', 'fire-tv']);
  });
});

describe('migration 0016 — AppVersion provenance backfill', () => {
  /** Insert straight into the collection so the legacy row has no provenance fields. */
  async function insertLegacy(versionCode: number) {
    await AppVersion.collection.insertOne({
      versionName: `1.0.${versionCode - 10000}`,
      versionCode,
      apkFileName: `legacy-${versionCode}.apk`,
      apkFileSize: 1234,
      downloadUrl: APK_URL,
      releaseNotes: '',
      isActive: true,
      isMandatory: false,
      minCompatibleVersion: 1,
      releasedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it('dry-runs first, then backfills the legacy rows once and only once', async () => {
    await insertLegacy(10100);
    await insertLegacy(10101);
    await AppVersion.create(versionDoc({ versionName: '1.1.0', versionCode: 10110, releaseChannel: 'beta', distribution: 'play' }));

    const dryRun = await backfillAppVersionProvenance();
    expect(dryRun.matched).toBe(2);
    expect(dryRun.modified).toBe(0);
    expect(await AppVersion.countDocuments(PROVENANCE_FILTER)).toBe(2);

    const applied = await backfillAppVersionProvenance({ commit: true });
    expect(applied.matched).toBe(2);
    expect(applied.modified).toBe(2);
    expect(await AppVersion.countDocuments(PROVENANCE_FILTER)).toBe(0);

    const legacy = await AppVersion.findOne({ versionCode: 10100 }).lean();
    expect(legacy?.releaseChannel).toBe('stable');
    expect(legacy?.distribution).toBe('external_apk');

    // An explicit non-default row must not be overwritten.
    const beta = await AppVersion.findOne({ versionCode: 10110 }).lean();
    expect(beta?.releaseChannel).toBe('beta');
    expect(beta?.distribution).toBe('play');

    const secondRun = await backfillAppVersionProvenance({ commit: true });
    expect(secondRun).toEqual({ matched: 0, modified: 0 });
  });
});
