#!/usr/bin/env bash
#
# Assert that a Gradle unit-test task really produced results, and that those
# results are clean.
#
# Why this exists: `./gradlew :app:testStagingDebugUnitTest` exits 0 when the
# task is UP-TO-DATE, when the variant filter excluded everything, or when the
# test source set is empty. A green Gradle line is therefore not evidence that
# a single test ran. The JUnit XML the task writes is the evidence, so CI reads
# it instead of trusting the exit code (operations brief §2, "لا تكتفِ بالتصريف").
#
# Usage:
#   scripts/ci/verify-android-test-results.sh [results-dir]
#
# Environment:
#   MIN_ANDROID_TESTS   baseline used for the drift warning (default 500).
#                       A lower total warns instead of failing: consolidating
#                       tests is legitimate, silently losing them is not.
#
set -euo pipefail

RESULTS_DIR="${1:-android/app/build/test-results/testStagingDebugUnitTest}"
MIN_TESTS="${MIN_ANDROID_TESTS:-500}"

if [ ! -d "$RESULTS_DIR" ]; then
  echo "::error::no unit-test results at '$RESULTS_DIR' — the test task did not run" >&2
  exit 1
fi

shopt -s nullglob
xml_files=("$RESULTS_DIR"/*.xml)
if [ "${#xml_files[@]}" -eq 0 ]; then
  echo "::error::'$RESULTS_DIR' contains no JUnit XML — the test task produced no results" >&2
  exit 1
fi

RESULTS_DIR="$RESULTS_DIR" MIN_TESTS="$MIN_TESTS" python3 - <<'PY'
import glob
import os
import sys
import xml.etree.ElementTree as ET

results_dir = os.environ["RESULTS_DIR"]
min_tests = int(os.environ["MIN_TESTS"])

files = sorted(glob.glob(os.path.join(results_dir, "*.xml")))
tests = failures = errors = skipped = 0
bad = []

for path in files:
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as exc:
        print(f"::error file={path}::unreadable JUnit XML: {exc}")
        sys.exit(1)

    # A <testsuite> root carries the counters; a <testsuites> root aggregates
    # suites, so sum the children in that case.
    suites = [root] if root.tag == "testsuite" else list(root)
    for suite in suites:
        if suite.tag != "testsuite":
            continue
        tests += int(suite.get("tests") or 0)
        failures += int(suite.get("failures") or 0)
        errors += int(suite.get("errors") or 0)
        skipped += int(suite.get("skipped") or 0)
        for case in suite.iter("testcase"):
            for kind in ("failure", "error"):
                node = case.find(kind)
                if node is not None:
                    name = f"{case.get('classname', '?')}.{case.get('name', '?')}"
                    message = (node.get("message") or node.text or "").strip().splitlines()
                    bad.append(f"  {kind.upper()}: {name} — {message[0] if message else ''}")

print(f"JUnit XML files   : {len(files)}")
print(f"tests             : {tests}")
print(f"failures          : {failures}")
print(f"errors            : {errors}")
print(f"skipped           : {skipped}")

if tests == 0:
    print("::error::the unit-test task reported zero tests — treat as a broken test run")
    sys.exit(1)

if bad:
    print("\n".join(bad))
    print(f"::error::{failures + errors} failing unit test(s); see the XML in {results_dir}")
    sys.exit(1)

if tests < min_tests:
    print(
        f"::warning title=Android test count dropped::{tests} tests ran, below the "
        f"baseline of {min_tests}. Confirm the reduction was intentional."
    )

print("Android unit tests: green")
PY
