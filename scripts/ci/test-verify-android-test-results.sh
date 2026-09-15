#!/usr/bin/env bash
#
# Drives scripts/ci/verify-android-test-results.sh against synthetic JUnit XML,
# asserting both the happy path and every fail-closed case. Run in CI from the
# `Secret guard` job, next to test-write-release-manifest.sh, so a change to the
# verifier cannot silently weaken the Android gate.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERIFIER="$REPO_ROOT/scripts/ci/verify-android-test-results.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failures=0
pass=0

suite() {
  # suite <name> <tests> <failures> <errors>
  cat > "$TMP/run/$1.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="$1" tests="$2" skipped="0" failures="$3" errors="$4" time="1.0">
  <testcase classname="$1" name="ok_case" time="0.1"/>
EOF
  if [ "$3" != "0" ] || [ "$4" != "0" ]; then
    cat >> "$TMP/run/$1.xml" <<EOF
  <testcase classname="$1" name="bad_case" time="0.1">
    <failure message="expected true but was false">stack</failure>
  </testcase>
EOF
  fi
  echo "</testsuite>" >> "$TMP/run/$1.xml"
}

expect_ok() {
  local label="$1"; shift
  if out="$("$@" 2>&1)"; then
    pass=$((pass + 1))
    echo "  ok   - $label"
  else
    failures=$((failures + 1))
    echo "  FAIL - $label (expected success)"
    echo "$out" | sed 's/^/         /'
  fi
}

expect_fail() {
  local label="$1"; shift
  if out="$("$@" 2>&1)"; then
    failures=$((failures + 1))
    echo "  FAIL - $label (expected failure)"
    echo "$out" | sed 's/^/         /'
  else
    pass=$((pass + 1))
    echo "  ok   - $label"
  fi
}

echo "verify-android-test-results.sh"

# --- fail-closed: no results directory at all -------------------------------
rm -rf "$TMP/run"
expect_fail "missing results directory is rejected" \
  env MIN_ANDROID_TESTS=1 "$VERIFIER" "$TMP/run"

# --- fail-closed: directory exists but holds no XML -------------------------
mkdir -p "$TMP/run"
expect_fail "empty results directory is rejected" \
  env MIN_ANDROID_TESTS=1 "$VERIFIER" "$TMP/run"

# --- fail-closed: zero tests reported --------------------------------------
suite empty_suite 0 0 0
expect_fail "a run that reported zero tests is rejected" \
  env MIN_ANDROID_TESTS=1 "$VERIFIER" "$TMP/run"

# --- fail-closed: a real failure and a real error --------------------------
rm -rf "$TMP/run"; mkdir -p "$TMP/run"
suite with_failure 10 1 0
expect_fail "a failing test case is rejected" \
  env MIN_ANDROID_TESTS=1 "$VERIFIER" "$TMP/run"

rm -rf "$TMP/run"; mkdir -p "$TMP/run"
suite with_error 10 0 1
expect_fail "an errored test case is rejected" \
  env MIN_ANDROID_TESTS=1 "$VERIFIER" "$TMP/run"

# --- fail-closed: unreadable XML -------------------------------------------
rm -rf "$TMP/run"; mkdir -p "$TMP/run"
printf '<testsuite name="broken" tests="1"' > "$TMP/run/broken.xml"
expect_fail "truncated XML is rejected" \
  env MIN_ANDROID_TESTS=1 "$VERIFIER" "$TMP/run"

# --- happy path: clean suites, above baseline ------------------------------
rm -rf "$TMP/run"; mkdir -p "$TMP/run"
suite alpha 300 0 0
suite beta 250 0 0
expect_ok "clean results above the baseline pass" \
  env MIN_ANDROID_TESTS=500 "$VERIFIER" "$TMP/run"

# --- happy path with a warning: below baseline, still green -----------------
rm -rf "$TMP/run"; mkdir -p "$TMP/run"
suite small 12 0 0
out="$(env MIN_ANDROID_TESTS=500 "$VERIFIER" "$TMP/run" 2>&1)" || {
  failures=$((failures + 1))
  echo "  FAIL - below-baseline run should warn, not fail"
  echo "$out" | sed 's/^/         /'
  out=""
}
if [ -n "$out" ]; then
  case "$out" in
    *"::warning"*) pass=$((pass + 1)); echo "  ok   - below-baseline run warns but passes" ;;
    *) failures=$((failures + 1)); echo "  FAIL - below-baseline run did not warn"; echo "$out" | sed 's/^/         /' ;;
  esac
fi

# --- a <testsuites> aggregate root is accepted ------------------------------
rm -rf "$TMP/run"; mkdir -p "$TMP/run"
cat > "$TMP/run/aggregate.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="one" tests="4" failures="0" errors="0" skipped="0">
    <testcase classname="one" name="a"/>
  </testsuite>
  <testsuite name="two" tests="6" failures="0" errors="0" skipped="0">
    <testcase classname="two" name="b"/>
  </testsuite>
</testsuites>
EOF
expect_ok "a <testsuites> aggregate root is accepted" \
  env MIN_ANDROID_TESTS=1 "$VERIFIER" "$TMP/run"

echo
if [ "$failures" -ne 0 ]; then
  echo "verify-android-test-results: $failures case(s) failed" >&2
  exit 1
fi
echo "verify-android-test-results: $pass case(s) passed"
