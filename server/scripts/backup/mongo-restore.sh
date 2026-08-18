#!/usr/bin/env bash
set -euo pipefail
: "${MONGODB_URI:?MONGODB_URI is required}"
: "${BACKUP_ARCHIVE:?BACKUP_ARCHIVE is required}"
CHECKSUM_FILE="${CHECKSUM_FILE:-${BACKUP_ARCHIVE%/*}/SHA256SUMS}"
if [ -f "$CHECKSUM_FILE" ]; then (cd "$(dirname "$BACKUP_ARCHIVE")" && sha256sum -c "$(basename "$CHECKSUM_FILE")"); fi
mongorestore --uri="$MONGODB_URI" --gzip --archive="$BACKUP_ARCHIVE" --drop
