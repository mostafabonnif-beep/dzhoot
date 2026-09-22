#!/usr/bin/env bash
# Proves that scripts/security/check-secrets.sh still catches what it claims to catch.
#
# The guard is the only thing standing between this public repository and another leaked
# credential, and a guard that silently stopped matching would report a clean tree forever. So it
# is exercised against fixtures in a throwaway git repository on every run: one that must fail, one
# that must pass.
#
# The fixture is generated rather than written out, so this file never contains the value it looks
# for (a guard whose own test trips the guard is useless).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
guard="${repo_root}/scripts/security/check-secrets.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

cd "${tmp}"
git init -q .
git config user.email "selftest@local"
git config user.name "selftest"
mkdir -p scripts/qa

# A plausible code: the same 6-character alphanumeric shape a panel hands out. Generated without
# a truncating reader (`head` on a `tr /dev/urandom` pipe raises SIGPIPE under `pipefail`).
fixture_code="$(head -c 48 /dev/urandom | base64 | LC_ALL=C tr -dc 'A-Z0-9' | cut -c1-6)"

# 1) A hardcoded code must be rejected — the exact shape of the leak that prompted this rule
#    (`CODE = "<code>"` in a tracked QA script).
printf 'CODE = "%s"\n' "${fixture_code}" > scripts/qa/fixture.py
git add -A
if CHECK_SECRETS_SELF_TEST=0 bash "${guard}" >/dev/null 2>&1; then
  printf 'FAIL: a hardcoded device code was NOT detected\n' >&2
  exit 1
fi
printf 'PASS: hardcoded device code rejected\n'

# 2) An environment-read code and documented placeholders must be accepted.
cat > scripts/qa/fixture.py <<'PY'
import os
TV_CODE = os.environ.get("DZHOOF_TV_CODE", "").strip()
# X-TV-Code: <tv_code_from_settings>
# TV_CODE = "DZHF-XXXX-XXXX-XXXX"
PY
git add -A
if ! CHECK_SECRETS_SELF_TEST=0 bash "${guard}" >/dev/null 2>&1; then
  printf 'FAIL: the guard rejects an environment-read code or a placeholder\n' >&2
  exit 1
fi
printf 'PASS: environment read and placeholders accepted\n'

# 3) A fixture that opted out explicitly with the marker must be accepted, and the marker has to
#    be on the offending line (a comment above it is not enough).
printf 'CODE = "%s" # secret-guard-allow: unit-test fixture\n' "${fixture_code}" > scripts/qa/fixture.py
git add -A
if ! CHECK_SECRETS_SELF_TEST=0 bash "${guard}" >/dev/null 2>&1; then
  printf 'FAIL: an explicitly annotated fixture was rejected\n' >&2
  exit 1
fi
printf 'PASS: annotated fixture accepted\n'

printf 'check-secrets self-test passed\n'
