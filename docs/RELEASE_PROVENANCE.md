# Release provenance

_Operations brief §3: one set of values must agree across Git, the APK, the Docker image,
`/health` and the GitHub Release._

## What is published

Every `vX.Y.Z` release from `.github/workflows/android-release.yml` attaches three files:

| Asset | What it is |
|---|---|
| `dzhoof-tv-vX.Y.Z-official.apk` | The signed production APK. |
| `dzhoof-tv-vX.Y.Z-official.apk.sha256` | Its SHA-256, as `sha256sum` prints it. |
| `dzhoof-tv-vX.Y.Z-official.release.json` | The machine-readable provenance manifest below. |

The manifest is shown in the workflow run's step summary as well, so a deploy can be
checked without downloading anything.

## The manifest

Produced by `scripts/ci/write-release-manifest.sh`, which reads the identity **from the APK
itself** rather than from the workflow's variables:

```json
{
  "schemaVersion": 1,
  "packageName": "com.dzhoof.iptv",
  "versionName": "1.3.1",
  "versionCode": 10301,
  "releaseChannel": "stable",
  "distribution": "external_apk",
  "apkFileName": "dzhoof-tv-v1.3.1-official.apk",
  "sizeBytes": 26840396,
  "sha256": "f0494df3f964b5f16ccb50be945e98cc25fa95a8fa187189c399a81a1b481e85",
  "signerSha256": "5938049a7b7eb803d7354efb96ca1989fdf17af1f62ff0e7fb68bd765920bb11",
  "minSdk": 28,
  "targetSdk": 34,
  "commit": "3f4f87cc3d56e4fa7cba08d7effb2e3e0012b6df",
  "builtAt": "2026-09-13T23:15:43Z"
}
```

`versionCode` is the documented derivation — `major * 10000 + minor * 100 + patch` — and the
script **fails the release** when the APK disagrees with it, so a build can never publish a
code that does not match its version name.

## Fail-closed rules

The release job stops, and nothing is uploaded, when any of these is true:

- the APK is missing/empty, or its package is not `com.dzhoof.iptv`;
- the APK's `versionName` differs from the requested version;
- the APK's `versionCode` differs from the derived code;
- the SHA-256 cannot be computed, or the APK has no verifiable signature;
- the signing certificate's SHA-256 digest cannot be read;
- `channel` is not `stable`/`beta`, or `distribution` is not
  `play`/`external_apk`/`managed_device`.

A release therefore never ships without a signer fingerprint and a checksum.

## How it ties together

- `sha256` and `sizeBytes` are the values `GET /api/v1/app/version` serves in
  `latestVersion.sha256` / `latestVersion.sizeBytes`, and the Android client verifies the
  downloaded APK against them before installing (`UpdateVerifier`).
- `signerSha256` is the production certificate the client compares against the installed
  app's signature.
- `versionCode`, `releaseChannel` and `distribution` are the same fields the `AppVersion`
  collection stores (see `server/docs/API_DOCUMENTATION.md`, "Admin: Manage Release
  Metadata"), and migration 0016 backfills `releaseChannel`/`distribution` on older rows.
- `commit` matches `release.commit` reported by `GET /health` and `GET /health/version`.

## Usage

```bash
cd android
ANDROID_SDK_ROOT=/path/to/android-sdk \
RELEASE_COMMIT="$(git rev-parse HEAD)" \
  ../scripts/ci/write-release-manifest.sh \
    dzhoof-tv-v1.3.1-official.apk 1.3.1 stable external_apk dzhoof-tv-v1.3.1-official.release.json
```

`EXPECTED_PACKAGE` overrides the package check (useful when validating the script against a
staging/debug APK locally); `BUILT_AT` overrides the timestamp.

## Where it runs

| Stage | What enforces the contract |
|---|---|
| Release build | `.github/workflows/android-release.yml` generates the manifest after `apksigner verify`, fails the job on any mismatch, prints the manifest in the step summary and uploads it next to the APK and its `.sha256`. |
| Pull requests | `scripts/ci/test-write-release-manifest.sh`, run in the `Secret guard` job, drives the generator with stubbed `aapt`/`apksigner` and asserts the happy path plus every fail-closed case (versionCode above/below the derived code, foreign package, wrong versionName, unreadable certificate, unknown channel/distribution, empty or absent APK, missing SDK, missing arguments). |
| Deploy | `server/backend/src/scripts/verify-release-provenance.ts` (`npm run verify:release-provenance` in `server/backend`) compares a published release against what the API actually serves. |
