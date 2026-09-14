#!/usr/bin/env bash
#
# Build the machine-readable release manifest for a published APK.
#
# Operations brief §3 requires one set of values that agree across Git, the APK, the
# Docker image, `/health` and the GitHub Release: versionName, versionCode, channel,
# distribution, size, SHA-256, signing certificate fingerprint and the commit.
#
# It reads the identity from the APK itself (never from the workflow's variables) and
# fails closed: without a checksum, a signing certificate and a versionCode that matches
# the documented derivation, the release must not be published.
#
# Usage:
#   write-release-manifest.sh <apk> <versionName> <channel> <distribution> <out.json>
#
# Environment:
#   ANDROID_SDK_ROOT / ANDROID_HOME   to locate build-tools (required)
#   BUILD_TOOLS_VERSION               default 34.0.0
#   RELEASE_COMMIT / GITHUB_SHA       the commit the artifact was built from
#   EXPECTED_PACKAGE                  default com.dzhoof.iptv (override for local runs)
#   BUILT_AT                          override the timestamp (defaults to now, UTC)

set -euo pipefail

fail() {
  echo "[release-manifest] ERROR: $*" >&2
  exit 1
}

if [ "$#" -ne 5 ]; then
  echo "usage: $0 <apk> <versionName> <channel> <distribution> <out.json>" >&2
  exit 2
fi

apk="$1"
version_name="$2"
channel="$3"
distribution="$4"
out="$5"

[ -s "$apk" ] || fail "APK not found or empty: $apk"
case "$channel" in
  stable | beta) ;;
  *) fail "channel must be 'stable' or 'beta', got '$channel'" ;;
esac
case "$distribution" in
  play | external_apk | managed_device) ;;
  *) fail "distribution must be play|external_apk|managed_device, got '$distribution'" ;;
esac

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
[ -n "$sdk_root" ] || fail "ANDROID_SDK_ROOT/ANDROID_HOME is not set"
build_tools="$sdk_root/build-tools/${BUILD_TOOLS_VERSION:-34.0.0}"
apksigner="$build_tools/apksigner"
aapt="$build_tools/aapt"
[ -x "$apksigner" ] || fail "apksigner not found at $apksigner"
[ -x "$aapt" ] || fail "aapt not found at $aapt"

# ─── Identity, read from the artifact itself ────────────────────────────────
badging="$("$aapt" dump badging "$apk")"
apk_package="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<<"$badging" | head -1)"
apk_version_name="$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<<"$badging" | head -1)"
apk_version_code="$(sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" <<<"$badging" | head -1)"
apk_min_sdk="$(sed -n "s/.*sdkVersion:'\([^']*\)'.*/\1/p" <<<"$badging" | head -1)"
apk_target_sdk="$(sed -n "s/.*targetSdkVersion:'\([^']*\)'.*/\1/p" <<<"$badging" | head -1)"

expected_package="${EXPECTED_PACKAGE:-com.dzhoof.iptv}"
[ "$apk_package" = "$expected_package" ] || fail "package is '$apk_package', expected '$expected_package'"
[ "$apk_version_name" = "$version_name" ] || fail "APK versionName '$apk_version_name' != requested '$version_name'"
[ -n "$apk_version_code" ] || fail "could not read versionCode from the APK"

# versionCode must be the documented derivation: major * 10000 + minor * 100 + patch.
# A pre-release suffix (1.0.0-rc.1) is dropped for the derivation, exactly as
# android/app/build.gradle.kts does (`.split("-")[0]`); the APK still reports the full
# versionName. Without this the patch part parsed as "0-rc.1" and the comparison failed
# for every release candidate.
base_version="${version_name%%-*}"
IFS=. read -r major minor patch <<<"$base_version"
major="${major//[^0-9]/}"
minor="${minor//[^0-9]/}"
patch="${patch//[^0-9]/}"
[ -n "$major" ] || fail "versionName '$version_name' has no numeric major part"
minor="${minor:-0}"
patch="${patch:-0}"
expected_code=$((major * 10000 + minor * 100 + patch))
[ "$apk_version_code" = "$expected_code" ] ||
  fail "APK versionCode $apk_version_code != derived $expected_code (from versionName $version_name)"

# ─── Integrity: checksum + signing certificate ──────────────────────────────
sha256="$(sha256sum "$apk" | awk '{print $1}')"
[[ "$sha256" =~ ^[a-f0-9]{64}$ ]] || fail "could not compute the APK SHA-256"

certs="$("$apksigner" verify --print-certs "$apk")" ||
  fail "apksigner could not verify the APK signature"
signer_sha256="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<<"$certs" | head -1 | tr 'A-F' 'a-f')"
[[ "$signer_sha256" =~ ^[a-f0-9]{64}$ ]] || fail "could not read the signing certificate SHA-256 digest"

size_bytes="$(wc -c <"$apk" | tr -d ' ')"
[ "$size_bytes" -gt 0 ] || fail "APK size is zero"

commit="${RELEASE_COMMIT:-${GITHUB_SHA:-unknown}}"
[ "$commit" != "unknown" ] || echo "[release-manifest] WARNING: no commit provided; recording 'unknown'" >&2
built_at="${BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
apk_file="$(basename "$apk")"

# ─── Emit ──────────────────────────────────────────────────────────────────
cat >"$out" <<JSON
{
  "schemaVersion": 1,
  "packageName": "$apk_package",
  "versionName": "$apk_version_name",
  "versionCode": $apk_version_code,
  "releaseChannel": "$channel",
  "distribution": "$distribution",
  "apkFileName": "$apk_file",
  "sizeBytes": $size_bytes,
  "sha256": "$sha256",
  "signerSha256": "$signer_sha256",
  "minSdk": ${apk_min_sdk:-0},
  "targetSdk": ${apk_target_sdk:-0},
  "commit": "$commit",
  "builtAt": "$built_at"
}
JSON

if command -v jq >/dev/null 2>&1; then
  jq -e '.sha256 and .signerSha256 and .versionCode' "$out" >/dev/null || fail "generated manifest is not valid JSON"
fi

echo "[release-manifest] wrote $out"
echo "[release-manifest] versionCode=$apk_version_code channel=$channel distribution=$distribution"
echo "[release-manifest] sha256=$sha256"
echo "[release-manifest] signerSha256=$signer_sha256"
