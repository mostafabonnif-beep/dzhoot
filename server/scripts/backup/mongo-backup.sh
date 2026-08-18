#!/usr/bin/env bash
set -euo pipefail
: "${MONGODB_URI:?MONGODB_URI is required}"
OUT_DIR="${BACKUP_DIR:-./backups/mongo}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"
mongodump --uri="$MONGODB_URI" --gzip --archive="$OUT_DIR/dzhoof.archive.gz"
sha256sum "$OUT_DIR/dzhoof.archive.gz" > "$OUT_DIR/SHA256SUMS"
echo "MongoDB backup written to $OUT_DIR"
