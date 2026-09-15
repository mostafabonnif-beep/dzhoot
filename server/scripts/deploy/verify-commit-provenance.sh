#!/usr/bin/env bash
# Prove that a commit is allowed to reach production before anything is swapped.
#
# Two independent questions, both answered by the GitHub API (no local checkout
# needed, so it runs on the VPS):
#
#   1. Lineage — is the SHA an ancestor of an approved ref (`main` by default)?
#      A commit that only exists on a branch, in a fork, or nowhere in the repo
#      must never be deployed, even if its SHA is typed correctly.
#   2. CI — did every check run for that commit finish green? Field reports show
#      the Android job failing is exactly the kind of thing a manual deploy skips
#      (2026-09-15: main was red on `android` while production ran an older commit).
#      A red check is a hard stop here.
#
# Usage:
#   scripts/deploy/verify-commit-provenance.sh <sha> [<sha> ...]
#
# Environment:
#   DZHOOF_REPO=mostafabonnif-beep/dzhoot
#   APPROVED_REFS=main            comma-separated refs/names that may be deployed
#   DZHOOT_TOKEN_FILE=/etc/dzhoot/github.token   optional (raises API rate limits)
#   ALLOW_UNVERIFIED_REF=1        escape hatch for lineage only (CI is still required)
#   REQUIRED_WORKFLOWS="DZ HOOF CI,CodeQL Security Analysis"   workflows that must be green
#   REQUIRE_CI=1                  set 0 to skip the CI gate (NOT recommended)
#
# Exit: 0 the commit is proven deployable, 1 it is not, 2 usage/environment error.
set -Eeuo pipefail

REPO="${DZHOOF_REPO:-mostafabonnif-beep/dzhoot}"
APPROVED_REFS="${APPROVED_REFS:-main}"
REQUIRED_WORKFLOWS="${REQUIRED_WORKFLOWS:-DZ HOOF CI,CodeQL Security Analysis}"
REQUIRE_CI="${REQUIRE_CI:-1}"
ALLOW_UNVERIFIED_REF="${ALLOW_UNVERIFIED_REF:-0}"
TOKEN_FILE="${DZHOOT_TOKEN_FILE:-/etc/dzhoot/github.token}"
API="https://api.github.com/repos/${REPO}"

say() { printf '[provenance] %s\n' "$*"; }
# die <message> [exit-code]: the caller can tell "this commit is refused" (1) from
# "this host cannot verify anything" (2).
die() {
  local message="$1" code="${2:-1}"
  printf '[provenance][ABORT] %s\n' "$message" >&2
  exit "$code"
}

[ "$#" -ge 1 ] || die "usage: verify-commit-provenance.sh <sha> [<sha> ...]" 2
command -v curl >/dev/null || die "curl is required" 2
command -v python3 >/dev/null || die "python3 is required" 2

# The token never goes into curl's argv (visible in /proc/*/cmdline) and the token file
# must not be readable by anyone else.
CURL_CONFIG=""
cleanup() { [ -n "$CURL_CONFIG" ] && rm -f "$CURL_CONFIG"; }
trap cleanup EXIT
if [ -f "$TOKEN_FILE" ]; then
  TOKEN_MODE="$(stat -c '%a' "$TOKEN_FILE" 2>/dev/null || echo '')"
  [ "$TOKEN_MODE" = "600" ] || die "token file $TOKEN_FILE must be chmod 600 (is ${TOKEN_MODE:-unknown})" 2
  CURL_CONFIG="$(mktemp)"
  chmod 600 "$CURL_CONFIG"
  {
    printf 'header = "Accept: application/vnd.github+json"\n'
    printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")"
  } > "$CURL_CONFIG"
fi

api_get() {
  if [ -n "$CURL_CONFIG" ]; then
    curl -fsS --max-time 25 --config "$CURL_CONFIG" "$1"
  else
    curl -fsS --max-time 25 -H "Accept: application/vnd.github+json" "$1"
  fi
}

# Answers "is <sha> an ancestor of <ref>?" using the compare API: when the head is
# an ancestor of the base, GitHub reports status "behind" (or "identical").
commit_is_in_ref() {
  local sha="$1" ref="$2" status
  status="$(api_get "${API}/compare/${ref}...${sha}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
  case "$status" in
    behind|identical) return 0 ;;
    *) return 1 ;;
  esac
}

# Every required workflow must have concluded successfully for this commit.
#
# This deliberately keys on *workflow runs* (Actions) rather than on the merged
# check-run list: the repository's own gates are the `DZ HOOF CI` and
# `CodeQL Security Analysis` workflows, while the check-run list also carries
# third-party integrations that must not be able to block a deploy. A commit whose
# required workflow was cancelled (a newer push supersedes it) or failed is NOT
# validated, so it is refused.
ci_is_green() {
  local sha="$1" report
  report="$(api_get "${API}/actions/runs?head_sha=${sha}&per_page=100" \
    | REQUIRED_WORKFLOWS="$REQUIRED_WORKFLOWS" python3 -c '
import json, os, sys

data = json.load(sys.stdin)
runs = data.get("workflow_runs", []) or []
required = [name.strip() for name in os.environ.get("REQUIRED_WORKFLOWS", "").split(",") if name.strip()]

newest = {}
all_names = set()
for run in runs:
    name = run.get("name") or "?"
    all_names.add(name)
    created = run.get("created_at") or ""
    previous = newest.get(name)
    if previous is None or created > previous.get("created_at", ""):
        newest[name] = {"created_at": created, "conclusion": run.get("conclusion"), "status": run.get("status")}

bad = []
missing = [name for name in required if name not in newest]
for name in required:
    entry = newest.get(name)
    if not entry:
        continue
    if entry["status"] != "completed":
        bad.append(name + ": " + str(entry["status"]))
    elif entry["conclusion"] != "success":
        bad.append(name + ": " + str(entry["conclusion"]))

print(json.dumps({
    "required": required,
    "missing": missing,
    "bad": bad,
    "observed": sorted(all_names),
}))
' 2>/dev/null || echo '')"
  [ -n "$report" ] || return 1
  printf '%s' "$report" | python3 -c '
import json, sys
report = json.load(sys.stdin)
observed = ", ".join(report["observed"]) or "none"
print(f"[provenance] workflow runs for this commit: {observed}")
if report["missing"]:
    print("[provenance][ABORT] no run found for required workflow(s): " + ", ".join(report["missing"]), file=sys.stderr)
    sys.exit(1)
if report["bad"]:
    for line in report["bad"]:
        print(f"[provenance][ABORT] required workflow not green -> {line}", file=sys.stderr)
    sys.exit(1)
print("[provenance] required workflows: " + ", ".join(report["required"]) + " all green")
sys.exit(0)
'
}

STATUS=0
for SHA in "$@"; do
  case "$SHA" in
    *[!0-9a-f]*|"") die "not a lowercase hex SHA: '$SHA'" ;;
  esac
  [ "${#SHA}" -eq 40 ] || die "not a full 40-character SHA: '$SHA'"

  say "checking $SHA against ${APPROVED_REFS}"

  in_approved_ref=0
  IFS=',' read -r -a refs <<< "$APPROVED_REFS"
  for ref in "${refs[@]}"; do
    ref="$(printf '%s' "$ref" | tr -d ' ')"
    [ -n "$ref" ] || continue
    if commit_is_in_ref "$SHA" "$ref"; then
      say "lineage OK: $SHA is an ancestor of $ref"
      in_approved_ref=1
      break
    fi
    say "lineage: $SHA is NOT an ancestor of $ref"
  done

  if [ "$in_approved_ref" -ne 1 ]; then
    if [ "$ALLOW_UNVERIFIED_REF" = "1" ]; then
      say "WARNING: $SHA is not in ${APPROVED_REFS} (ALLOW_UNVERIFIED_REF=1)"
    else
      printf '[provenance][ABORT] %s is not an ancestor of %s — refusing to deploy an unreviewed commit\n' \
        "$SHA" "$APPROVED_REFS" >&2
      STATUS=1
      continue
    fi
  fi

  if [ "$REQUIRE_CI" = "1" ]; then
    if ci_is_green "$SHA"; then
      say "CI OK: every check run for $SHA is green"
    else
      printf '[provenance][ABORT] %s has a non-green CI check — refusing to deploy\n' "$SHA" >&2
      STATUS=1
      continue
    fi
  else
    say "WARNING: CI gate disabled (REQUIRE_CI=0) for $SHA"
  fi

  say "PROVEN $SHA"
done

[ "$STATUS" -eq 0 ] || die "provenance verification failed; nothing should be deployed"
say "all commits verified"
