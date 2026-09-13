# Verifying that a deployment serves the published artifact

`docs/RELEASE_PROVENANCE.md` describes the manifest a release publishes — one
machine-readable record of the artifact's identity (`versionName`, `versionCode`,
`releaseChannel`, `distribution`, `apkFileName`, `sizeBytes`, `sha256`, `signerSha256`,
`minSdk`/`targetSdk`, `commit`, `builtAt`). This describes the check that the API actually
serves that artifact.

```bash
cd server/backend
npx tsx src/scripts/verify-release-provenance.ts \
  --manifest ./dzhoof-tv-v1.3.1-official.release.json \
  --api https://iptv.ld-11.net
# or: npm run verify:release-provenance -- --manifest … --api …
```

The release job records what it uploaded; the update API serves its own view of the newest
active release. Nothing forced the two to agree — a hand-edited row, a re-pointed URL or a
stale release could leave devices downloading bytes the reviewed manifest never described.
This tool compares them field by field.

## What it does

1. Reads and validates the manifest (fails closed if `sha256`, `sizeBytes`, `versionCode`,
   `versionName`, `releaseChannel`, `distribution` or `apkFileName` is missing or
   malformed) — **before** any network call.
2. Asks the public update endpoint for exactly that release, as a device one `versionCode`
   below, so the API offers the build instead of answering "up to date".
3. Compares `versionName`, `versionCode`, `sha256`, `sizeBytes`, `releaseChannel`,
   `distribution`, and the APK file name inside the served `downloadUrl`.
4. Prints the server's own build identity from `GET /health/version` as context.

| Exit | Meaning |
|---|---|
| 0 | every field agrees — the API serves exactly the artifact the manifest describes |
| 1 | a field disagrees — do not publish or deploy until it is resolved |
| 2 | the input was unusable (missing manifest, unreachable API, unverifiable manifest) |

It needs no admin session and no database access — only the public endpoint — so it is safe
to run from CI, from an operator's machine, or before promoting a release. An API that
serves no release at all is an error, not a pass.

## A real run

Against a deployment that predates the provenance fields (so the API returns the legacy
payload), it reports exactly what is missing:

```
OK   versionName                  manifest=1.3.1 served=1.3.1
OK   versionCode                  manifest=10301 served=10301
FAIL sha256                       manifest=f0494df3… served=null
     ↳ the API served no checksum, so a device cannot verify the download
FAIL sizeBytes                    manifest=26840396 served=null
FAIL releaseChannel               manifest=stable served=null
FAIL distribution                 manifest=external_apk served=null
OK   apkFileName (via downloadUrl) manifest=dzhoof-tv-v1.3.1-official.apk served=dzhoof-tv-v1.3.1-official.apk

RESULT: MISMATCH — do not deploy/publish until this is resolved.
```

## Compatibility with an older deployment

When the API rejects `currentVersionCode` with HTTP 400, the tool retries once with the
legacy `currentVersion` parameter, so it stays usable against a pre-contract deployment
instead of reporting a false failure. Any other HTTP status is treated as a real error and
is not retried.

The Android client degrades the same way: a missing `sha256` or `sizeBytes` skips *that*
check rather than blocking the install (`UpdateVerification` only compares a value the
server actually sent, and still always verifies the signature). So the app may be updated
before the backend, and checksum verification starts working as soon as the backend
serves the fields — no rollout ordering hazard.
