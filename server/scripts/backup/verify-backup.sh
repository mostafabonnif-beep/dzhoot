#!/usr/bin/env bash
# DZ HOOF backup verification (audit-remediation-v1).
# Verifies a mongodump --archive --gzip backup end-to-end:
#   1. file exists and is non-trivial
#   2. gzip integrity
#   3. SHA256 checksum matches (when a SHA256SUMS file is present)
#   4. mongorestore --dryRun parses the archive (needs docker + the mongo image)
#
# Usage:
#   ./scripts/backup/verify-backup.sh /path/to/dzhoof-iptv.archive.gz [SHA256SUMS]
set -uo pipefail

ARCHIVE="${1:-}"
SUMS_FILE="${2:-$(dirname "${ARCHIVE:-.}")/SHA256SUMS}"
failures=0

say()  { printf '\033[1;34m[verify-backup]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[verify-backup][FAIL]\033[0m %s\n' "$*"; failures=$((failures + 1)); }
ok()   { printf '\033[1;32m[verify-backup][ok]\033[0m %s\n' "$*"; }

[ -n "$ARCHIVE" ] || { echo "usage: $0 <archive.gz> [SHA256SUMS]"; exit 2; }
[ -f "$ARCHIVE" ] || { fail "archive not found: $ARCHIVE"; exit 1; }

say "Verifying $ARCHIVE"

# 1. Size sanity (should be at least 1MB for a real install)
SIZE=$(stat -c '%s' "$ARCHIVE")
if [ "$SIZE" -lt 1048576 ]; then
  warn_like() { fail "archive suspiciously small (${SIZE} bytes)"; }
  warn_like
else
  ok "size ${SIZE} bytes"
fi

# 2. gzip integrity
if gzip -t "$ARCHIVE" 2>/dev/null; then
  ok "gzip integrity"
else
  fail "gzip integrity check failed"
fi

# 3. Checksum
if [ -f "$SUMS_FILE" ]; then
  if (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$SUMS_FILE")") >/dev/null 2>&1; then
    ok "SHA256 checksum matches"
  else
    fail "SHA256 checksum mismatch"
  fi
else
  say "no SHA256SUMS next to archive — skipping checksum (expected for ad-hoc backups)"
fi

# 4. mongorestore dry-run (validates the archive structure + BSON)
if command -v docker >/dev/null 2>&1; then
  MONGO_IMG="${MONGO_IMG:-mongo:7.0.19}"
  if docker run --rm -v "$(dirname "$ARCHIVE")":/backup:ro "$MONGO_IMG" \
      mongorestore --archive="/backup/$(basename "$ARCHIVE")" --gzip --dryRun >/dev/null 2>&1; then
    ok "mongorestore --dryRun parsed the archive"
  else
    fail "mongorestore --dryRun could not parse the archive (run with docker run ... --dryRun --verbose to see why)"
  fi
else
  say "docker not available — skipping mongorestore dry-run"
fi

echo ""
if [ "$failures" -gt 0 ]; then
  printf '\033[1;31m[verify-backup] FAILED (%d)\033[0m\n' "$failures"
  exit 1
fi
printf '\033[1;32m[verify-backup] BACKUP VERIFIED OK\033[0m\n'
exit 0
