#!/usr/bin/env bash
#
# Fail-closed test for scripts/ci/write-release-manifest.sh.
#
# The release manifest is the only place where the values that must agree across Git,
# the APK, the Docker image, /health and the GitHub Release are written down (operations
# brief §3). A silent regression here would publish a release whose checksum or signing
# certificate is missing — exactly what docs/RELEASE_PROVENANCE.md promises cannot happen —
# so the generator is exercised against stubbed SDK tools instead of a real Android SDK.
#
# Runs on a bare runner: no network, no Android SDK, no Node.

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/ci/write-release-manifest.sh"
[ -x "$SCRIPT" ] || { echo "generator is missing or not executable: $SCRIPT" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

COMMIT='3f4f87cc3d56e4fa7cba08d7effb2e3e0012b6df'
BUILT_AT='2026-09-13T23:15:43Z'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# ─── Stubs: aapt / apksigner read the APK the way the real tools do ──────────
SDK="$TMP/sdk"
mkdir -p "$SDK/build-tools/34.0.0"

cat > "$SDK/build-tools/34.0.0/aapt" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = "dump" ] || exit 1
cat <<BADGING
package: name='${FAKE_PACKAGE:-com.dzhoof.iptv}' versionCode='${FAKE_VERSION_CODE:-10301}' versionName='${FAKE_VERSION_NAME:-1.3.1}' compileSdkVersion='34' platformBuildVersionName='14'
sdkVersion:'28'
targetSdkVersion:'34'
BADGING
STUB

cat > "$SDK/build-tools/34.0.0/apksigner" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [ -n "${FAKE_UNSIGNED:-}" ]; then
  echo 'Signer #1 certificate SHA-256 digest: not-a-digest'
  exit 0
fi
# Uppercase on purpose: the generator must normalise the fingerprint to lowercase hex.
echo 'Signer #1 certificate SHA-256 digest: 5938049A7B7EB803D7354EFB96CA1989FDF17AF1F62FF0E7FB68BD765920BB11'
exit 0
STUB

chmod +x "$SDK/build-tools/34.0.0/aapt" "$SDK/build-tools/34.0.0/apksigner"

APK="$TMP/dzhoof-tv-v1.3.1-official.apk"
head -c 4096 /dev/urandom > "$APK"

# generate [EXTRA_ENV="KEY=VAL ..."] <args...>
# Extra environment is passed through `env` so the stub tools see it regardless of how
# bash scopes a `VAR=value function-call` assignment.
generate() {
  local extra="${1:-}"
  if [ "$#" -gt 0 ]; then
    shift
  fi
  # shellcheck disable=SC2086 # $extra is an intentional list of KEY=VALUE pairs.
  env ANDROID_SDK_ROOT="$SDK" \
    RELEASE_COMMIT="$COMMIT" \
    BUILT_AT="$BUILT_AT" \
    $extra bash "$SCRIPT" "$@" >/dev/null 2>&1
}

# expect_failure <label> [EXTRA_ENV] <args...>
expect_failure() {
  local label="$1"
  shift
  if generate "$@"; then
    fail "$label: expected the generator to fail"
  fi
  echo "ok: $label fails closed"
}

# ─── 1) Happy path ──────────────────────────────────────────────────────────
out="$TMP/manifest.json"
generate "" "$APK" 1.3.1 stable external_apk "$out" || fail 'happy path did not produce a manifest'
[ -s "$out" ] || fail 'happy path produced an empty manifest'

expected_sha="$(sha256sum "$APK" | awk '{print $1}')"
expect_field() {
  local field="$1" expected="$2" actual
  actual="$(sed -n "s/.*\"$field\": \"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" "$out" | head -1)"
  [ "$actual" = "$expected" ] || fail "manifest field $field = '$actual', expected '$expected'"
}

expect_field packageName 'com.dzhoof.iptv'
expect_field versionName '1.3.1'
expect_field releaseChannel 'stable'
expect_field distribution 'external_apk'
expect_field sha256 "$expected_sha"
expect_field signerSha256 '5938049a7b7eb803d7354efb96ca1989fdf17af1f62ff0e7fb68bd765920bb11'
expect_field commit "$COMMIT"
expect_field builtAt "$BUILT_AT"

grep -q '"versionCode": 10301' "$out" || fail 'manifest versionCode is not the derived code'
grep -q '"sizeBytes": 4096' "$out" || fail 'manifest sizeBytes does not match the artifact'
grep -Eq '"sha256": "[a-f0-9]{64}"' "$out" || fail 'manifest sha256 is not lowercase 64-hex'
grep -Eq '"signerSha256": "[a-f0-9]{64}"' "$out" || fail 'manifest signerSha256 is not lowercase 64-hex'

if command -v jq >/dev/null 2>&1; then
  jq -e '.versionCode == 10301 and (.sha256 | length == 64) and (.signerSha256 | length == 64)' "$out" >/dev/null ||
    fail 'manifest is not the expected JSON shape'
fi
echo 'ok: happy path writes the full manifest'

# ─── 2) Fail-closed cases ───────────────────────────────────────────────────
# An APK advertising a code the version name does not derive to must never ship.
expect_failure 'versionCode below the derived code' "FAKE_VERSION_CODE=10300" \
  "$APK" 1.3.1 stable external_apk "$TMP/out-code.json"
expect_failure 'versionCode above the derived code' "FAKE_VERSION_NAME=1.3.2 FAKE_VERSION_CODE=10301" \
  "$APK" 1.3.2 stable external_apk "$TMP/out-code2.json"
expect_failure 'foreign package name' "FAKE_PACKAGE=com.evil.iptv" \
  "$APK" 1.3.1 stable external_apk "$TMP/out-pkg.json"
expect_failure 'APK versionName != requested version' "FAKE_VERSION_NAME=1.3.0" \
  "$APK" 1.3.1 stable external_apk "$TMP/out-name.json"
expect_failure 'unreadable signing certificate' "FAKE_UNSIGNED=1" \
  "$APK" 1.3.1 stable external_apk "$TMP/out-cert.json"
expect_failure 'unknown channel' "" \
  "$APK" 1.3.1 nightly external_apk "$TMP/out-channel.json"
expect_failure 'unknown distribution' "" \
  "$APK" 1.3.1 stable usb_stick "$TMP/out-dist.json"

: > "$TMP/empty.apk"
expect_failure 'empty APK' "" "$TMP/empty.apk" 1.3.1 stable external_apk "$TMP/out-empty.json"
expect_failure 'missing APK' "" "$TMP/absent.apk" 1.3.1 stable external_apk "$TMP/out-absent.json"

if env -u ANDROID_SDK_ROOT -u ANDROID_HOME bash "$SCRIPT" "$APK" 1.3.1 stable external_apk "$TMP/out-nosdk.json" >/dev/null 2>&1; then
  fail 'missing SDK: expected the generator to fail'
fi
echo 'ok: missing Android SDK fails closed'

if bash "$SCRIPT" >/dev/null 2>&1; then
  fail 'no arguments: expected the generator to fail'
fi
echo 'ok: missing arguments fail closed'

echo 'write-release-manifest tests passed'
