#!/usr/bin/env bash
# Fails fast when tracked files contain private keys, common credential files,
# or high-confidence token patterns. It intentionally reports only file paths.
set -euo pipefail

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

if [[ "${failures}" -ne 0 ]]; then
  exit 1
fi

printf 'Secret guard passed: no tracked private keys or high-confidence access tokens found.\n'
