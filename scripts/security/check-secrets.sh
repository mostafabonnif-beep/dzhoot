#!/usr/bin/env bash
# Fails fast when tracked files contain private keys, common credential files,
# or high-confidence token patterns. It intentionally reports only file paths.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The rules below are only worth trusting if they still fire. Prove it on every run, in a
# throwaway repository, before trusting a pass over this one. The nested invocation is what the
# flag prevents from recursing.
if [[ "${CHECK_SECRETS_SELF_TEST:-1}" == "1" ]]; then
  CHECK_SECRETS_SELF_TEST=0 bash "${repo_root}/scripts/security/test-check-secrets.sh" >&2 || {
    printf '::error::The secret guard did not catch its own fixture — treat a pass as meaningless.\n' >&2
    exit 1
  }
fi

failures=0

report_files() {
  local title="$1"
  local files="$2"
  if [[ -n "${files}" ]]; then
    printf '::error::%s\n%s\n' "${title}" "${files}" >&2
    failures=1
  fi
}

private_key_files="$(git grep -IlE -e '-----BEGIN (OPENSSH|RSA|EC|DSA|PRIVATE) KEY-----' || true)"
report_files 'Private key material must never be tracked.' "${private_key_files}"

credential_files="$(git ls-files | grep -Eai '(^|/)(dzhoof-admin-key|id_(rsa|ed25519)|.*\.(pem|key|p12|pfx|ppk))$' || true)"
report_files 'Credential or private-key file names must not be tracked.' "${credential_files}"

access_token_files="$(git grep -IlE -e '(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{20,})' || true)"
report_files 'High-confidence access-token pattern detected. Rotate it and use repository secrets.' "${access_token_files}"

# A channel-list (device) code is a bearer credential for the managed API: it reads the catalog,
# pulls EPG and mints playback tokens. One sat in `server/scripts/qa/contract-test.py` in this
# public repository and still authenticated against production weeks after it was committed, so
# the shape is now rejected outright: a quoted literal of `[A-Z0-9_-]` assigned to a code-ish name,
# or sent as the `X-TV-Code` header value.
#
# Two escapes keep the rule usable without blunting it:
#   - placeholders carry no usable value (`DZHF-XXXX-XXXX-XXXX`, `PLACEHOLDER`, `EXAMPLE`);
#   - a line may opt out explicitly with a `secret-guard-allow` marker. Repeated identifiers in
#     unit-test fixtures are genuine exceptions the guard cannot tell from a live credential, so
#     each one is annotated and therefore visible in review.
# Markdown and `.example` files are skipped, and `scripts/security/` is skipped so this file's own
# patterns cannot match themselves.
device_code_pattern='(TV_?CODE|DEVICE_CODE|CHANNEL_LIST_CODE|CODE|X-TV-Code)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Z0-9][A-Z0-9_-]{5,}["'"'"']'
device_code_matches="$(git grep -InE -e "${device_code_pattern}" \
  -- . ':(exclude)*.md' ':(exclude)*.example' ':(exclude)scripts/security/*' || true)"
device_code_files=""
if [[ -n "${device_code_matches}" ]]; then
  device_code_files="$(printf '%s\n' "${device_code_matches}" \
    | grep -v 'secret-guard-allow' \
    | grep -vE '"[A-Z0-9_-]*X{2,}|PLACEHOLDER|EXAMPLE' \
    | cut -d: -f1 | sort -u || true)"
fi
report_files 'A device/channel-list code looks hardcoded. Rotate it and read it from the environment.' "${device_code_files}"

if [[ "${failures}" -ne 0 ]]; then
  exit 1
fi

printf 'Secret guard passed: no tracked private keys or high-confidence access tokens found.\n'
