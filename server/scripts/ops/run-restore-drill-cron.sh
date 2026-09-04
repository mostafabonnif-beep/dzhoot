#!/usr/bin/env bash
set -Eeuo pipefail
BACKUP_FILE="$(find /var/backups/dzhoot/mongodb -mindepth 2 -maxdepth 2 -type f -name 'dzhoof.archive.gz' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
[ -n "$BACKUP_FILE" ] || { echo '[restore-drill][ABORT] no MongoDB backup found' >&2; exit 1; }
export ALLOW_RESTORE_DRILL=true
export BACKUP_FILE
exec /bin/bash /opt/dzhoot/server/scripts/backup/restore-drill-docker.sh
