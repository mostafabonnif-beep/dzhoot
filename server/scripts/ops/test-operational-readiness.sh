#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/ops/operational-readiness.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BIN="$TMP/bin"
BACKUPS="$TMP/backups"
mkdir -p "$BIN" "$BACKUPS"

cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s' '{"status":"ok","version":"1.0.1","release":{"commit":"abcdef1","builtAt":"2026-08-24T00:00:00Z"}}'
EOF
chmod +x "$BIN/curl"

cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == 'inspect' ]]; then
  printf '%s\n' 'true|healthy|0'
  exit 0
fi
exit 1
EOF
chmod +x "$BIN/docker"

archive="$BACKUPS/dzhoof-iptv.archive.gz"
printf 'fixture-backup' | gzip > "$archive"
(
  cd "$BACKUPS"
  sha256sum "$(basename "$archive")" > SHA256SUMS
)

offsite="$TMP/offsite-proof.txt"
restore="$TMP/restore-proof.txt"
printf 'off-site copy verified\n' > "$offsite"
printf 'restore drill verified\n' > "$restore"

run_guard() {
  PATH="$BIN:$PATH" \
  BASE_URL='https://example.invalid' \
  BACKUP_DIR="$BACKUPS" \
  MIN_DISK_FREE_MB=1 \
  MAX_BACKUP_AGE_HOURS=1 \
  OFFSITE_BACKUP_EVIDENCE="$offsite" \
  RESTORE_DRILL_EVIDENCE="$restore" \
  DZHOOF_CONTAINERS='dzhoof-api' \
  "$SCRIPT"
}

run_guard >/dev/null

rm -f "$archive"
if run_guard >/dev/null 2>&1; then
  echo 'expected missing backup to fail' >&2
  exit 1
fi

printf 'fixture-backup' | gzip > "$archive"
(
  cd "$BACKUPS"
  sha256sum "$(basename "$archive")" > SHA256SUMS
)
if PATH="$BIN:$PATH" \
  BASE_URL='https://example.invalid' \
  BACKUP_DIR="$BACKUPS" \
  MIN_DISK_FREE_MB=1 \
  MAX_BACKUP_AGE_HOURS=1 \
  DZHOOF_CONTAINERS='dzhoof-api' \
  STRICT=true \
  "$SCRIPT" >/dev/null 2>&1; then
  echo 'expected strict mode to reject missing evidence warnings' >&2
  exit 1
else
  status=$?
  [[ "$status" -eq 2 ]] || { echo "expected strict exit 2, got $status" >&2; exit 1; }
fi

echo 'operational readiness guard tests passed'
